// @ts-check
/**
 * env.js — Shared environment operations.
 *
 * The shared environment lives at ~/.devrig/shared/ and holds scaffold files
 * plus a shared Claude Code home directory. The special name "local" means
 * the environment lives in the project's own .devrig/ directory.
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  readdirSync,
  renameSync,
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

/** Root directory for devrig home. */
const DEVRIG_HOME = join(homedir(), '.devrig');

/** Files copied from scaffold/ into a new environment. */
const ENV_SCAFFOLD_FILES = [
  '.dockerignore',
  'Dockerfile',
  'Dockerfile.mitmproxy',
  'chrome-mcp-bridge.cjs',
  'compose.yml',
  'container-setup.js',
  'entrypoint.sh',
  'firewall.sh',
  'traffic.html',
];

/** Directories copied from scaffold/ into a new environment. */
const ENV_SCAFFOLD_DIRS = ['mitmproxy'];

/**
 * Ensures the shared environment exists with scaffold files and home directory.
 * Creates it if missing. Updates scaffold files if the version marker differs.
 * Migrates legacy ~/.devrig/environments/default/ to ~/.devrig/shared/ if needed.
 * @param {string} [root] - Override devrig home (for testing).
 * @returns {string} The absolute path to the shared environment directory.
 */
export function ensureSharedEnv(root = DEVRIG_HOME) {
  const sharedDir = join(root, 'shared');

  // Migration: rename legacy environments/default/ to shared/
  const legacyDefault = join(root, 'environments', 'default');
  if (!existsSync(sharedDir) && existsSync(legacyDefault)) {
    log('Migrating environment "default" \u2192 shared...');
    mkdirSync(dirname(sharedDir), { recursive: true });
    renameSync(legacyDefault, sharedDir);
  }

  // Warn about orphaned named environments
  const legacyEnvs = join(root, 'environments');
  if (existsSync(legacyEnvs)) {
    try {
      const remaining = readdirSync(legacyEnvs).filter(d => d !== '.DS_Store');
      if (remaining.length > 0) {
        log(`WARNING: Orphaned environments found: ${remaining.join(', ')}. Back up ~/.devrig/environments/ if needed.`);
      }
    } catch {
      /* ignore read errors */
    }
  }

  const scaffoldDir = join(__dirname, '..', 'scaffold');
  const version = getPackageVersion();
  const versionFile = join(sharedDir, '.devrig-version');

  // Check if already up to date
  if (existsSync(versionFile)) {
    const existing = readFileSync(versionFile, 'utf8').trim();
    if (existing === version) return sharedDir;
    log(`Updating shared environment from v${existing} to v${version}...`);
  } else if (existsSync(sharedDir)) {
    log(`Updating shared environment to v${version}...`);
  } else {
    log('Creating shared environment...');
  }

  // Create directory structure
  mkdirSync(join(sharedDir, 'home', '.claude', 'logs'), { recursive: true });
  mkdirSync(join(sharedDir, 'mitmproxy', 'logs'), { recursive: true });
  mkdirSync(join(sharedDir, 'rules'), { recursive: true });

  // Copy scaffold files
  for (const file of ENV_SCAFFOLD_FILES) {
    const src = join(scaffoldDir, file);
    if (existsSync(src)) {
      cpSync(src, join(sharedDir, file));
    }
  }

  // Copy scaffold directories
  for (const subdir of ENV_SCAFFOLD_DIRS) {
    const src = join(scaffoldDir, subdir);
    if (existsSync(src)) {
      cpSync(src, join(sharedDir, subdir), { recursive: true });
    }
  }

  // Write version marker
  writeFileSync(versionFile, version + '\n');

  return sharedDir;
}

/**
 * Shows information about the shared environment.
 * @param {string} [root] - Override devrig home (for testing).
 */
export function inspectSharedEnv(root = DEVRIG_HOME) {
  const dir = join(root, 'shared');
  if (!existsSync(dir)) {
    die('Shared environment does not exist. Run "devrig init" to create one.');
  }

  const versionFile = join(dir, '.devrig-version');
  const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : 'unknown';

  log('Environment: shared');
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

const envSubcommandHelp = {
  reset: `Re-copy scaffold files while preserving Claude auth and memories.

Useful after upgrading devrig or if scaffold files were corrupted.
The home/ directory (auth tokens, memories, settings) is untouched.

Usage:
  devrig env reset

Example:
  devrig env reset`,

  inspect: `Show details about the shared environment.

Displays path, version, auth status, and disk usage.

Usage:
  devrig env inspect

Example:
  devrig env inspect`,
};

/**
 * Dispatches `devrig env` subcommands.
 * @param {string[]} argv
 */
export async function envCommand(argv) {
  const sub = argv[0];

  // Per-subcommand help
  if (sub && (argv.includes('--help') || argv.includes('-h'))) {
    if (sub in envSubcommandHelp) {
      console.log(`Usage: devrig env ${sub}\n`);
      console.log(envSubcommandHelp[sub]);
      return;
    }
  }

  switch (sub) {
    case 'inspect': {
      inspectSharedEnv();
      break;
    }

    case 'reset': {
      const dir = join(DEVRIG_HOME, 'shared');
      if (existsSync(dir)) {
        log('Resetting shared environment (preserving home/)...');
      }
      // Force re-copy by removing the version marker
      const versionFile = join(dir, '.devrig-version');
      if (existsSync(versionFile)) {
        rmSync(versionFile);
      }
      const result = ensureSharedEnv();
      log(`Shared environment reset at ${result}`);
      break;
    }

    default:
      console.log(`Usage: devrig env <command>

Commands:
  inspect     Show shared environment details
  reset       Re-copy scaffold files (preserves Claude auth/memories)`);
      break;
  }
}
