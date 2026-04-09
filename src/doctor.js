// @ts-check
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { userInfo } from 'node:os';
import { parseTOML, getPackageVersion, resolveEnvDir } from './config.js';
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
  // Safely determine environment dir without die()
  let envDir = join(projectDir, '.devrig');
  try {
    const tomlPath = join(projectDir, 'devrig.toml');
    if (existsSync(tomlPath)) {
      const raw = parseTOML(readFileSync(tomlPath, 'utf8'));
      const rawEnv = raw.environment ?? 'shared';
      const environment = rawEnv === 'local' ? 'local' : 'shared';
      envDir = resolveEnvDir({ environment }, projectDir);
    }
  } catch {
    /* fall back to .devrig/ */
  }

  if (!existsSync(envDir)) {
    // Detect pre-v0.6 project: has .devrig/ with scaffold files but no environment field
    const localDevrig = join(projectDir, '.devrig');
    if (envDir !== localDevrig && existsSync(join(localDevrig, 'Dockerfile'))) {
      return {
        status: 'fail',
        message: `Environment dir not found: ${envDir}. This project was set up before environments existed. Fix: add 'environment = "local"' to devrig.toml, or run "devrig start" to auto-create the environment.`,
      };
    }
    return { status: 'fail', message: `Environment dir not found: ${envDir} — run "devrig init"` };
  }
  const required = ['Dockerfile', 'compose.yml', 'entrypoint.sh'];
  const missing = required.filter((f) => !existsSync(join(envDir, f)));
  if (missing.length > 0) {
    return { status: 'fail', message: `Environment dir missing: ${missing.join(', ')}` };
  }
  return { status: 'pass', message: `Environment dir OK (${envDir})` };
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
  // Safely determine environment dir without die()
  let envDir = join(projectDir, '.devrig');
  try {
    const tomlPath = join(projectDir, 'devrig.toml');
    if (existsSync(tomlPath)) {
      const raw = parseTOML(readFileSync(tomlPath, 'utf8'));
      const rawEnv = raw.environment ?? 'shared';
      const environment = rawEnv === 'local' ? 'local' : 'shared';
      envDir = resolveEnvDir({ environment }, projectDir);
    }
  } catch {
    /* fall back to .devrig/ */
  }

  let versionFile = join(envDir, '.devrig-version');
  // Fall back to .devrig/ version file for pre-v0.6 projects
  if (!existsSync(versionFile)) {
    const localVersion = join(projectDir, '.devrig', '.devrig-version');
    if (envDir !== join(projectDir, '.devrig') && existsSync(localVersion)) {
      versionFile = localVersion;
    }
  }
  if (!existsSync(versionFile)) {
    return { status: 'warn', message: 'No version marker — cannot check staleness' };
  }
  const scaffoldVersion = readFileSync(versionFile, 'utf8').trim();
  const currentVersion = getPackageVersion();
  if (scaffoldVersion !== currentVersion) {
    return {
      status: 'warn',
      message: `Scaffold v${scaffoldVersion}, devrig v${currentVersion} — run "devrig init" to update`,
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

/**
 * Tests the Chrome NMH bridge chain: socket dir → socket alive → NMH responds.
 * @returns {Promise<CheckResult>}
 */
export async function checkChromeBridge() {
  const sockDir = `/tmp/claude-mcp-browser-bridge-${userInfo().username}`;

  // Check 1: socket directory and files
  let socks;
  try {
    socks = readdirSync(sockDir).filter((f) => f.endsWith('.sock'));
  } catch {
    return {
      status: 'warn',
      message: 'Chrome NMH socket dir not found — is the Claude Chrome extension enabled?',
    };
  }
  if (socks.length === 0) {
    return { status: 'warn', message: 'No NMH socket files — restart Chrome' };
  }

  // Check 2: newest socket accepts connections
  socks.sort();
  const sockName = socks[socks.length - 1];
  const sockPath = join(sockDir, sockName);

  const alive = await new Promise((resolve) => {
    const conn = createConnection(sockPath, () => {
      conn.destroy();
      resolve(true);
    });
    conn.on('error', () => resolve(false));
    conn.setTimeout(1000, () => {
      conn.destroy();
      resolve(false);
    });
  });

  if (!alive) {
    return { status: 'warn', message: `NMH socket ${sockName} is stale — restart Chrome` };
  }

  // Check 3: NMH responds to a message (length-prefixed JSON)
  const responded = await new Promise((resolve) => {
    const conn = createConnection(sockPath, () => {
      const msg = JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 });
      const buf = Buffer.alloc(4 + msg.length);
      buf.writeUInt32LE(msg.length, 0);
      buf.write(msg, 4);
      conn.write(buf);
    });
    let got = false;
    conn.on('data', () => {
      got = true;
      conn.destroy();
    });
    conn.on('error', () => resolve(false));
    conn.on('close', () => resolve(got));
    setTimeout(() => {
      conn.destroy();
      resolve(got);
    }, 3000);
  });

  if (!responded) {
    return {
      status: 'warn',
      message: `NMH socket ${sockName} accepts connections but not responding — toggle Claude extension off/on in chrome://extensions`,
    };
  }

  return { status: 'pass', message: `Chrome NMH responding (${sockName})` };
}

/**
 * Checks for orphaned devrig processes (bridge, dev server) not tied to an active session.
 * @returns {CheckResult}
 */
export function checkOrphanedProcesses() {
  try {
    const out = execFileSync('sh', ['-c', 'ps ax -o pid,ppid,command'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const orphans = [];
    for (const line of out.split('\n')) {
      if (line.includes('bridge-host.cjs') || line.includes('container-setup.js')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[0];
        const ppid = parts[1];
        // PPID 1 means the parent died — this is an orphan
        if (ppid === '1') {
          orphans.push({ pid, cmd: parts.slice(2).join(' ') });
        }
      }
    }
    if (orphans.length > 0) {
      const pids = orphans.map((o) => o.pid).join(', ');
      return {
        status: 'warn',
        message: `Orphaned devrig process(es): PID ${pids} — run devrig clean --orphans to kill`,
      };
    }
    return { status: 'pass', message: 'No orphaned devrig processes' };
  } catch {
    return { status: 'pass', message: 'No orphaned devrig processes' };
  }
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

  printResult(checkOrphanedProcesses());

  // Chrome bridge check — only if config has bridge enabled
  try {
    const raw = parseTOML(readFileSync(join(projectDir, 'devrig.toml'), 'utf8'));
    if (raw.chrome_bridge) {
      printResult(await checkChromeBridge());
    }
  } catch {
    /* toml missing/invalid — skip bridge check */
  }

  const failed = checks.filter((c) => c.status === 'fail');
  console.log('');
  if (failed.length > 0) {
    log(`${failed.length} check(s) failed.`);
  } else {
    log('All checks passed.');
  }
}
