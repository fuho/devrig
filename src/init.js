// @ts-check
import { cpSync, chmodSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getPackageVersion, loadConfig } from './config.js';
import { ensureEnv } from './env.js';
import { configure } from './configure.js';
import { log, die } from './log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Scaffold files that belong in .devrig/ (whitelist). */
export const SCAFFOLD_FILES = [
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

const DEVRIG_START = '<!-- devrig:start -->';
const DEVRIG_END = '<!-- devrig:end -->';

/**
 * Replaces or appends a devrig sentinel block into user content.
 * @param {string} userContent - Content outside sentinels (may be empty)
 * @param {string} block - Full block including sentinels
 * @returns {string}
 */
function spliceBlock(userContent, block) {
  const startIdx = userContent.indexOf(DEVRIG_START);
  const endIdx = userContent.indexOf(DEVRIG_END);
  if (startIdx !== -1 && endIdx !== -1) {
    return userContent.slice(0, startIdx) + block + userContent.slice(endIdx + DEVRIG_END.length);
  }
  const sep = userContent.endsWith('\n') ? '\n' : '\n\n';
  return userContent + (userContent ? sep : '') + block + '\n';
}

/**
 * Extracts user content from a file, stripping the devrig sentinel block.
 * Returns empty string if the file doesn't exist.
 * @param {string} filePath
 * @returns {string}
 */
function readUserContent(filePath) {
  if (!existsSync(filePath)) return '';
  const content = readFileSync(filePath, 'utf8');
  const startIdx = content.indexOf(DEVRIG_START);
  const endIdx = content.indexOf(DEVRIG_END);
  if (startIdx !== -1 && endIdx !== -1) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + DEVRIG_END.length);
    return (before + after).replace(/\n{3,}/g, '\n\n').trimEnd();
  }
  return content.trimEnd();
}

/**
 * Generates or updates CLAUDE.md (host instructions) and .devrig/CLAUDE.md (container instructions).
 * @param {string} projectDir
 * @param {{ tool: string, dev_server_port: number, bridge_enabled: boolean, bridge_port: number }} cfg
 */
export function generateClaudeMd(projectDir, cfg) {
  const hostBlock = [
    DEVRIG_START,
    '## devrig',
    '',
    'This project uses devrig for containerized AI development.',
    '',
    'Available commands:',
    '- `devrig start` — launch a container session',
    '- `devrig stop` — stop the running session',
    '- `devrig env list` — show named environments',
    '- `devrig doctor` — check system prerequisites',
    '- `devrig logs` — view container, dev server, and network logs',
    '- `devrig exec` — open a shell in the running container',
    '',
    'Dashboards (when session is running):',
    '- Network traffic: http://localhost:8081',
    `- Traffic control: http://localhost:${cfg.dev_server_port}/devrig/traffic`,
    DEVRIG_END,
  ].join('\n');

  const containerBlock = [
    DEVRIG_START,
    '## devrig',
    '',
    'You are running inside a devrig Docker container.',
    '',
    `- **Workspace:** /workspace`,
    `- **Dev server:** http://localhost:${cfg.dev_server_port}`,
    `- **Chrome bridge:** ${cfg.bridge_enabled ? `enabled (port ${cfg.bridge_port})` : 'disabled'}`,
    `- **Network:** outbound traffic filtered through mitmproxy (allowlisted domains only)`,
    '',
    'On first message, check if you have the "Claude in Chrome" MCP tool available.',
    `If YES: use it to navigate to http://localhost:${cfg.dev_server_port}/devrig/hello_claude to confirm the connection.`,
    `If NO: tell the user to type /exit and run "devrig start" again — Chrome MCP activates on the second launch.`,
    '',
    'Outbound network is default-allow. Specific domains are blocked (e.g. telemetry). Rules are manageable via the traffic control dashboard.',
    'Make commits freely — the user will review and push from the host.',
    DEVRIG_END,
  ].join('\n');

  // Read user content from host CLAUDE.md (source of truth for user content)
  const hostPath = join(projectDir, 'CLAUDE.md');
  const userContent = readUserContent(hostPath);

  // Write host CLAUDE.md
  writeFileSync(hostPath, spliceBlock(userContent, hostBlock));

  // Write .devrig/CLAUDE.md
  const containerPath = join(projectDir, '.devrig', 'CLAUDE.md');
  writeFileSync(containerPath, spliceBlock(userContent, containerBlock));

  log('Generated CLAUDE.md (host + container)');
}

