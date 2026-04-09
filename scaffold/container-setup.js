#!/usr/bin/env node
/**
 * container-setup.js — Runs INSIDE the Docker container at startup.
 * Sets up the Chrome browser bridge and configures Claude Code settings.
 * Claude Code itself is installed at build time in the Dockerfile.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

function log(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[setup] ${ts} ${msg}`);
}

function which(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// -- Chrome bridge setup -----------------------------------------------------

function setupChromeBridge() {
  const bridgePort = process.env.BRIDGE_PORT || '9229';
  const user = process.env.USER;
  const home = process.env.HOME;

  const sockDir = `/tmp/claude-mcp-browser-bridge-${user}`;
  mkdirSync(sockDir, { recursive: true });
  const sockPath = join(sockDir, 'mcp.sock');

  const chromeDir = join(home, '.claude', 'chrome');
  mkdirSync(chromeDir, { recursive: true });

  // Write chrome-native-host shim. Leave it writable so Claude Code's
  // --chrome flag can overwrite it with its own version (which will also
  // use the socat relay already running).
  const hostScript = join(chromeDir, 'chrome-native-host');
  try { chmodSync(hostScript, 0o755); } catch { /* doesn't exist yet */ }
  writeFileSync(hostScript, `#!/bin/sh\nexec node /usr/local/bin/chrome-mcp-bridge.cjs\n`);
  chmodSync(hostScript, 0o755);

  spawn('socat', [
    `UNIX-LISTEN:${sockPath},fork,reuseaddr`,
    `TCP:host.docker.internal:${bridgePort}`,
  ], { stdio: 'ignore', detached: true }).unref();

  log(`Chrome bridge: ${sockPath} → host.docker.internal:${bridgePort}`);

  // Write MCP server config so Claude Code picks up the chrome bridge on first start
  const settingsPath = join(home, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch { /* start fresh */ }
  }
  settings.mcpServers = settings.mcpServers || {};
  settings.mcpServers['claude-in-chrome'] = {
    type: 'stdio',
    command: '/home/dev/.claude/chrome/chrome-native-host',
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  log('Wrote MCP config for claude-in-chrome');
}

// -- Auto-updater disable ----------------------------------------------------

function disableAutoUpdater() {
  const home = process.env.HOME || '/home/dev';
  const settingsPath = join(home, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      /* start fresh */
    }
  }
  settings.env = settings.env || {};
  settings.env.DISABLE_AUTOUPDATER = '1';
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  log('Auto-updater disabled (updates via --rebuild)');
}

// -- Main --------------------------------------------------------------------

// Claude Code is installed at build time to /usr/local/bin/claude
if (which('claude')) {
  try {
    const ver = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim();
    log(`Claude Code: ${ver}`);
  } catch {
    log('Claude Code found but version check failed');
  }
} else {
  log('WARNING: Claude Code not found — rebuild the image with "devrig start --rebuild"');
}

if (process.env.BRIDGE_ENABLED === '1') {
  setupChromeBridge();
}
disableAutoUpdater();

// -- Devrig server (dashboard + API proxy) ------------------------------------

function startDevrigServer() {
  const script = '/usr/local/bin/devrig-server.js';
  if (!existsSync(script)) {
    log('WARNING: devrig-server.js not found — dashboard will not be available');
    return;
  }

  const logDir = join(process.env.HOME || '/home/dev', '.claude', 'logs');
  const logPath = join(logDir, 'devrig-server.log');
  mkdirSync(logDir, { recursive: true });

  // Respawn wrapper: restart the server when it exits (supports hot reload)
  function spawnServer() {
    const fd = openSync(logPath, 'a');
    const child = spawn('node', [script], {
      stdio: ['ignore', fd, fd],
      env: process.env,
    });
    closeSync(fd);
    child.on('exit', (code) => {
      log(`devrig-server exited (code ${code}), respawning...`);
      setTimeout(spawnServer, 500);
    });
  }
  spawnServer();

  log(`Devrig server starting on port ${process.env.DEVRIG_PORT || 8083}`);
}

startDevrigServer();

const sentinel = join(process.env.HOME || '/home/dev', '.claude', 'logs', '.setup-ready');
writeFileSync(sentinel, `ready ${Date.now() / 1000}\n`);
log('Setup complete — sentinel written');
