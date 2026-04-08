// @ts-check
/**
 * env.js — Named environment CRUD operations.
 *
 * Environments live at ~/.devrig/environments/{name}/ and hold scaffold files
 * plus a shared Claude Code home directory. The special name "local" means
 * the environment lives in the project's own .devrig/ directory.
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { log, die } from './log.js';
import { getPackageVersion } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root directory for all named environments. */
const ENVIRONMENTS_ROOT = join(homedir(), '.devrig', 'environments');

/** Files copied from scaffold/ into a new environment. */
const ENV_SCAFFOLD_FILES = [
  '.dockerignore',
  'Dockerfile',
  'chrome-mcp-bridge.cjs',
  'compose.yml',
  'container-setup.js',
  'entrypoint.sh',
  'firewall.sh',
  'setup.html',
];

/** Directories copied from scaffold/ into a new environment. */
const ENV_SCAFFOLD_DIRS = ['mitmproxy'];

/**
 * Returns the absolute path for a named environment.
 * "local" is not resolved here — callers must handle it separately.
 * @param {string} name
 * @param {string} [root] - Override environments root (for testing).
 * @returns {string}
 */
export function envDir(name, root = ENVIRONMENTS_ROOT) {
  if (name === 'local') {
    die('envDir() should not be called with "local" — use the project .devrig/ path directly.');
  }
  return join(root, name);
}

/**
 * Ensures a named environment exists with scaffold files and home directory.
 * Creates it if missing. Updates scaffold files if the version marker differs.
 * @param {string} name
 * @param {string} [root] - Override environments root (for testing).
 * @returns {string} The absolute path to the environment directory.
 */
export function ensureEnv(name, root = ENVIRONMENTS_ROOT) {
  const dir = envDir(name, root);
  const scaffoldDir = join(__dirname, '..', 'scaffold');
  const version = getPackageVersion();
  const versionFile = join(dir, '.devrig-version');

  // Check if already up to date
  if (existsSync(versionFile)) {
    const existing = readFileSync(versionFile, 'utf8').trim();
    if (existing === version) return dir;
    log(`Updating environment "${name}" from v${existing} to v${version}...`);
  } else if (existsSync(dir)) {
    log(`Updating environment "${name}" to v${version}...`);
  } else {
    log(`Creating environment "${name}"...`);
  }

  // Create directory structure
  mkdirSync(join(dir, 'home', '.claude', 'logs'), { recursive: true });

  // Copy scaffold files
  for (const file of ENV_SCAFFOLD_FILES) {
    const src = join(scaffoldDir, file);
    if (existsSync(src)) {
      cpSync(src, join(dir, file));
    }
  }

  // Copy scaffold directories
  for (const subdir of ENV_SCAFFOLD_DIRS) {
    const src = join(scaffoldDir, subdir);
    if (existsSync(src)) {
      cpSync(src, join(dir, subdir), { recursive: true });
    }
  }

  // Write version marker
  writeFileSync(versionFile, version + '\n');

  return dir;
}

/**
 * Lists all named environments.
 * @param {string} [root] - Override environments root (for testing).
 * @returns {{ name: string, path: string, version: string | null }[]}
 */
export function listEnvs(root = ENVIRONMENTS_ROOT) {
  if (!existsSync(root)) return [];

  const entries = readdirSync(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const path = join(root, e.name);
      const versionFile = join(path, '.devrig-version');
      let version = null;
      try {
        version = readFileSync(versionFile, 'utf8').trim();
      } catch {
        /* no version marker */
      }
      return { name: e.name, path, version };
    });
}

/**
 * Deletes a named environment. Refuses if any active session references it.
 * @param {string} name
 * @param {string} [root] - Override environments root (for testing).
 */
export function deleteEnv(name, root = ENVIRONMENTS_ROOT) {
  const dir = envDir(name, root);
  if (!existsSync(dir)) {
    die(`Environment "${name}" does not exist.`);
  }

  rmSync(dir, { recursive: true, force: true });
  log(`Deleted environment "${name}".`);
}

/**
 * Shows information about an environment.
 * @param {string} name
 * @param {string} [root] - Override environments root (for testing).
 */
export function inspectEnv(name, root = ENVIRONMENTS_ROOT) {
  const dir = envDir(name, root);
  if (!existsSync(dir)) {
    die(`Environment "${name}" does not exist.`);
  }

  const versionFile = join(dir, '.devrig-version');
  const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : 'unknown';

  log(`Environment: ${name}`);
  console.log(`  Path:     ${dir}`);
  console.log(`  Version:  ${version}`);

  // Disk usage (rough estimate)
  const size = dirSize(dir);
  console.log(`  Size:     ${formatBytes(size)}`);

  // Check for Claude auth
  const claudeDir = join(dir, 'home', '.claude');
  const hasAuth = existsSync(join(claudeDir, 'settings.json'));
  console.log(`  Auth:     ${hasAuth ? 'configured' : 'not configured'}`);
}

/**
 * Recursively calculates directory size in bytes.
 * @param {string} dir
 * @returns {number}
 */
function dirSize(dir) {
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(fullPath);
      } else {
        try {
          total += statSync(fullPath).size;
        } catch {
          /* skip unreadable files */
        }
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return total;
}

/**
 * Formats bytes into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Dispatches `devrig env` subcommands.
 * @param {string[]} argv
 */
export async function envCommand(argv) {
  const sub = argv[0];

  switch (sub) {
    case 'list':
    case 'ls': {
      const envs = listEnvs();
      if (envs.length === 0) {
        log('No environments found. Run "devrig init" to create one.');
      } else {
        log(`${envs.length} environment(s):`);
        for (const env of envs) {
          const ver = env.version ? `v${env.version}` : 'no version';
          console.log(`  ${env.name.padEnd(20)} ${ver.padEnd(12)} ${env.path}`);
        }
      }
      break;
    }

    case 'create': {
      const name = argv[1];
      if (!name) die('Usage: devrig env create <name>');
      const dir = ensureEnv(name);
      log(`Environment "${name}" ready at ${dir}`);
      break;
    }

    case 'inspect': {
      const name = argv[1] || 'default';
      inspectEnv(name);
      break;
    }

    case 'delete':
    case 'rm': {
      const name = argv[1];
      if (!name) die('Usage: devrig env delete <name>');
      if (name === 'default') {
        die(
          'Cannot delete the "default" environment. Use "devrig env delete <name>" for named environments.',
        );
      }
      deleteEnv(name);
      break;
    }

    default:
      console.log(`Usage: devrig env <command>

Commands:
  list              List all environments
  create <name>     Create a new environment
  inspect [name]    Show environment details (default: "default")
  delete <name>     Delete a named environment`);
      break;
  }
}
