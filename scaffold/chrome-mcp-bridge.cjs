#!/usr/bin/env node
// @ts-check
/**
 * chrome-mcp-bridge.js — MCP↔NMH protocol translator (zero dependencies).
 *
 * Runs inside the Docker container, spawned by Claude Code via --chrome.
 * Speaks MCP JSON-RPC on stdio (newline-delimited) and NMH wire protocol
 * on a Unix socket (4-byte LE length-prefixed JSON).
 *
 * Architecture:
 *   Claude Code (stdio/MCP) → this script → socat → bridge-host → Chrome NMH
 */
'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// ── Configuration ──────────────────────────────────────────────────────────
const BRIDGE_VERSION = '1';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const SOCK_DIR = `/tmp/claude-mcp-browser-bridge-${process.env.USER || os.userInfo().username}`;
const SOCK_PATH = path.join(SOCK_DIR, 'mcp.sock');
const LOG_FILE = path.join(process.env.HOME || '/home/dev', '.claude', 'logs', 'chrome-bridge.log');
const CALL_TIMEOUT = parseInt(process.env.BRIDGE_TIMEOUT || '30000', 10);
const VERBOSE = process.env.BRIDGE_VERBOSE === '1';

// ── Logging ────────────────────────────────────────────────────────────────

/** @returns {string} ISO timestamp */
function ts() { return new Date().toISOString(); }

/** Append a log line to the bridge log file (best-effort). */
function logMsg(msg) {
  try { fs.appendFileSync(LOG_FILE, `${ts()} ${msg}\n`); } catch { /* best-effort */ }
}

/** Log only when BRIDGE_VERBOSE=1 is set. */
function logVerbose(msg) {
  if (VERBOSE) logMsg(`[verbose] ${msg}`);
}

// ── NMH frame helpers (4-byte LE length + JSON) ────────────────────────────

/**
 * Encode an object as a 4-byte LE length-prefixed NMH frame.
 * @param {object} obj
 * @returns {Buffer}
 */
function encodeNmhFrame(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.alloc(4 + Buffer.byteLength(json, 'utf8'));
  buf.writeUInt32LE(Buffer.byteLength(json, 'utf8'), 0);
  buf.write(json, 4, 'utf8');
  return buf;
}

/**
 * Parse one or more NMH frames from a buffer.
 * @param {Buffer} buf
 * @returns {{ messages: object[], remainder: Buffer }}
 */
function parseNmhFrames(buf) {
  const messages = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    if (offset + 4 + len > buf.length) break; // incomplete frame
    const json = buf.slice(offset + 4, offset + 4 + len).toString('utf8');
    try {
      messages.push(JSON.parse(json));
    } catch (e) {
      logMsg(`[error] Failed to parse NMH frame: ${e.message}`);
    }
    offset += 4 + len;
  }
  return { messages, remainder: buf.slice(offset) };
}

// ── MCP JSON-RPC helpers ───────────────────────────────────────────────────

/** Write a JSON-RPC message to stdout (newline-delimited). */
function sendMcp(obj) {
  const line = JSON.stringify(obj) + '\n';
  try { process.stdout.write(line); } catch { /* stdout closed */ }
}

/** Send a successful JSON-RPC result. */
function mcpResult(id, result) {
  sendMcp({ jsonrpc: '2.0', id, result });
}

