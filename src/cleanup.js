// @ts-check
import { execFileSync } from 'node:child_process';
import { log } from './log.js';
import { releaseSession } from './session.js';

const procs = new Map();
let composeArgs = [];
let cleanupDone = false;

/** Registers a spawned process for cleanup on exit. */
export function registerProcess(name, proc) {
  procs.set(name, proc);
}

/** Stores docker compose arguments for container teardown. */
export function setComposeArgs(args) {
  composeArgs = args;
}

/** Terminates all registered processes and stops the Docker container. */
export async function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;

  log('Shutting down...');

  for (const [name, proc] of procs) {
    if (proc.exitCode === null) {
      log(`Stopping ${name} (PID ${proc.pid})`);
      proc.kill('SIGTERM');
    }
  }

  // Wait up to 5s for each, SIGKILL stragglers
  await Promise.all(
    [...procs.entries()].map(([, proc]) => {
      if (proc.exitCode !== null) return;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 5000);
        proc.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }),
  );

  log('Stopping Docker container...');
  try {
    execFileSync('docker', composeArgs.concat('down'), { timeout: 30000, stdio: 'ignore' });
  } catch {
    /* ignore */
  }

  try {
    releaseSession(process.cwd());
  } catch {
    /* ignore */
  }

  log('Done.');
}

/** Installs SIGINT/SIGTERM handlers that trigger cleanup. */
export function setupSignalHandlers() {
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(143);
  });
}

/** Removes signal handlers so a child process owns the terminal. */
export function disableSignalHandlers(child) {
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {
    try {
      child.kill('SIGTERM');
    } catch {}
  });
}
