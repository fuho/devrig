// @ts-check
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { log } from './log.js';
import { resolveProjectDir, parseTOML, resolveEnvDir } from './config.js';
import { readSession } from './session.js';

/**
 * Shows mitmproxy network traffic log locations and opens the web UI hint.
 * @param {string} projectDir
 */
export function showNetworkLogs(projectDir) {
  // Safely determine environment dir without die()
  let envDir = join(projectDir, '.devrig');
  try {
    const tomlPath = join(projectDir, 'devrig.toml');
    if (existsSync(tomlPath)) {
      const raw = parseTOML(readFileSync(tomlPath, 'utf8'));
      const environment = raw.environment ?? 'default';
      envDir = resolveEnvDir({ environment }, projectDir);
    }
  } catch {
    /* fall back to .devrig/ */
  }

  const mitmLogsDir = join(envDir, 'mitmproxy', 'logs');

  log('Network traffic inspection:');
  console.log('');
  console.log('  Web UI:     http://localhost:8081  (password: devrig)');
  console.log(`  Log dir:    ${mitmLogsDir}`);
  console.log('');

  if (existsSync(mitmLogsDir)) {
    try {
      const files = readdirSync(mitmLogsDir)
        .filter((f) => f.endsWith('.mitm'))
        .sort()
        .reverse()
        .slice(0, 5);
      if (files.length > 0) {
        log('Recent capture files:');
        for (const f of files) {
          console.log(`  ${f}`);
        }
        console.log('');
        console.log('  Analyze: mitmproxy -r <file>');
        console.log('  Convert: mitmdump -r <file> --set hardump=output.har');
      } else {
        log('No capture files yet. Start a session with "devrig start".');
      }
    } catch {
      log('Could not read mitmproxy log directory.');
    }
  } else {
    log('No mitmproxy logs found. Network logging starts with "devrig start".');
  }
}

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
      network: { type: 'boolean', default: false },
      follow: { type: 'boolean', short: 'f', default: false },
    },
    strict: true,
  });
  const devServer = values['dev-server'];
  const container = values.container;
  const network = values.network;
  const follow = values.follow;

  const projectDir = resolveProjectDir();

  // Network traffic logs from mitmproxy
  if (network) {
    showNetworkLogs(projectDir);
    return;
  }

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
