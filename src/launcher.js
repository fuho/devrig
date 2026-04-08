// @ts-check
/**
 * launcher.js — Main orchestrator for devrig.
 * Ported from Python launcher.py.
 * ESM module exporting a single launch(argv) async function.
 */

import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  openSync,
  closeSync,
  readSync,
  fstatSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { log, die, verbose } from './log.js';
import { loadConfig, loadDotenv, resolveProjectDir, resolveEnvDir } from './config.js';
import { composeCmd, buildHash, needsRebuild, startContainer, initVariant } from './docker.js';
import { ensureEnv } from './env.js';
import { openBrowser } from './browser.js';
import {
  registerProcess,
  setComposeArgs,
  setProjectDir,
  cleanup,
  setupSignalHandlers,
  disableSignalHandlers,
} from './cleanup.js';
import { acquireSession, checkScaffoldStaleness } from './session.js';
import { generateClaudeMd } from './init.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Incrementally print new lines from a log file since lastPos.
 * Returns the new position in the file.
 */
function printNewLogLines(logPath, lastPos) {
  if (!existsSync(logPath)) return lastPos;
  try {
    const fd = openSync(logPath, 'r');
    const stat = fstatSync(fd);
    if (stat.size <= lastPos) {
      closeSync(fd);
      return lastPos;
    }
    const buf = Buffer.alloc(stat.size - lastPos);
    readSync(fd, buf, 0, buf.length, lastPos);
    closeSync(fd);
    for (const line of buf.toString('utf8').split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed) console.log(`  [container] ${trimmed}`);
    }
    return lastPos + buf.length;
  } catch {
    return lastPos;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Main orchestrator: builds container, starts services, connects to Claude Code. */
export async function launch(argv) {
  // -- Step 1: Resolve project directory (launcher.py: resolve project dir) --
  const projectDir = resolveProjectDir();

  // -- Step 2: Load configuration (launcher.py: load config) ----------------
  const cfg = loadConfig(projectDir);

  // -- Step 2b: Resolve environment directory --------------------------------
  const envDirPath = resolveEnvDir(cfg, projectDir);
  if (cfg.environment !== 'local') {
    ensureEnv(cfg.environment);
    verbose(`Using environment "${cfg.environment}" at ${envDirPath}`);
  }

  // -- Step 2b2: Scaffold staleness check ------------------------------------
  checkScaffoldStaleness(projectDir, envDirPath);

  // -- Step 2c: Regenerate container CLAUDE.md before compose up ---------------
  try {
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not regenerate container CLAUDE.md');
  }

  // -- Step 3: Parse CLI flags (launcher.py: parse arguments) ---------------
  const { values: args } = parseArgs({
    args: argv,
    options: {
      rebuild: { type: 'boolean', default: false },
      'no-chrome': { type: 'boolean', default: false },
      'no-dev-server': { type: 'boolean', default: false },
    },
    strict: true,
  });
  verbose('start flags: ' + JSON.stringify(args));

  // -- Step 4: Initialize variant (launcher.py: init variant) ---------------
  const ctx = initVariant(cfg, envDirPath);

  // -- Step 5: Load dotenv and set project env var -------------------------
  loadDotenv(projectDir);
  process.env.DEVRIG_PROJECT = cfg.project;
  process.env.DEVRIG_ENV_DIR = envDirPath;
  process.env.DEVRIG_DEV_PORT = String(cfg.dev_server_port);

  // -- Step 6: Change to project directory and set host UID ----------------
  process.chdir(projectDir);
  setProjectDir(projectDir);
  process.env.HOST_UID = String(userInfo().uid);
  process.env.HOST_GID = String(userInfo().gid);
  process.env.CLAUDE_VERSION = cfg.claude_version;
  process.env.BRIDGE_ENABLED = cfg.bridge_enabled ? '1' : '0';

  // -- Step 7: Preflight checks (launcher.py: preflight) --------------------

  // Check docker binary
  try {
    execFileSync('sh', ['-c', 'command -v docker'], { stdio: 'ignore' });
  } catch {
    die('Docker is not installed or not in PATH.');
  }

  // Check node binary
  try {
    execFileSync('sh', ['-c', 'command -v node'], { stdio: 'ignore' });
  } catch {
    die('Node.js is not installed or not in PATH.');
  }

  // Check Docker daemon is running
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
  } catch {
    die('Docker daemon is not running. Please start Docker and try again.');
  }

  // If dev server enabled and not skipped, verify its command is available
  if (cfg.dev_server_cmd && !args['no-dev-server']) {
    const devBin = cfg.dev_server_cmd.split(/\s+/)[0];
    try {
      execFileSync('sh', ['-c', `command -v ${devBin}`], { stdio: 'ignore' });
    } catch {
      die(`Dev server command '${devBin}' not found in PATH.`);
    }
  }

  // Warn if .env is missing
  if (!existsSync(join(projectDir, '.env'))) {
    log('WARNING: .env not found');
  }

  // -- Step 7b: Acquire session lock ------------------------------------------
  const sessionInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    project: cfg.project,
    bridgePort: cfg.bridge_enabled ? cfg.bridge_port : null,
    devServerPort: cfg.dev_server_cmd ? cfg.dev_server_port : null,
    bridgePid: null,
    devServerPid: null,
    composeArgs: composeCmd(ctx).slice(1),
  };
  acquireSession(projectDir, sessionInfo);

  // -- Step 8: Signal handlers & compose args -------------------------------
  setupSignalHandlers();
  setComposeArgs(sessionInfo.composeArgs);

  // -- Step 9: Build / rebuild Docker image ---------------------------------
  const rebuild = args.rebuild || needsRebuild(ctx);
  if (rebuild) {
    const reason = args.rebuild ? 'forced' : 'files changed';
    log(`Building Docker image (${reason})...`);
    const cmd = composeCmd(ctx, 'build', '--build-arg', `BUILD_HASH=${buildHash(ctx)}`);
    execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
    log('Build complete.');
  }

  // -- Step 9b: Ensure Claude settings has Chrome MCP config (host side) ----
  const homeDir = join(envDirPath, 'home');
  if (cfg.bridge_enabled && !args['no-chrome']) {
    const claudeDir = join(homeDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');
    let settings = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      } catch {
        /* start fresh */
      }
    }
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers['claude-in-chrome'] = {
      type: 'stdio',
      command: '/home/dev/.claude/chrome/chrome-native-host',
    };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  // -- Step 9c: Ensure container home dirs exist (host-created so ownership matches) --
  mkdirSync(join(homeDir, '.claude', 'logs'), { recursive: true });

  // -- Step 10: Start container (launcher.py: start container) --------------
  startContainer(ctx);

  // Prepare logs directory (used by bridge & dev server)
  const logsDir = join(projectDir, '.devrig', 'logs');
  mkdirSync(logsDir, { recursive: true });

  // -- Step 11: Start Chrome bridge (launcher.py: chrome bridge) ------------
  if (cfg.bridge_enabled && !args['no-chrome']) {
    const bridgeScript = join(dirname(fileURLToPath(import.meta.url)), 'bridge-host.cjs');
    const stderrFd = openSync(join(logsDir, 'bridge-host.err'), 'w');
    const bridgeProc = spawn('node', [bridgeScript], {
      stdio: ['ignore', 'inherit', stderrFd],
      env: {
        ...process.env,
        BRIDGE_LOG_DIR: logsDir,
        BRIDGE_PORT: String(cfg.bridge_port),
      },
    });
    closeSync(stderrFd);
    registerProcess('bridge', bridgeProc);

    // Give bridge a moment to start, then verify it's still alive
    await sleep(1000);
    if (bridgeProc.exitCode !== null) {
      die(
        `Chrome bridge failed to start — port ${cfg.bridge_port} may be in use.\n  Try: lsof -i :${cfg.bridge_port} to see what's using it`,
      );
    }
    log(`Chrome bridge started on port ${cfg.bridge_port}`);
    sessionInfo.bridgePid = bridgeProc.pid;
  }

  // -- Step 12: Start dev server (launcher.py: dev server) ------------------
  if (cfg.dev_server_cmd && !args['no-dev-server']) {
    log(`Starting dev server: ${cfg.dev_server_cmd}`);
    const devLogFd = openSync(join(logsDir, 'dev-server.log'), 'w');
    const devProc = spawn('sh', ['-c', cfg.dev_server_cmd], {
      stdio: ['ignore', devLogFd, devLogFd],
      env: { ...process.env, PORT: String(cfg.dev_server_port) },
    });
    closeSync(devLogFd);
    registerProcess('dev server', devProc);
    sessionInfo.devServerPid = devProc.pid;

    // Poll for dev server readiness
    const devUrl = `http://localhost:${cfg.dev_server_port}`;
    let devReady = false;
    for (let i = 0; i < cfg.dev_server_timeout; i++) {
      if (devProc.exitCode !== null) die('Dev server exited unexpectedly');
      try {
        await fetch(devUrl, { signal: AbortSignal.timeout(1000) });
        log(`Dev server ready at ${devUrl}`);
        log(`Routed via Traefik: http://${cfg.project}.localhost:8000`);
        devReady = true;
        break;
      } catch {
        await sleep(1000);
      }
    }
    if (!devReady) {
      log(
        `WARNING: Dev server not reachable at localhost:${cfg.dev_server_port} after ${cfg.dev_server_timeout}s — Claude can still work but won't see your app in the browser`,
      );
    }

    // -- Step 13: Open browser (launcher.py: open browser) ------------------
    if (!args['no-chrome']) {
      log('Opening browser...');
      openBrowser(`http://${cfg.project}.localhost/devrig/setup`);
    }
  }

  // -- Step 13b: Update session with child PIDs ------------------------------
  acquireSession(projectDir, sessionInfo);

  // -- Step 14: Wait for Claude readiness (launcher.py: wait for claude) ----
  const sentinel = join(homeDir, '.claude', 'logs', '.setup-ready');
  const entrypointLog = join(homeDir, '.claude', 'logs', 'entrypoint.log');

  log('Waiting for Claude Code to be ready in container...');
  let logPos = 0;
  if (existsSync(entrypointLog)) logPos = statSync(entrypointLog).size;

  const timeout = cfg.claude_timeout;
  const start = Date.now();
  while (Date.now() - start < timeout * 1000) {
    if (existsSync(sentinel)) {
      printNewLogLines(entrypointLog, logPos);
      log('Claude Code is ready.');
      break;
    }
    logPos = printNewLogLines(entrypointLog, logPos);
    await sleep(500);
  }

  if (!existsSync(sentinel)) {
    die(`Claude Code not ready after ${timeout}s`);
  }

  // -- Step 14b: Wait for a live Chrome NMH socket before connecting ---------
  if (cfg.bridge_enabled && !args['no-chrome']) {
    const sockDir = `/tmp/claude-mcp-browser-bridge-${userInfo().username}`;
    const sockTimeout = 15; // seconds
    let sockFound = false;
    verbose(`Waiting up to ${sockTimeout}s for live NMH socket in ${sockDir}`);

    /** Try to connect to a socket; resolve true if it accepts, false otherwise. */
    const isSocketAlive = (sockPath) =>
      new Promise((resolve) => {
        const conn = net.createConnection(sockPath, () => {
          conn.destroy();
          resolve(true);
        });
        conn.on('error', () => resolve(false));
        conn.setTimeout(500, () => {
          conn.destroy();
          resolve(false);
        });
      });

    for (let i = 0; i < sockTimeout; i++) {
      try {
        const socks = readdirSync(sockDir).filter((f) => f.endsWith('.sock'));
        // Check newest socket first
        for (let j = socks.length - 1; j >= 0; j--) {
          const sockPath = join(sockDir, socks[j]);
          if (await isSocketAlive(sockPath)) {
            verbose(`Live NMH socket: ${socks[j]}`);
            sockFound = true;
            break;
          } else {
            verbose(`Stale socket: ${socks[j]}`);
          }
        }
      } catch {
        /* dir doesn't exist yet */
      }
      if (sockFound) break;
      await sleep(1000);
    }
    if (!sockFound) {
      log(
        'WARNING: No live Chrome NMH socket found — Chrome MCP may not work. Is the Chrome extension enabled?',
      );
    }
  }

  // -- Step 15: Exec into container (launcher.py: exec into container) ------
  const containerId = execFileSync('docker', composeCmd(ctx, 'ps', '-q', ctx.service).slice(1), {
    encoding: 'utf8',
  }).trim();

  if (!containerId) die('Container is not running');

  const claudeParams = process.env.CLAUDE_PARAMS ? process.env.CLAUDE_PARAMS.split(/\s+/) : [];

  // Inject --chrome if bridge is running; strip it if --no-chrome was passed.
  // Claude's --chrome flag will try to overwrite chrome-native-host but our
  // container-setup.js makes it read-only (0555) so our socat relay persists.
  const bridgeRunning = cfg.bridge_enabled && !args['no-chrome'];
  if (bridgeRunning && !claudeParams.includes('--chrome')) {
    claudeParams.push('--chrome');
  } else if (!bridgeRunning) {
    const idx = claudeParams.indexOf('--chrome');
    if (idx !== -1) claudeParams.splice(idx, 1);
  }

  // Add initial prompt so Claude acts immediately on launch
  if (bridgeRunning) {
    claudeParams.push(
      'You have Chrome MCP tools. Open the dev server URL from CLAUDE.md using the Chrome tools.',
    );
  }

  // Log dashboard URLs
  log('Dashboards:');
  if (cfg.dev_server_cmd) {
    console.log(`  App:       http://${cfg.project}.localhost:8000`);
  }
  console.log(`  Traefik:   http://localhost:8080`);
  console.log(`  mitmproxy: http://localhost:8081`);

  log('Connecting to Claude Code in container...');
  log(`CLAUDE_PARAMS: ${claudeParams.join(' ') || '<none>'}`);

  const child = spawn(
    'docker',
    ['exec', '-it', '--user', 'dev', containerId, 'claude', ...claudeParams],
    {
      stdio: 'inherit',
    },
  );

  // Let the child process own the terminal — disable our signal handlers
  disableSignalHandlers(child);

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      if (signal) resolve(128);
      else resolve(code ?? 1);
    });
  });

  await cleanup();
  process.exit(exitCode);
}
