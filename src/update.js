// @ts-check
import { readFileSync, writeFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { log, die } from './log.js';
import { resolveProjectDir, getPackageVersion, loadConfig } from './config.js';
import { generateClaudeMd } from './init.js';

const SKIP = new Set(['home', 'logs', 'session.json', '.devrig-version', 'template']);

/**
 * Recursively lists files in a directory, relative to base.
 * @param {string} dir
 * @param {string} base
 * @returns {string[]}
 */
function listFiles(dir, base) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = relative(base, join(dir, entry.name));
    const topLevel = relPath.split('/')[0];
    if (SKIP.has(topLevel)) continue;
    if (entry.isDirectory()) {
      results.push(...listFiles(join(dir, entry.name), base));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Compares scaffold files against the user's .devrig/ directory.
 * @param {string} projectDir
 * @param {string} scaffoldDir
 * @returns {{ name: string }[]}
 */
export function findChangedFiles(projectDir, scaffoldDir) {
  const devrigDir = join(projectDir, '.devrig');
  const scaffoldFiles = listFiles(scaffoldDir, scaffoldDir);
  const changed = [];

  for (const file of scaffoldFiles) {
    const topLevel = file.split('/')[0];
    if (SKIP.has(topLevel)) continue;

    const srcPath = join(scaffoldDir, file);
    const destPath = join(devrigDir, file);

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
 * Main update command handler.
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
export async function update(argv) {
  const force = argv.includes('--force');
  const projectDir = resolveProjectDir();
  const devrigDir = join(projectDir, '.devrig');

  if (!existsSync(devrigDir)) {
    die('.devrig/ not found. Run "devrig init" first.');
  }

  const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold');
  const changed = findChangedFiles(projectDir, scaffoldDir);

  if (changed.length === 0) {
    log('All scaffold files are up to date.');
    return;
  }

  log(`${changed.length} file(s) differ from installed devrig version:`);
  for (const f of changed) {
    console.log(`  ${f.name}`);
  }

  if (!force) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\n  Update these files? [y/N]: ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Cancelled.');
      return;
    }
  }

  for (const f of changed) {
    const src = join(scaffoldDir, f.name);
    const dest = join(devrigDir, f.name);
    cpSync(src, dest);
    log(`Updated ${f.name}`);
  }

  // Update version marker
  writeFileSync(join(devrigDir, '.devrig-version'), getPackageVersion() + '\n');

  // Regenerate container CLAUDE.md with updated scaffold
  try {
    const cfg = loadConfig(projectDir);
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not regenerate container CLAUDE.md');
  }

  log('Version marker updated.');
}
