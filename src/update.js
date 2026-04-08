// @ts-check
import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
 * Main update command handler.
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
export async function update(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      force: { type: 'boolean', default: false },
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
  const changed = findChangedFiles(envDir, scaffoldDir);

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
    const dest = join(envDir, f.name);
    cpSync(src, dest);
    log(`Updated ${f.name}`);
  }

  // Update version marker
  writeFileSync(join(envDir, '.devrig-version'), getPackageVersion() + '\n');

  // Regenerate container CLAUDE.md with updated scaffold
  try {
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not regenerate container CLAUDE.md');
  }

  log('Version marker updated.');
}
