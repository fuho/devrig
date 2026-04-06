// @ts-check
import { spawn } from 'node:child_process';
import { log, die } from './log.js';
import { resolveProjectDir } from './config.js';
import { readSession, isSessionAlive } from './session.js';

/**
 * Validates that a session exists and is running.
 * @param {string} projectDir
 * @returns {{ ok: boolean, session?: object, error?: string }}
 */
export function validateSession(projectDir) {
  const session = readSession(projectDir);
  if (!session) {
    return { ok: false, error: 'No active session. Run "devrig start" first.' };
  }
  if (!isSessionAlive(session)) {
    return {
      ok: false,
      error: 'Session is not running (PID stopped). Run "devrig stop" then "devrig start".',
    };
  }
  return { ok: true, session };
}

/**
 * Builds the docker compose exec args from session info.
 * @param {{ composeArgs: string[] }} session
 * @returns {string[]}
 */
export function buildExecArgs(session) {
  return [...session.composeArgs, 'exec', '-it', 'dev', 'bash'];
}

/**
 * Main exec command handler.
 * @returns {Promise<void>}
 */
export async function exec() {
  const projectDir = resolveProjectDir();
  const result = validateSession(projectDir);

  if (!result.ok) {
    return die(result.error);
  }

  log('Re-attaching to running container...');
  const { session } = result;
  const args = buildExecArgs(session);
  const child = spawn('docker', args, { stdio: 'inherit' });

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
  });

  process.exit(exitCode);
}
