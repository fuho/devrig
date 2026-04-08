// @ts-check
import {
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  mkdirSync,
  chmodSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { log, die } from './log.js';
import { resolveProjectDir, getPackageVersion, loadConfig, resolveEnvDir } from './config.js';
import { generateClaudeMd, SCAFFOLD_FILES } from './init.js';

/**
 * Compares scaffold files against the target directory (environment or .devrig/).
 * Only checks files in the SCAFFOLD_FILES whitelist.
 * @param {string} targetDir - The environment or .devrig/ directory to compare against.
 * @param {string} scaffoldDir
 * @returns {{ name: string }[]}
 */
export function findChangedFiles(targetDir, scaffoldDir) {
  const changed = [];

  for (const file of SCAFFOLD_FILES) {
    const srcPath = join(scaffoldDir, file);
    const destPath = join(targetDir, file);

    if (!existsSync(srcPath)) continue;

    if (!existsSync(destPath)) {
      changed.push({ name: file });
      continue;
    }

    const srcContent = readFileSync(srcPath);
    const destContent = readFileSync(destPath);
    if (!srcContent.equals(destContent)) {
      changed.push({ name: file });
    }
  }

  return changed;
}

/**
 * Recursively finds changed files in a scaffold directory.
 * @param {string} targetDir - The environment or .devrig/ directory.
 * @param {string} scaffoldDir - The scaffold source directory.
 * @param {string} subdir - Subdirectory name (e.g. 'mitmproxy').
 * @returns {string[]} List of relative file paths that differ.
 */
function findChangedInDir(targetDir, scaffoldDir, subdir) {
  const srcDir = join(scaffoldDir, subdir);
  const destDir = join(targetDir, subdir);
  if (!existsSync(srcDir)) return [];

  const changed = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(srcDir, fullPath);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const destPath = join(destDir, relPath);
        if (!existsSync(destPath)) {
          changed.push(join(subdir, relPath));
        } else if (!readFileSync(fullPath).equals(readFileSync(destPath))) {
          changed.push(join(subdir, relPath));
        }
      }
    }
  }

  walk(srcDir);
  return changed;
}

/**
 * Prompts the user for confirmation. Returns true if --force or user accepts.
 * @param {string} msg
 * @param {boolean} forceFlag
 * @returns {Promise<boolean>}
 */
async function confirm(msg, forceFlag) {
  if (forceFlag) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`\n  ${msg} [y/N]: `)).trim().toLowerCase();
  rl.close();
  return ans === 'y' || ans === 'yes';
}

/**
 * Main update command handler.
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
export async function update(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      force: { type: 'boolean', default: false, short: 'f' },
    },
    strict: true,
  });
  const force = values.force;
  const projectDir = resolveProjectDir();
  const cfg = loadConfig(projectDir);
  const envDir = resolveEnvDir(cfg, projectDir);

  if (!existsSync(envDir)) {
    die(`Environment dir not found: ${envDir}. Run "devrig init" first.`);
  }

  const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold');
  let updated = false;

  // ── Step 1: Scaffold files ──────────────────────────────────────────────
  const changed = findChangedFiles(envDir, scaffoldDir);
  if (changed.length > 0) {
    log(`${changed.length} scaffold file(s) differ:`);
    for (const f of changed) {
      console.log(`  ${f.name}`);
    }
    if (await confirm('Update scaffold files?', force)) {
      for (const f of changed) {
        cpSync(join(scaffoldDir, f.name), join(envDir, f.name));
        log(`Updated ${f.name}`);
      }
      updated = true;
    }
  }

  // ── Step 2: Scaffold directories (mitmproxy/) ──────────────────────────
  const SCAFFOLD_DIRS = ['mitmproxy'];
  const dirChanges = [];
  for (const dir of SCAFFOLD_DIRS) {
    const files = findChangedInDir(envDir, scaffoldDir, dir);
    for (const f of files) dirChanges.push(f);
  }
  if (dirChanges.length > 0) {
    log(`${dirChanges.length} scaffold directory file(s) differ:`);
    for (const f of dirChanges) {
      console.log(`  ${f}`);
    }
    if (await confirm('Update scaffold directories?', force)) {
      for (const dir of SCAFFOLD_DIRS) {
        const src = join(scaffoldDir, dir);
        if (existsSync(src)) {
          cpSync(src, join(envDir, dir), { recursive: true });
        }
      }
      log('Updated scaffold directories.');
      updated = true;
    }
  }

  // ── Step 3: Template files (server.js, index.html in project root) ─────
  const TEMPLATE_FILES = ['server.js', 'index.html'];
  const templateDir = join(scaffoldDir, 'template');
  const templateChanged = [];

  for (const file of TEMPLATE_FILES) {
    const src = join(templateDir, file);
    const dest = join(projectDir, file);
    if (!existsSync(src)) continue;
    if (!existsSync(dest)) {
      templateChanged.push({ name: file });
      continue;
    }
    if (!readFileSync(src).equals(readFileSync(dest))) {
      templateChanged.push({ name: file });
    }
  }

  if (templateChanged.length > 0) {
    log(`${templateChanged.length} template file(s) differ:`);
    for (const f of templateChanged) {
      console.log(`  ${f.name}`);
    }
    if (await confirm('Update template files?', force)) {
      for (const f of templateChanged) {
        cpSync(join(templateDir, f.name), join(projectDir, f.name));
        log(`Updated ${f.name}`);
      }
      updated = true;
    }
  }

  // ── Step 4: UI files to project .devrig/ ────────────────────────────────
  const UI_FILES = ['setup.html', 'firewall.html'];
  const devrigDir = join(projectDir, '.devrig');
  if (existsSync(devrigDir)) {
    for (const file of UI_FILES) {
      const src = join(scaffoldDir, file);
      if (existsSync(src)) {
        cpSync(src, join(devrigDir, file));
      }
    }
  }

  // ── Step 5: Ensure directories ──────────────────────────────────────────
  if (existsSync(devrigDir)) {
    mkdirSync(join(devrigDir, 'rules'), { recursive: true });
    mkdirSync(join(devrigDir, 'logs'), { recursive: true });
  }

  // ── Step 6: File permissions ────────────────────────────────────────────
  const EXECUTABLE_FILES = ['entrypoint.sh', 'container-setup.js', 'firewall.sh'];
  for (const file of EXECUTABLE_FILES) {
    const dest = join(envDir, file);
    if (existsSync(dest)) {
      try {
        chmodSync(dest, 0o755);
      } catch {
        /* skip on Windows or read-only */
      }
    }
  }

  // ── Step 7: Version marker ──────────────────────────────────────────────
  if (updated) {
    writeFileSync(join(envDir, '.devrig-version'), getPackageVersion() + '\n');
    log('Version marker updated.');
  }

  // ── Step 8: Regenerate CLAUDE.md ────────────────────────────────────────
  try {
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not regenerate container CLAUDE.md');
  }

  if (!updated && changed.length === 0 && dirChanges.length === 0 && templateChanged.length === 0) {
    log('Everything is up to date.');
  } else if (updated) {
    log('Update complete.');
  }
}
