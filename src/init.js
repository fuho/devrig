// @ts-check
import { cpSync, chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getPackageVersion, loadConfig } from './config.js';
import { configure } from './configure.js';
import { log, die } from './log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEVRIG_START = '<!-- devrig:start -->';
const DEVRIG_END = '<!-- devrig:end -->';

/**
 * Generates or updates the devrig section in CLAUDE.md.
 * @param {string} projectDir
 * @param {{ tool: string, dev_server_port: number, bridge_enabled: boolean, bridge_port: number }} cfg
 */
export function generateClaudeMd(projectDir, cfg) {
  const claudeMdPath = join(projectDir, 'CLAUDE.md');
  const block = [
    DEVRIG_START,
    '## devrig',
    '',
    'You are running inside a devrig Docker container.',
    '',
    `- **Workspace:** /workspace`,
    `- **Dev server:** http://localhost:${cfg.dev_server_port}`,
    `- **Chrome bridge:** ${cfg.bridge_enabled ? `enabled (port ${cfg.bridge_port})` : 'disabled'}`,
    '',
    'On first message, check if you have the "Claude in Chrome" MCP tool available.',
    'If YES: use it to navigate to the dev server URL below and confirm the connection.',
    `If NO: tell the user to type /exit and run "devrig start" again — Chrome MCP activates on the second launch.`,
    '',
    `Dev server URL: http://localhost:${cfg.dev_server_port}?agent=${cfg.tool}`,
    'Do NOT use WebFetch or Fetch for this URL — they cannot reach localhost.',
    '',
    'Git push is blocked inside this container. Make commits freely — the user will',
    'review and push from the host.',
    DEVRIG_END,
  ].join('\n');

  if (existsSync(claudeMdPath)) {
    let content = readFileSync(claudeMdPath, 'utf8');
    const startIdx = content.indexOf(DEVRIG_START);
    const endIdx = content.indexOf(DEVRIG_END);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + block + content.slice(endIdx + DEVRIG_END.length);
    } else {
      const sep = content.endsWith('\n') ? '\n' : '\n\n';
      content = content + sep + block + '\n';
    }
    writeFileSync(claudeMdPath, content);
  } else {
    writeFileSync(claudeMdPath, block + '\n');
  }
  log('Generated CLAUDE.md');
}

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
  const gitignoreEntries = ['.devrig/'];
  let existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';

  const missing = gitignoreEntries.filter((entry) => !existing.includes(entry));
  if (missing.length > 0) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignorePath, existing + prefix + missing.join('\n') + '\n');
    log('Updated .gitignore');
  }

  // Copy setup.html into .devrig/ (not in template/ — survives user file changes)
  const setupSrc = join(scaffoldDir, 'setup.html');
  if (existsSync(setupSrc)) {
    cpSync(setupSrc, join(targetDir, 'setup.html'));
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

  // Generate CLAUDE.md with devrig section
  try {
    const cfg = loadConfig(projectDir);
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not generate CLAUDE.md');
  }

  // Summary of what was created
  console.log('');
  log("Done! Here's what was created:");
  console.log('');
  console.log('  .devrig/           Docker infrastructure (Dockerfile, compose, entrypoint)');
  console.log('  devrig.toml        Project configuration');
  console.log('  .env               Environment variables (git author, Claude params)');
  console.log(
    '  .gitignore         Updated with .devrig/',
  );
  console.log('  CLAUDE.md          Instructions for Claude Code (auto-loaded on session start)');
  console.log('');

  // Show config files
  const tomlPath = join(projectDir, 'devrig.toml');
  const envPath = join(projectDir, '.env');
  if (existsSync(tomlPath)) {
    console.log('  ── devrig.toml ──');
    console.log(readFileSync(tomlPath, 'utf8').replace(/^/gm, '  '));
  }
  if (existsSync(envPath)) {
    console.log('  ── .env ──');
    console.log(readFileSync(envPath, 'utf8').replace(/^/gm, '  '));
  }

  log('To start a session, run:');
  console.log('');
  console.log('  devrig start');
  console.log('');
}
