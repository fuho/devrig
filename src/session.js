// @ts-check
/**
 * session.js — Session lock, stop, status, and scaffold staleness.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { log, die } from './log.js';
import { getPackageVersion } from './config.js';

const SESSION_FILE = 'session.json';

/** Returns the path to the session lock file. */
function sessionPath(projectDir) {
  return join(projectDir, '.devrig', SESSION_FILE);
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Reads and parses the session lock file. Returns null if missing or corrupt. */
export function readSession(projectDir) {
  try {
    return JSON.parse(readFileSync(sessionPath(projectDir), 'utf8'));
  } catch {
    return null;
  }
}

/** Checks if the session's PID is still running. */
export function isSessionAlive(session) {
  if (!session || !session.pid) return false;
  try {
    process.kill(session.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Writes session lock file. Dies if another live session holds the lock. */
export function acquireSession(projectDir, info) {
  const path = sessionPath(projectDir);
  const existing = readSession(projectDir);

  if (existing && existing.pid !== info.pid && isSessionAlive(existing)) {
    die(`Another devrig session is running (PID ${existing.pid}). Use "devrig stop" first.`);
  }

  if (existing && existing.pid !== info.pid) {
    log(`WARNING: Removing stale session lock (PID ${existing.pid})`);
  }

  try {
    writeFileSync(path, JSON.stringify(info, null, 2) + '\n');
  } catch (err) {
    die(`Failed to write session lock: ${err.message}`);
  }
}

/** Removes the session lock file. Ignores missing file. */
export function releaseSession(projectDir) {
  try {
    unlinkSync(sessionPath(projectDir));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Stops a running session: kills child processes, tears down container, removes lock. */
export function stopSession(projectDir) {
  const session = readSession(projectDir);
  if (!session) {
    log('No active session.');
    return;
  }

  if (!isSessionAlive(session)) {
    log(`Stale session lock found (PID ${session.pid}). Cleaning up.`);
    releaseSession(projectDir);
    return;
  }

  // Kill bridge and dev server if recorded
  for (const key of ['bridgePid', 'devServerPid']) {
    if (session[key]) {
      try {
        process.kill(session[key], 'SIGTERM');
        log(`Stopped ${key === 'bridgePid' ? 'bridge' : 'dev server'} (PID ${session[key]})`);
      } catch {
        /* already dead */
      }
    }
  }

  // Docker compose down
  if (session.composeArgs && session.composeArgs.length > 0) {
    log('Stopping Docker container...');
    try {
      execFileSync('docker', session.composeArgs.concat('down'), {
        timeout: 30000,
        stdio: 'ignore',
      });
    } catch {
      /* ignore */
    }
  }

  // Kill main process last
  try {
    process.kill(session.pid, 'SIGTERM');
  } catch {
    /* already dead */
  }

  releaseSession(projectDir);
  log('Session stopped.');
}

/** Prints the status of all session components to stdout. */
export function showStatus(projectDir) {
  const session = readSession(projectDir);
  if (!session) {
    log('No active session.');
    return;
  }

  const alive = isSessionAlive(session);
  log(`Status for: ${session.project}`);
  console.log(`  Session PID:  ${session.pid} (${alive ? 'running' : 'dead'})`);
  console.log(`  Started:      ${session.startedAt}`);

  // Container status
  if (session.composeArgs && session.composeArgs.length > 0) {
    let containerRunning = false;
    try {
      const out = execFileSync('docker', session.composeArgs.concat('ps', '-q'), {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      containerRunning = out.length > 0;
    } catch {
      /* ignore */
    }
    console.log(`  Container:    ${containerRunning ? 'running' : 'stopped'}`);
  }

  // Bridge
  if (session.bridgePort) {
    const bridgeAlive = session.bridgePid ? pidAlive(session.bridgePid) : false;
    console.log(
      `  Bridge:       port ${session.bridgePort} (${bridgeAlive ? 'running' : 'stopped'})`,
    );
  }

  // Dev server
  if (session.devServerPort) {
    const devAlive = session.devServerPid ? pidAlive(session.devServerPid) : false;
    console.log(
      `  Dev server:   port ${session.devServerPort} (${devAlive ? 'running' : 'stopped'})`,
    );
  }

  if (!alive) {
    console.log('');
    log('Session PID is dead. Run "devrig stop" to clean up.');
  }
}

/** Returns true if the given PID is running. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

/** Warns if scaffold version differs from installed package version. */
export function checkScaffoldStaleness(projectDir) {
  const versionFile = join(projectDir, '.devrig', '.devrig-version');
  if (!existsSync(versionFile)) return;

  try {
    const scaffoldVersion = readFileSync(versionFile, 'utf8').trim();
    const currentVersion = getPackageVersion();
    if (scaffoldVersion !== currentVersion) {
      log(
        `WARNING: Scaffold files were created with v${scaffoldVersion} but devrig v${currentVersion} is installed. Run "devrig init" to update.`,
      );
    }
  } catch {
    /* ignore read errors */
  }
}