/** Send a JSON-RPC error response. */
function mcpError(id, code, message) {
  sendMcp({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── NMH socket connection ──────────────────────────────────────────────────

let sock = null;
let sockBuf = Buffer.alloc(0);
let connected = false;
let nextNmhId = 1;
const pending = new Map(); // nmhId → { mcpId, timer }

/** Connect to the NMH relay socket (socat). Sets up bidirectional data handling. */
function connectToNmh() {
  if (sock) return;
  logMsg('[bridge] Connecting to NMH relay at ' + SOCK_PATH);

  sock = net.createConnection(SOCK_PATH);

  sock.on('connect', () => {
    connected = true;
    logMsg('[bridge] Connected to NMH relay');
    // Notify NMH that an MCP client connected
    sock.write(encodeNmhFrame({ type: 'mcp_connected' }));
  });

  sock.on('data', (data) => {
    sockBuf = Buffer.concat([sockBuf, data]);
    const { messages, remainder } = parseNmhFrames(sockBuf);
    sockBuf = remainder;

    for (const msg of messages) {
      logVerbose('[nmh→bridge] ' + JSON.stringify(msg).substring(0, 500));
      handleNmhResponse(msg);
    }
  });

  sock.on('error', (e) => {
    logMsg('[bridge] Socket error: ' + e.message);
    connected = false;
    sock = null;
    sockBuf = Buffer.alloc(0);
    // Fail all pending requests
    for (const [nmhId, entry] of pending) {
      clearTimeout(entry.timer);
      mcpError(entry.mcpId, -32603, 'Chrome bridge connection lost');
      pending.delete(nmhId);
    }
  });

  sock.on('close', () => {
    logMsg('[bridge] Socket closed');
    connected = false;
    sock = null;
    sockBuf = Buffer.alloc(0);
  });
}

/** Match an NMH response to the oldest pending MCP request and send the result. */
function handleNmhResponse(msg) {
  // NMH responses don't have explicit IDs — they arrive in order.
  // Match to the oldest pending request.
  if (msg.result !== undefined || msg.error !== undefined) {
    const firstKey = pending.keys().next().value;
    if (firstKey === undefined) {
      logMsg('[warn] NMH response with no pending request');
      return;
    }
    const entry = pending.get(firstKey);
    pending.delete(firstKey);
    clearTimeout(entry.timer);

    if (msg.error) {
      mcpError(entry.mcpId, -32603, typeof msg.error === 'string' ? msg.error : msg.error.message || 'Chrome tool error');
    } else {
      // Translate NMH result to MCP content format
      const result = msg.result;
      let content;
      if (result && result.content) {
        // Already in content array format
        content = Array.isArray(result.content) ? result.content : [{ type: 'text', text: String(result.content) }];
      } else {
        content = [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }];
      }
      mcpResult(entry.mcpId, { content });
    }
  }
}

/**
 * Forward an MCP tools/call as an NMH tool_request. Manages timeouts and correlation.
 * @param {number|string} mcpId - JSON-RPC request ID from Claude
 * @param {string} toolName - Chrome tool name
 * @param {object} [args] - Tool arguments
 */
function sendToolRequest(mcpId, toolName, args) {
  if (!connected) {
    // Try to connect on demand
    connectToNmh();
    if (!connected) {
      mcpError(mcpId, -32603, 'Chrome bridge not connected — is Chrome running with the Claude extension?');
      return;
    }
  }

  const nmhId = nextNmhId++;
  const timer = setTimeout(() => {
    if (pending.has(nmhId)) {
      pending.delete(nmhId);
      mcpError(mcpId, -32603, `Chrome tool "${toolName}" timed out after ${CALL_TIMEOUT}ms`);
    }
  }, CALL_TIMEOUT);

  pending.set(nmhId, { mcpId, timer });

  const frame = encodeNmhFrame({
    type: 'tool_request',
    method: toolName,
    params: args || {},
  });

  logVerbose(`[bridge→nmh] tool_request: ${toolName} (mcpId=${mcpId}, nmhId=${nmhId})`);
  sock.write(frame);
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  { name: 'tabs_context_mcp', description: 'Get context about the MCP tab group. Call this first before using other browser tools.', inputSchema: { type: 'object', properties: { createIfEmpty: { type: 'boolean', description: 'Create a new MCP tab group if none exists' } } } },
  { name: 'tabs_create_mcp', description: 'Create a new empty tab in the MCP tab group.', inputSchema: { type: 'object', properties: {} } },
  { name: 'navigate', description: 'Navigate to a URL, or go forward/back in history.', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to, or "forward"/"back"' }, tabId: { type: 'number', description: 'Tab ID to navigate' } }, required: ['url', 'tabId'] } },
  { name: 'computer', description: 'Mouse, keyboard, and screenshot actions on a browser tab.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['left_click', 'right_click', 'double_click', 'triple_click', 'left_click_drag', 'key', 'type', 'scroll', 'scroll_to', 'wait', 'screenshot', 'zoom', 'hover'], description: 'Action to perform' }, tabId: { type: 'number', description: 'Tab ID' }, coordinate: { type: 'array', items: { type: 'number' }, description: '[x, y] coordinates' }, text: { type: 'string', description: 'Text to type or keys to press' }, scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, scroll_amount: { type: 'number' }, duration: { type: 'number' }, modifiers: { type: 'string' }, ref: { type: 'string' }, region: { type: 'array', items: { type: 'number' } }, repeat: { type: 'number' }, start_coordinate: { type: 'array', items: { type: 'number' } } }, required: ['action', 'tabId'] } },
  { name: 'find', description: 'Find elements on the page using natural language.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to find' }, tabId: { type: 'number', description: 'Tab ID' } }, required: ['query', 'tabId'] } },
  { name: 'form_input', description: 'Set values in form elements by reference ID.', inputSchema: { type: 'object', properties: { ref: { type: 'string' }, value: { description: 'Value to set' }, tabId: { type: 'number' } }, required: ['ref', 'value', 'tabId'] } },
  { name: 'get_page_text', description: 'Extract raw text content from the page.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } },
  { name: 'gif_creator', description: 'Record and export GIF of browser actions.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['start_recording', 'stop_recording', 'export', 'clear'] }, tabId: { type: 'number' }, download: { type: 'boolean' }, filename: { type: 'string' }, options: { type: 'object' } }, required: ['action', 'tabId'] } },
  { name: 'javascript_tool', description: 'Execute JavaScript in the page context.', inputSchema: { type: 'object', properties: { action: { type: 'string', const: 'javascript_exec' }, text: { type: 'string', description: 'JavaScript code to execute' }, tabId: { type: 'number' } }, required: ['action', 'text', 'tabId'] } },
  { name: 'read_console_messages', description: 'Read browser console messages from a tab.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' }, pattern: { type: 'string' }, limit: { type: 'number' }, onlyErrors: { type: 'boolean' }, clear: { type: 'boolean' } }, required: ['tabId'] } },
  { name: 'read_network_requests', description: 'Read HTTP network requests from a tab.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' }, urlPattern: { type: 'string' }, limit: { type: 'number' }, clear: { type: 'boolean' } }, required: ['tabId'] } },
  { name: 'read_page', description: 'Get accessibility tree of page elements.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' }, filter: { type: 'string', enum: ['interactive', 'all'] }, depth: { type: 'number' }, ref_id: { type: 'string' }, max_chars: { type: 'number' } }, required: ['tabId'] } },
  { name: 'resize_window', description: 'Resize the browser window.', inputSchema: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' }, tabId: { type: 'number' } }, required: ['width', 'height', 'tabId'] } },
  { name: 'shortcuts_list', description: 'List available shortcuts and workflows.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } },
  { name: 'shortcuts_execute', description: 'Execute a shortcut or workflow.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' }, shortcutId: { type: 'string' }, command: { type: 'string' } }, required: ['tabId'] } },
  { name: 'switch_browser', description: 'Switch which Chrome browser is used for automation.', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_plan', description: 'Present a plan to the user for approval before taking actions.', inputSchema: { type: 'object', properties: { domains: { type: 'array', items: { type: 'string' } }, approach: { type: 'array', items: { type: 'string' } } }, required: ['domains', 'approach'] } },
  { name: 'upload_image', description: 'Upload a screenshot or image to a file input or drag target.', inputSchema: { type: 'object', properties: { imageId: { type: 'string' }, tabId: { type: 'number' }, ref: { type: 'string' }, coordinate: { type: 'array', items: { type: 'number' } }, filename: { type: 'string' } }, required: ['imageId', 'tabId'] } },
];

