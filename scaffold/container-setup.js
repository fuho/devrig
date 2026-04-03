#!/usr/bin/env node
/**
 * container-setup.js — Runs INSIDE the Docker container.
 * Installs/updates Claude Code and sets up the Chrome browser bridge.
 * Ported from container-setup.py.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const NPM_PKG = '@anthropic-ai/claude-code';
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

function installClaudeCodeNpm() {
  const prefix = process.env.NPM_CONFIG_PREFIX;
  const pkgDir = join(prefix, 'lib/node_modules/@anthropic-ai/claude-code');
  const tempPattern = join(prefix, 'lib/node_modules/@anthropic-ai');

  function cleanupStale() {
    if (existsSync(pkgDir)) {
      log(`Removing stale install: ${pkgDir}`);
      rmSync(pkgDir, { recursive: true, force: true });
    }
    // Clean temp dirs
    try {
      for (const d of readdirSync(tempPattern)) {
        if (d.startsWith('.claude-code-')) {
          const full = join(tempPattern, d);
          log(`Removing temp dir: ${full}`);
          rmSync(full, { recursive: true, force: true });
        }
      }
    } catch { /* dir may not exist */ }
  }

  if (which('claude')) {
    log(`claude found: ${claudeVersion()}`);
    execFileSync('npm', ['update', '-g', NPM_PKG], { stdio: 'ignore' });
    log(`claude after update: ${claudeVersion()}`);
    return;
  }

  log(`claude not found — installing ${NPM_PKG}`);
  cleanupStale();
  try {
    execFileSync('npm', ['install', '-g', NPM_PKG], { stdio: 'inherit' });
  } catch {
    log('First install attempt failed — cleaning cache and retrying');
    execFileSync('npm', ['cache', 'clean', '--force'], { stdio: 'ignore' });
    cleanupStale();
    execFileSync('npm', ['install', '-g', NPM_PKG], { stdio: 'inherit' });
  }
  log(`Installed: ${claudeVersion()}`);
}

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
  const method = process.env.CLAUDE_INSTALL_METHOD || 'npm';
  if (method === 'native') {
    installClaudeCodeNative();
  } else {
    installClaudeCodeNpm();
  }
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
}

// -- Main --------------------------------------------------------------------

installClaudeCode();
setupChromeBridge();

const sentinel = join(process.env.HOME || '/home/dev', '.claude', 'logs', '.setup-ready');
writeFileSync(sentinel, `ready ${Date.now() / 1000}\n`);
log('Setup complete — sentinel written');
