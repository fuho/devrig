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
  if (which('claude')) {
    log(`claude found: ${claudeVersion()}`);
    log('Checking for updates...');
    execFileSync('claude', ['update'], { stdio: 'ignore' });
    log(`claude after update: ${claudeVersion()}`);
    return;
  }

  log('claude not found — installing via native installer');
  execFileSync('bash', ['-c', `curl -fsSL ${NATIVE_INSTALLER_URL} | bash`], { stdio: 'inherit' });
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

  const hostScript = join(chromeDir, 'chrome-native-host');
  writeFileSync(hostScript,
    `#!/bin/bash\nexec node -e "process.stdin.pipe(require('net').connect('${sockPath}')).pipe(process.stdout)"\n`
  );
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
    command: hostScript,
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  log('Wrote MCP config for claude-in-chrome');
}

// -- Main --------------------------------------------------------------------

installClaudeCode();
setupChromeBridge();

const sentinel = join(process.env.HOME || '/home/dev', '.claude', 'logs', '.setup-ready');
writeFileSync(sentinel, `ready ${Date.now() / 1000}\n`);
log('Setup complete — sentinel written');
