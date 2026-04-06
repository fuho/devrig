// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { parseTOML, getPackageVersion } from './config.js';
import { log } from './log.js';

/**
 * @typedef {{ status: 'pass' | 'fail' | 'warn', message: string }} CheckResult
 */

/** @returns {CheckResult} */
export function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 18 || (major === 18 && minor >= 3)) {
    return { status: 'pass', message: `Node.js ${process.versions.node}` };
  }
  return { status: 'fail', message: `Node.js ${process.versions.node} — need >= 18.3` };
}

/** @returns {CheckResult} */
export function checkDockerRunning() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return { status: 'pass', message: 'Docker daemon running' };
  } catch {
    return { status: 'fail', message: 'Docker daemon not running' };
  }
}

/** @returns {CheckResult} */
export function checkDockerCompose() {
  try {
    const out = execFileSync('docker', ['compose', 'version'], { encoding: 'utf8' }).trim();
    return { status: 'pass', message: out };
  } catch {
    return { status: 'fail', message: 'Docker Compose not available' };
  }
}

/** @returns {CheckResult} */
export function checkChromeBrowser() {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const p of paths) {
    if (existsSync(p)) return { status: 'pass', message: `Chrome found at ${p}` };
  }
  return { status: 'warn', message: 'Chrome not found (optional — needed for browser bridge)' };
}

/**
 * @param {string} projectDir
 * @returns {CheckResult}
 */
export function checkDevrigDir(projectDir) {
  const devrig = join(projectDir, '.devrig');
  if (!existsSync(devrig)) {
    return { status: 'fail', message: '.devrig/ not found — run "devrig init"' };
  }
  const required = ['Dockerfile', 'compose.yml', 'entrypoint.sh'];
  const missing = required.filter((f) => !existsSync(join(devrig, f)));
  if (missing.length > 0) {
    return { status: 'fail', message: `.devrig/ missing: ${missing.join(', ')}` };
  }
  return { status: 'pass', message: '.devrig/ OK' };
}

/**
 * @param {string} projectDir
 * @returns {CheckResult}
 */
export function checkTomlValid(projectDir) {
  const tomlPath = join(projectDir, 'devrig.toml');
  if (!existsSync(tomlPath)) {
    return { status: 'fail', message: 'devrig.toml not found — run "devrig init"' };
  }
  try {
    const raw = parseTOML(readFileSync(tomlPath, 'utf8'));
    if (!raw.project) {
      return { status: 'warn', message: 'devrig.toml missing "project" field' };
    }
    return { status: 'pass', message: `devrig.toml OK (project: ${raw.project})` };
  } catch (err) {
    return { status: 'fail', message: `devrig.toml parse error: ${err.message}` };
  }
}

/**
 * @param {string} projectDir
 * @returns {CheckResult}
 */
export function checkVersionStaleness(projectDir) {
  const versionFile = join(projectDir, '.devrig', '.devrig-version');
  if (!existsSync(versionFile)) {
    return { status: 'warn', message: 'No version marker — cannot check staleness' };
  }
  const scaffoldVersion = readFileSync(versionFile, 'utf8').trim();
  const currentVersion = getPackageVersion();
  if (scaffoldVersion !== currentVersion) {
    return {
      status: 'warn',
      message: `Scaffold v${scaffoldVersion}, devrig v${currentVersion} — run "devrig update"`,
    };
  }
  return { status: 'pass', message: `Version ${currentVersion}` };
}

/**
 * @param {number} port
 * @param {string} label
 * @returns {Promise<CheckResult>}
 */
export function checkPortAvailable(port, label) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve({ status: 'warn', message: `${label} port ${port} in use` });
    });
    server.listen(port, () => {
      server.close(() => {
        resolve({ status: 'pass', message: `${label} port ${port} available` });
      });
    });
  });
}

const COLORS = { pass: '\x1b[32m', fail: '\x1b[31m', warn: '\x1b[33m' };
const RESET = '\x1b[0m';
const ICONS = { pass: 'OK', fail: 'FAIL', warn: 'WARN' };

/**
 * @param {CheckResult} result
 */
function printResult(result) {
  const color = COLORS[result.status];
  const icon = ICONS[result.status];
  console.log(`  ${color}${icon.padEnd(5)}${RESET} ${result.message}`);
}

/**
 * Runs all doctor checks and prints results.
 * @param {string} projectDir
 */
export async function runAll(projectDir) {
  log('Running health checks...\n');

  const checks = [
    checkNodeVersion(),
    checkDockerRunning(),
    checkDockerCompose(),
    checkChromeBrowser(),
    checkDevrigDir(projectDir),
    checkTomlValid(projectDir),
    checkVersionStaleness(projectDir),
  ];

  for (const result of checks) printResult(result);

  // Port checks need config — only run if toml is valid
  try {
    const raw = parseTOML(readFileSync(join(projectDir, 'devrig.toml'), 'utf8'));
    const devPort = raw.dev_server?.port ?? 3000;
    const bridgePort = raw.chrome_bridge?.port ?? 9229;
    printResult(await checkPortAvailable(devPort, 'Dev server'));
    printResult(await checkPortAvailable(bridgePort, 'Chrome bridge'));
  } catch {
    /* toml missing/invalid — skip port checks */
  }

  const failed = checks.filter((c) => c.status === 'fail');
  console.log('');
  if (failed.length > 0) {
    log(`${failed.length} check(s) failed.`);
  } else {
    log('All checks passed.');
  }
}
