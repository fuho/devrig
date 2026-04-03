import { execFileSync } from 'node:child_process';
import { log } from './log.js';

const procs = new Map();
let composeArgs = [];
let cleanupDone = false;

export function registerProcess(name, proc) {
  procs.set(name, proc);
}

export function setComposeArgs(args) {
  composeArgs = args;
}

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
  await Promise.all([...procs.entries()].map(([, proc]) => {
    if (proc.exitCode !== null) return;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 5000);
      proc.on('exit', () => { clearTimeout(timer); resolve(); });
    });
  }));

  log('Stopping Docker container...');
  try {
    execFileSync('docker', composeArgs.concat('down'), { timeout: 30000, stdio: 'ignore' });
  } catch { /* ignore */ }

  log('Done.');
}

export function setupSignalHandlers() {
  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });
}

export function disableSignalHandlers(child) {
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch {} });
}
