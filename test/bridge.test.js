import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bridgePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scaffold',
  'chrome-mcp-bridge.cjs',
);
const { encodeNmhFrame, parseNmhFrames, TOOLS, MCP_PROTOCOL_VERSION, BRIDGE_VERSION } = require(
  bridgePath,
);

describe('NMH frame encoding', () => {
  it('encodes a simple object with 4-byte LE length prefix', () => {
    const frame = encodeNmhFrame({ type: 'ping' });
    const len = frame.readUInt32LE(0);
    const json = frame.slice(4).toString('utf8');
    assert.equal(len, Buffer.byteLength(json, 'utf8'));
    assert.deepEqual(JSON.parse(json), { type: 'ping' });
  });

  it('handles unicode correctly', () => {
    const obj = { text: 'héllo wörld 🎉' };
    const frame = encodeNmhFrame(obj);
    const len = frame.readUInt32LE(0);
    const json = frame.slice(4, 4 + len).toString('utf8');
    assert.deepEqual(JSON.parse(json), obj);
  });
});

describe('NMH frame parsing', () => {
  it('parses a complete frame', () => {
    const frame = encodeNmhFrame({ result: 'ok' });
    const { messages, remainder } = parseNmhFrames(frame);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], { result: 'ok' });
    assert.equal(remainder.length, 0);
  });

  it('parses multiple frames in one buffer', () => {
    const frame1 = encodeNmhFrame({ id: 1 });
    const frame2 = encodeNmhFrame({ id: 2 });
    const combined = Buffer.concat([frame1, frame2]);
    const { messages, remainder } = parseNmhFrames(combined);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0], { id: 1 });
    assert.deepEqual(messages[1], { id: 2 });
    assert.equal(remainder.length, 0);
  });

  it('handles incomplete frame (returns remainder)', () => {
    const frame = encodeNmhFrame({ data: 'hello' });
    const partial = frame.slice(0, frame.length - 3); // chop off last 3 bytes
    const { messages, remainder } = parseNmhFrames(partial);
    assert.equal(messages.length, 0);
    assert.equal(remainder.length, partial.length);
  });

  it('handles frame split across chunks', () => {
    const frame = encodeNmhFrame({ split: true });
    const mid = Math.floor(frame.length / 2);
    const chunk1 = frame.slice(0, mid);
    const chunk2 = frame.slice(mid);

    const r1 = parseNmhFrames(chunk1);
    assert.equal(r1.messages.length, 0);

    const combined = Buffer.concat([r1.remainder, chunk2]);
    const r2 = parseNmhFrames(combined);
    assert.equal(r2.messages.length, 1);
    assert.deepEqual(r2.messages[0], { split: true });
  });

  it('round-trips correctly', () => {
    const original = {
      type: 'tool_request',
      method: 'navigate',
      params: { url: 'http://localhost:3000' },
    };
    const frame = encodeNmhFrame(original);
    const { messages } = parseNmhFrames(frame);
    assert.deepEqual(messages[0], original);
  });

  it('handles empty buffer', () => {
    const { messages, remainder } = parseNmhFrames(Buffer.alloc(0));
    assert.equal(messages.length, 0);
    assert.equal(remainder.length, 0);
  });

  it('handles buffer too short for header', () => {
    const { messages, remainder } = parseNmhFrames(Buffer.from([0x05, 0x00]));
    assert.equal(messages.length, 0);
    assert.equal(remainder.length, 2);
  });
});

describe('tool definitions', () => {
  it('exports 18 tools', () => {
    assert.equal(TOOLS.length, 18);
  });

  it('each tool has name, description, and inputSchema', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.name, `tool missing name`);
      assert.ok(tool.description, `${tool.name} missing description`);
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema must be object type`);
    }
  });

  it('tool names are unique', () => {
    const names = TOOLS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, 'duplicate tool names');
  });

  it('includes critical tools', () => {
    const names = TOOLS.map((t) => t.name);
    assert.ok(names.includes('tabs_context_mcp'));
    assert.ok(names.includes('navigate'));
    assert.ok(names.includes('computer'));
    assert.ok(names.includes('switch_browser'));
  });
});

describe('constants', () => {
  it('has valid protocol version', () => {
    assert.match(MCP_PROTOCOL_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('has bridge version', () => {
    assert.ok(BRIDGE_VERSION);
  });
});

describe('subprocess integration', () => {
  it('responds to initialize on stdio', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn('node', [bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp', BRIDGE_VERBOSE: '0' },
    });

    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));

    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
      }) + '\n',
    );

    // Give it a moment to respond
    await new Promise((r) => setTimeout(r, 200));

    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 200));

    child.stdin.end();
    await new Promise((r) => child.on('exit', r));

    const output = Buffer.concat(chunks).toString('utf8');
    const lines = output
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    // First response: initialize
    assert.equal(lines[0].id, 1);
    assert.equal(lines[0].result.protocolVersion, '2024-11-05');
    assert.equal(lines[0].result.serverInfo.name, 'Claude in Chrome');

    // Second response: tools/list
    assert.equal(lines[1].id, 2);
    assert.equal(lines[1].result.tools.length, 18);
  });

  it('returns error for tools/call when NMH not connected', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn('node', [bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp', BRIDGE_VERBOSE: '0' },
    });

    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));

    // Initialize first
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 200));

    // Try a tool call — should error since no NMH socket
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'navigate', arguments: { url: 'http://example.com', tabId: 1 } },
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 500));

    child.stdin.end();
    await new Promise((r) => child.on('exit', r));

    const output = Buffer.concat(chunks).toString('utf8');
    const lines = output
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    // Find the tool call response
    const toolResponse = lines.find((l) => l.id === 2);
    assert.ok(toolResponse, 'should have tool call response');
    assert.ok(toolResponse.error, 'should be an error');
    assert.ok(
      toolResponse.error.message.includes('not connected'),
      'error should mention connection',
    );
  });
});