// ── MCP message handler ────────────────────────────────────────────────────

/** Route an incoming MCP JSON-RPC message to the appropriate handler. */
function handleMcpMessage(msg) {
  logVerbose('[mcp→bridge] ' + JSON.stringify(msg).substring(0, 500));

  // Notifications (no id) — no response needed
  if (msg.id === undefined || msg.id === null) {
    if (msg.method === 'notifications/initialized') {
      logMsg('[bridge] MCP initialized notification received');
    }
    return;
  }

  switch (msg.method) {
    case 'initialize':
      mcpResult(msg.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'Claude in Chrome', version: '1.0.0' },
      });
      logMsg(`[bridge] Initialized (client version: ${msg.params?.protocolVersion || 'unknown'})`);
      // Connect to NMH proactively
      connectToNmh();
      break;

    case 'tools/list':
      mcpResult(msg.id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const { name, arguments: args } = msg.params || {};
      if (!name) {
        mcpError(msg.id, -32602, 'Missing tool name');
        return;
      }
      sendToolRequest(msg.id, name, args);
      break;
    }

    case 'ping':
      mcpResult(msg.id, {});
      break;

    default:
      mcpError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

/** Entry point — sets up stdin reader, signal handlers, and starts the bridge. */
function main() {
  logMsg(`[bridge] Starting chrome-mcp-bridge v${BRIDGE_VERSION} (MCP ${MCP_PROTOCOL_VERSION})`);
  logMsg(`[bridge] Socket: ${SOCK_PATH}, timeout: ${CALL_TIMEOUT}ms, verbose: ${VERBOSE}`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      handleMcpMessage(msg);
    } catch (e) {
      logMsg(`[error] Failed to parse MCP message: ${e.message}`);
      // Can't send error without an id
    }
  });

  rl.on('close', () => {
    logMsg('[bridge] stdin closed, shutting down');
    if (sock) {
      sock.write(encodeNmhFrame({ type: 'mcp_disconnected' }));
      sock.destroy();
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logMsg('[bridge] SIGTERM received, shutting down');
    if (sock) sock.destroy();
    process.exit(0);
  });
}

// ── Exports for testing ────────────────────────────────────────────────────

if (typeof module !== 'undefined') {
  module.exports = { encodeNmhFrame, parseNmhFrames, TOOLS, MCP_PROTOCOL_VERSION, BRIDGE_VERSION };
}

if (require.main === module) {
  main();
}
