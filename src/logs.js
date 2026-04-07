// @ts-check
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { log } from './log.js';
import { resolveProjectDir } from './config.js';
import { readSession } from './session.js';

/**
 * Reads the dev server log file and returns lines.
 * @param {string} projectDir
 * @returns {string[]}
 */
export function readDevServerLog(projectDir) {
  const logPath = join(projectDir, '.devrig', 'logs', 'dev-server.log');
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

/**
 * Builds the docker compose logs command args from session info.
 * @param {{ composeArgs: string[] }} session
 * @param {{ follow: boolean }} opts
 * @returns {string[]}
 */
export function buildDockerLogsArgs(session, opts) {
  const args = [...session.composeArgs, 'logs'];
  if (opts.follow) args.push('--follow');
  args.push('dev');
  return args;
}

/**
 * Main logs command handler.
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
export async function logs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dev-server': { type: 'boolean', default: false },
      container: { type: 'boolean', default: false },
      follow: { type: 'boolean', short: 'f', default: false },
    },
    strict: true,
  });
  const devServer = values['dev-server'];
  const container = values.container;
  const follow = values.follow;

  const projectDir = resolveProjectDir();

  if (devServer || (!devServer && !container)) {
    const lines = readDevServerLog(projectDir);
    if (lines.length > 0) {
      log('Dev server logs:');
      for (const line of lines) console.log(line);
    } else {
      log('No dev server logs found.');
    }
  }

  if (container || (!devServer && !container)) {
    const session = readSession(projectDir);
    if (!session || !session.composeArgs) {
      log('No active session — cannot read container logs.');
      return;
    }

    log('Container logs:');
    const args = buildDockerLogsArgs(session, { follow });
    const child = spawn('docker', args, { stdio: 'inherit' });
    await new Promise((resolve) => child.on('exit', resolve));
  }
}
