// @ts-check
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { die, log } from './log.js';

const CONFIG_FILE = 'devrig.toml';

// ---------------------------------------------------------------------------
// 1. Hand-rolled TOML parser (flat sections, string/int values only)
// ---------------------------------------------------------------------------

/** Parses flat TOML text into a nested object (sections become keys). */
export function parseTOML(text) {
  const result = {};
  let section = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (!(section in result)) result[section] = {};
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else if (/^-?\d+$/.test(value)) {
        value = parseInt(value, 10);
      }

      if (section) {
        result[section][key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 2. loadConfig(projectDir)
// ---------------------------------------------------------------------------

/** Loads devrig.toml and returns normalized config with defaults applied. */
export function loadConfig(projectDir) {
  const configPath = join(projectDir, CONFIG_FILE);

  if (!existsSync(configPath)) {
    die(`Config not found: ${configPath}\n  Run 'devrig init' to set up your project.`);
  }

  const raw = parseTOML(readFileSync(configPath, 'utf8'));

  const dev = raw.dev_server ?? {};
  const bridge = raw.chrome_bridge ?? {};
  const claude = raw.claude ?? {};

  const rawEnv = raw.environment ?? 'shared';
  const environment = rawEnv === 'local' ? 'local' : 'shared';
  if (rawEnv !== 'local' && rawEnv !== 'shared') {
    log(`Environment "${rawEnv}" normalized to "shared" — named environments are no longer supported.`);
  }

  return {
    project: raw.project ?? 'claude-project',
    tool: 'claude',  // hardcoded — devrig is Claude-only
    environment,
    bridge_enabled: 'chrome_bridge' in raw,
    bridge_port: bridge.port ?? 9229,
    dev_server_cmd: dev.command,
    dev_server_port: dev.port ?? 3000,
    dev_server_timeout: dev.ready_timeout ?? 10,
    claude_timeout: claude.ready_timeout ?? 120,
    claude_version: claude.version ?? 'latest',
  };
}

// ---------------------------------------------------------------------------
// 3. loadDotenv(projectDir)
// ---------------------------------------------------------------------------

/** Loads .env file entries into process.env. No-op if .env is missing. */
export function loadDotenv(projectDir) {
  const envPath = join(projectDir, '.env');

  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, 'utf8');

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// 4. resolveProjectDir()
// ---------------------------------------------------------------------------

/** Walks up from cwd to find devrig.toml or .devrig/. Stops at .git boundary. */
export function resolveProjectDir() {
  let dir = process.cwd();

  while (true) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    if (existsSync(join(dir, '.devrig'))) {
      try {
        if (statSync(join(dir, '.devrig')).isDirectory()) return dir;
      } catch {
        /* ignore */
      }
    }

    // Stop at .git boundary
    if (existsSync(join(dir, '.git'))) break;

    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  die(
    `Could not find ${CONFIG_FILE} or .devrig/ in any parent directory.\n  Run "devrig init" to set up your project.`,
  );
}

// ---------------------------------------------------------------------------
// 5. getPackageVersion()
// ---------------------------------------------------------------------------

/** Returns the version string from this package's package.json. */
export function getPackageVersion() {
  const thisFile = fileURLToPath(import.meta.url);
  const pkgPath = resolve(dirname(thisFile), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

// ---------------------------------------------------------------------------
// 6. resolveEnvDir(cfg, projectDir)
// ---------------------------------------------------------------------------

/**
 * Maps an environment name to an absolute directory path.
 * - "local" → join(projectDir, '.devrig')
 * - anything else → {devrigHome}/shared/
 * @param {{ environment: string }} cfg
 * @param {string} projectDir
 * @param {string} [devrigHome] - Override devrig home (for testing).
 * @returns {string}
 */
export function resolveEnvDir(
  cfg,
  projectDir,
  devrigHome = join(homedir(), '.devrig'),
) {
  if (cfg.environment === 'local') {
    return join(projectDir, '.devrig');
  }
  return join(devrigHome, 'shared');
}