/** Scaffolds .devrig/ directory, sets permissions, and runs configuration wizard. */
export async function init(projectDir) {
  const scaffoldDir = join(__dirname, '..', 'scaffold');
  const targetDir = join(projectDir, '.devrig');

  // Warn if .devrig/ already exists
  if (existsSync(targetDir)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('  .devrig/ already exists. Re-initialize? [y/N]: '))
      .trim()
      .toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Aborted.');
      return;
    }
  }

  // Run configuration wizard (now includes environment selection)
  await configure(projectDir);

  // Load config to determine environment
  const cfg = loadConfig(projectDir);
  const isLocal = cfg.environment === 'local';

  if (isLocal) {
    // Local mode: copy scaffold files into .devrig/ (legacy behavior)
    log('Copying scaffold files to .devrig/...');
    for (const file of SCAFFOLD_FILES) {
      try {
        cpSync(join(scaffoldDir, file), join(targetDir, file));
      } catch (err) {
        die(`Failed to copy ${file}: ${err.message}`);
      }
    }

    // Copy mitmproxy directory
    const mitmSrc = join(scaffoldDir, 'mitmproxy');
    if (existsSync(mitmSrc)) {
      cpSync(mitmSrc, join(targetDir, 'mitmproxy'), { recursive: true });
    }

    // Set executable permissions on key files
    try {
      chmodSync(join(targetDir, 'entrypoint.sh'), 0o755);
      chmodSync(join(targetDir, 'container-setup.js'), 0o755);
      chmodSync(join(targetDir, 'firewall.sh'), 0o755);
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

    // Copy traffic.html into .devrig/
    const trafficSrc = join(scaffoldDir, 'traffic.html');
    if (existsSync(trafficSrc)) {
      cpSync(trafficSrc, join(targetDir, 'traffic.html'));
    }

    // Create rules directory for firewall API persistence
    mkdirSync(join(targetDir, 'rules'), { recursive: true });
  } else {
    // Named environment: ensure environment exists at ~/.devrig/environments/{name}/
    const envPath = ensureEnv(cfg.environment);
    log(`Using environment "${cfg.environment}" at ${envPath}`);

    // Create project .devrig/ for runtime state only
    mkdirSync(join(targetDir, 'logs'), { recursive: true });

    // Copy traffic.html to project .devrig/ so the dev server can find it
    const trafficSrc = join(scaffoldDir, 'traffic.html');
    if (existsSync(trafficSrc)) {
      cpSync(trafficSrc, join(targetDir, 'traffic.html'));
    }

    // Create rules directory for firewall API persistence
    mkdirSync(join(targetDir, 'rules'), { recursive: true });
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

  // devrig.toml.example is no longer copied — the wizard generates devrig.toml directly

  log('Scaffold complete.');

  // Generate CLAUDE.md with devrig section
  try {
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not generate CLAUDE.md');
  }

  // Summary of what was created
  console.log('');
  log("Done! Here's what was created:");
  console.log('');
  if (isLocal) {
    console.log('  .devrig/           Docker infrastructure (Dockerfile, compose, entrypoint)');
  } else {
    console.log(`  Environment:       "${cfg.environment}" (shared across projects)`);
  }
  console.log('  devrig.toml        Project configuration');
  console.log('  .env               Environment variables (git author, Claude params)');
  console.log('  .gitignore         Updated with .devrig/');
  console.log('  CLAUDE.md          Instructions for host Claude Code');
  console.log('  .devrig/CLAUDE.md  Instructions for container Claude Code (shadow-mounted)');
  console.log('');

  // Show config files
  const tomlPath = join(projectDir, 'devrig.toml');
  const envFilePath = join(projectDir, '.env');
  if (existsSync(tomlPath)) {
    console.log('  ── devrig.toml ──');
    console.log(readFileSync(tomlPath, 'utf8').replace(/^/gm, '  '));
  }
  if (existsSync(envFilePath)) {
    console.log('  ── .env ──');
    console.log(readFileSync(envFilePath, 'utf8').replace(/^/gm, '  '));
  }

  log('To start a session, run:');
  console.log('');
  console.log('  devrig start');
  console.log('');
}
