#!/usr/bin/env node
/**
 * container-setup.js — Runs INSIDE the Docker container.
 * Installs/updates Claude Code and sets up the Chrome browser bridge.
 * Ported from container-setup.py.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const NATIVE_INSTALLER_URL = 'https://claude.ai/install.sh';

function log(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[setup] ${ts} ${msg}`);
}

function claudeVersion() {
  try {
    return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim();
  } catch { return '<unknown>'; }
}

function which(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// -- Claude Code installation ------------------------------------------------

function installClaudeCodeNative() {
  const version = process.env.CLAUDE_VERSION || 'latest';
  const versionMarker = join(process.env.HOME || '/home/dev', '.claude-version');

  // Skip install if already installed and version matches
  if (which('claude') && existsSync(versionMarker)) {
    const installed = readFileSync(versionMarker, 'utf8').trim();
    if (installed === version || (version === 'latest' && installed)) {
      log(`claude already installed: ${claudeVersion()} (pinned: ${installed})`);
      return;
    }
  }

  if (which('claude')) {
    log(`claude found: ${claudeVersion()}`);
    if (version === 'latest' || version === 'stable') {
      log(`Re-installing (channel: ${version})...`);
    } else {
      log(`Re-installing (version: ${version})...`);
    }
  } else {
    log('claude not found — installing via native installer');
  }

  // Install with version argument
  const installArgs =
    version === 'latest'
      ? `curl -fsSL ${NATIVE_INSTALLER_URL} | bash`
      : `curl -fsSL ${NATIVE_INSTALLER_URL} | bash -s ${version}`;

  execFileSync('bash', ['-c', installArgs], { stdio: 'inherit' });

  // Write version marker
  writeFileSync(versionMarker, version + '\n');

  log(`Installed: ${claudeVersion()}`);
}

function installClaudeCode() {
  installClaudeCodeNative();
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

  // Write chrome-native-host as a shim that execs the MCP↔NMH bridge.
  // Make it read-only so Claude Code's --chrome flag cannot overwrite it.
  const hostScript = join(chromeDir, 'chrome-native-host');
  try { chmodSync(hostScript, 0o755); } catch { /* doesn't exist yet */ }
  writeFileSync(hostScript, `#!/bin/sh\nexec node /usr/local/bin/chrome-mcp-bridge.cjs\n`);
  chmodSync(hostScript, 0o555);

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

installClaudeCode();
if (process.env.BRIDGE_ENABLED === '1') {
  setupChromeBridge();
}
disableAutoUpdater();

const sentinel = join(process.env.HOME || '/home/dev', '.claude', 'logs', '.setup-ready');
writeFileSync(sentinel, `ready ${Date.now() / 1000}\n`);
log('Setup complete — sentinel written');
