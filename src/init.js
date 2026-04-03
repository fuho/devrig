// @ts-check
import { cpSync, chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getPackageVersion } from './config.js';
import { configure } from './configure.js';
import { log, die } from './log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Scaffolds .devrig/ directory, sets permissions, and runs configuration wizard. */
export async function init(projectDir) {
  const scaffoldDir = join(__dirname, '..', 'scaffold');
  const targetDir = join(projectDir, '.devrig');

  // Warn if .devrig/ already exists
  if (existsSync(targetDir)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('  .devrig/ already exists. Overwrite? [y/N]: '))
      .trim()
      .toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Aborted.');
      return;
    }
  }

  // Copy scaffold files into .devrig/
  log('Copying scaffold files to .devrig/...');
  try {
    cpSync(scaffoldDir, targetDir, { recursive: true });
  } catch (err) {
    die(`Failed to copy scaffold files: ${err.message}`);
  }

  // Set executable permissions on key files
  try {
    chmodSync(join(targetDir, 'entrypoint.sh'), 0o755);
    chmodSync(join(targetDir, 'container-setup.js'), 0o755);
  } catch (err) {
    die(`Failed to set file permissions: ${err.message}`);
  }

  // Write version marker
  const version = getPackageVersion();
  try {
    writeFileSync(join(targetDir, '.devrig-version'), version + '\n');
  } catch (err) {
    log(`WARNING: Could not write version marker: ${err.message}`);
  }

  // Append .gitignore entries if not already present
  const gitignorePath = join(projectDir, '.gitignore');
  const gitignoreEntries = ['.devrig/logs/', '.devrig/home/', '.devrig/session.json'];
  let existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';

  const missing = gitignoreEntries.filter((entry) => !existing.includes(entry));
  if (missing.length > 0) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignorePath, existing + prefix + missing.join('\n') + '\n');
    log('Updated .gitignore');
  }

  // Copy devrig.toml.example to project root if absent
  const exampleSrc = join(scaffoldDir, 'devrig.toml.example');
  const exampleDest = join(projectDir, 'devrig.toml.example');
  if (existsSync(exampleSrc) && !existsSync(exampleDest)) {
    cpSync(exampleSrc, exampleDest);
  }

  log('Scaffold complete.');

  // Run configuration wizard
  await configure(projectDir);
}
