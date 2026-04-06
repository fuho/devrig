# devrig Backlog — Plan IN (Inside devrig)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement DX improvements, new commands, Claude Code version pinning, and documentation — all work that can be developed and unit-tested inside a devrig container.

**Architecture:** Pure JS changes to the devrig CLI. New commands (`logs`, `exec`, `doctor`, `update`) follow the existing pattern: add case to `bin/devrig.js` switch, create new module in `src/`, add tests in `test/`. Version pinning extends the TOML config and container-setup script. The npm installer branch is removed entirely.

**Tech Stack:** Node.js stdlib only, Node built-in test runner, ESLint + Prettier + TSC JSDoc.

**Spec:** `docs/superpowers/specs/2026-04-06-devrig-backlog-split-design.md`

---

## Phase 1: Quick Wins

### Task 1: Port validation — warn on fallback

**Files:**

- Modify: `src/configure.js:21-24`
- Modify: `test/configure.test.js`

- [ ] **Step 1: Write the failing test**

In `test/configure.test.js`, add a new test inside the existing `describe('configure')` block. This test checks that stderr contains a warning when an invalid port is entered.

```js
it('warns when port falls back to default', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

  try {
    // Feed invalid port "banana" for dev server
    const answers = [
      'test-project', 'claude',
      'y', 'npm run dev', 'banana', '10',
      'y', '9229',
      'Test User', 'test@example.com', 'n',
    ];

    const { stderr } = await runConfigure(tmpDir, answers);
    assert.ok(stderr.includes('Invalid port') || stderr.includes('invalid port'),
      'should warn about invalid port in stderr');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/configure.test.js`
Expected: The new test FAILS because `parsePort` currently returns silently.

- [ ] **Step 3: Update parsePort to warn on fallback**

In `src/configure.js`, replace the `parsePort` function (lines 21-24):

```js
function parsePort(value, fallback) {
  const n = parseInt(value, 10);
  if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  if (value && value !== String(fallback)) {
    console.warn(`[devrig] Invalid port '${value}' — using ${fallback}`);
  }
  return fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/configure.test.js`
Expected: All tests pass, including the new one.

- [ ] **Step 5: Run full check suite**

Run: `npm run check`
Expected: lint clean, format clean, typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/configure.js test/configure.test.js
git commit -m "fix: warn when port validation falls back to default"
```

---

### Task 2: Drop npm install branch — remove scaffold files

**Files:**

- Delete: `scaffold/Dockerfile.npm`
- Delete: `scaffold/compose.npm.yml`

- [ ] **Step 1: Delete the npm scaffold files**

```bash
rm scaffold/Dockerfile.npm scaffold/compose.npm.yml
```

- [ ] **Step 2: Commit**

```bash
git add -A scaffold/Dockerfile.npm scaffold/compose.npm.yml
git commit -m "chore: remove npm variant scaffold files (deprecated)"
```

---

### Task 3: Drop npm install branch — remove JS code

**Files:**

- Modify: `src/docker.js:78-101`
- Modify: `src/launcher.js:88-100`
- Modify: `scaffold/container-setup.js`
- Modify: `scaffold/compose.yml:19`

- [ ] **Step 1: Simplify initVariant in docker.js**

Replace the entire `initVariant` function in `src/docker.js` (lines 78-101):

```js
/**
 * Returns a ctx-like object for Docker operations.
 */
export function initVariant(cfg) {
  const project = cfg.project;
  const devrigDir = '.devrig';

  return {
    project,
    composeFile: `${devrigDir}/compose.yml`,
    service: 'dev',
    image: `${project}-dev:latest`,
    dockerfile: 'Dockerfile',
    devrigDir,
  };
}
```

- [ ] **Step 2: Update launcher.js — remove --npm flag**

In `src/launcher.js`, replace the `parseArgs` call (lines 88-97):

```js
  const { values: args } = parseArgs({
    args: argv,
    options: {
      rebuild: { type: 'boolean', default: false },
      'no-chrome': { type: 'boolean', default: false },
      'no-dev-server': { type: 'boolean', default: false },
    },
    strict: false,
  });
```

Replace line 100:

```js
  const ctx = initVariant(cfg);
```

- [ ] **Step 3: Remove npm install function from container-setup.js**

In `scaffold/container-setup.js`, delete the entire `installClaudeCodeNpm` function (lines 35-75). Then simplify `installClaudeCode` (lines 91-98):

```js
function installClaudeCode() {
  installClaudeCodeNative();
}
```

- [ ] **Step 4: Remove CLAUDE_INSTALL_METHOD from compose.yml**

In `scaffold/compose.yml`, remove this line from the environment section (line 19):

```yaml
      - CLAUDE_INSTALL_METHOD=native
```

- [ ] **Step 5: Run full check suite**

Run: `npm run check`
Expected: All tests pass. If any test references `--npm`, `Dockerfile.npm`, `compose.npm.yml`, or `initVariant(cfg, 'npm')`, fix those tests now.

- [ ] **Step 6: Commit**

```bash
git add src/docker.js src/launcher.js scaffold/container-setup.js scaffold/compose.yml
git commit -m "refactor: remove npm installer branch (deprecated)"
```

---

### Task 4: Drop npm install branch — update tests and docs

**Files:**

- Modify: `test/init.test.js:35-46`
- Modify: `src/clean.js:139-156`
- Modify: `bin/devrig.js:39,48-49`
- Modify: `README.md`

- [ ] **Step 1: Update init.test.js — remove npm file expectations**

In `test/init.test.js`, update the `expected` array in the scaffold test (lines 35-46). Remove `'Dockerfile.npm'` and `'compose.npm.yml'` from the list:

```js
    const expected = [
      'Dockerfile',
      'compose.yml',
      'entrypoint.sh',
      'container-setup.js',
      'devrig.toml.example',
      'template/index.html',
      'template/package.json',
    ];
```

- [ ] **Step 2: Update clean.js — remove npm variant lookup**

In `src/clean.js`, replace lines 139-156 (the section that checks both native and npm images):

```js
    const ctx = initVariant(cfg);
    const imageNames = new Set(found.map((f) => f.name));
    if (!imageNames.has(ctx.image)) {
      try {
        const info = execFileSync(
          'docker',
          ['image', 'inspect', ctx.image, '--format', '{{.Size}}'],
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
        ).trim();
        const sizeMB = (parseInt(info, 10) / 1024 / 1024).toFixed(0);
        found.push({ type: 'Image', name: ctx.image, detail: `${sizeMB} MB` });
      } catch {
        /* doesn't exist */
      }
    }
```

- [ ] **Step 3: Update bin/devrig.js — remove --npm from help text**

In `bin/devrig.js`, remove this line from the `start` help text (line 39):

```
  --npm            Use npm-based Claude Code installer instead of native
```

Also remove the example line (around line 48-49):

```
  devrig start --rebuild --npm  Force rebuild using npm installer
```

- [ ] **Step 4: Update README.md — remove npm references**

In `README.md`, remove the `--npm` row from the "Flags for `start`" table (line 74):

```
| `--npm`           | Use npm-based Claude Code installer instead of native |
```

In the "Container details" table, change "Installed automatically on first start (native or npm)" to:

```
| **Claude Code** | Installed automatically on first start                                   |
```

In the "Project structure" section, remove these two lines:

```
  Dockerfile.npm     Container image (npm installer)
  compose.npm.yml    Docker Compose for npm variant
```

- [ ] **Step 5: Run full check suite**

Run: `npm run check`
Expected: All tests pass, no references to npm variant remain.

- [ ] **Step 6: Commit**

```bash
git add test/init.test.js src/clean.js bin/devrig.js README.md
git commit -m "chore: remove npm variant from tests, clean, help, and docs"
```

---

## Phase 2: New Commands

### Task 5: `devrig logs` command

**Files:**

- Create: `src/logs.js`
- Modify: `bin/devrig.js`
- Create: `test/logs.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/logs.test.js`:

```js
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDevServerLog, buildDockerLogsArgs } from '../src/logs.js';

describe('logs', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('reads dev server log file', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-logs-'));
    const logsDir = join(tmp, '.devrig', 'logs');
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, 'dev-server.log'), 'line1\nline2\nline3\n');

    const lines = readDevServerLog(tmp);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'line1');
    assert.equal(lines[2], 'line3');
  });

  it('returns empty array when no log file exists', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-logs-'));
    const lines = readDevServerLog(tmp);
    assert.equal(lines.length, 0);
  });

  it('builds docker logs args from session', () => {
    const session = { composeArgs: ['compose', '--project-directory', '.', '--project-name', 'test', '-f', '.devrig/compose.yml'] };
    const args = buildDockerLogsArgs(session, { follow: false });
    assert.ok(args.includes('logs'));
    assert.ok(args.includes('dev'));
  });

  it('builds docker logs args with follow flag', () => {
    const session = { composeArgs: ['compose', '--project-directory', '.', '--project-name', 'test', '-f', '.devrig/compose.yml'] };
    const args = buildDockerLogsArgs(session, { follow: true });
    assert.ok(args.includes('--follow'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs.test.js`
Expected: FAIL — `src/logs.js` doesn't exist.

- [ ] **Step 3: Implement src/logs.js**

Create `src/logs.js`:

```js
// @ts-check
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { log, die } from './log.js';
import { resolveProjectDir } from './config.js';
import { readSession } from './session.js';

/**
 * Reads the dev server log file and returns lines.
 * @param {string} projectDir
 * @returns {string[]}
 */
export function readDevServerLog(projectDir) {
  const logPath = join(projectDir, '.devrig', 'logs', 'dev-server.log');
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

/**
 * Builds the docker compose logs command args from session info.
 * @param {{ composeArgs: string[] }} session
 * @param {{ follow: boolean }} opts
 * @returns {string[]}
 */
export function buildDockerLogsArgs(session, opts) {
  const args = [...session.composeArgs, 'logs'];
  if (opts.follow) args.push('--follow');
  args.push('dev');
  return args;
}

/**
 * Main logs command handler.
 * @param {string[]} argv
 */
export async function logs(argv) {
  const devServer = argv.includes('--dev-server');
  const container = argv.includes('--container');
  const follow = argv.includes('--follow') || argv.includes('-f');

  const projectDir = resolveProjectDir();

  if (devServer || (!devServer && !container)) {
    const lines = readDevServerLog(projectDir);
    if (lines.length > 0) {
      log('Dev server logs:');
      for (const line of lines) console.log(line);
    } else {
      log('No dev server logs found.');
    }
  }

  if (container || (!devServer && !container)) {
    const session = readSession(projectDir);
    if (!session || !session.composeArgs) {
      log('No active session — cannot read container logs.');
      return;
    }

    log('Container logs:');
    const args = buildDockerLogsArgs(session, { follow });
    const child = spawn('docker', args, { stdio: 'inherit' });
    await new Promise((resolve) => child.on('exit', resolve));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs.test.js`
Expected: All 4 tests pass.

- [ ] **Step 5: Wire up bin/devrig.js**

In `bin/devrig.js`, add the import at the top (after the existing imports):

```js
import { logs } from '../src/logs.js';
```

Add the `logs` case to the switch statement (before the `clean` case):

```js
  case 'logs':
    await logs(rest);
    break;
```

Add help text to `subcommandHelp`:

```js
  logs: `Show logs from a devrig session.

By default, shows both dev server and container logs sequentially.

Flags:
  --dev-server  Show only dev server logs
  --container   Show only container logs
  --follow, -f  Stream logs live

Examples:
  devrig logs                  Show all logs
  devrig logs --container -f   Stream container logs live

See also: devrig status`,
```

Add `logs` to the `printUsage` function's command list:

```
  logs      Show logs from a devrig session
```

- [ ] **Step 6: Add test/logs.test.js to package.json test script**

In `package.json`, add `test/logs.test.js` to the `test` script (after `test/session.test.js`):

```json
"test": "node --test test/unit.test.js test/init.test.js test/cleanup.test.js test/configure.test.js test/session.test.js test/logs.test.js",
```

Also add to `test:coverage`:

```json
"test:coverage": "node --test --experimental-test-coverage test/unit.test.js test/init.test.js test/cleanup.test.js test/configure.test.js test/session.test.js test/logs.test.js",
```

- [ ] **Step 7: Run full check suite**

Run: `npm run check`
Expected: All tests pass including the new logs tests.

- [ ] **Step 8: Commit**

```bash
git add src/logs.js test/logs.test.js bin/devrig.js package.json
git commit -m "feat: add devrig logs command"
```

---

### Task 6: `devrig exec` command

**Files:**

- Create: `src/exec.js`
- Modify: `bin/devrig.js`
- Create: `test/exec.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/exec.test.js`:

```js
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildExecArgs, validateSession } from '../src/exec.js';

describe('exec', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('builds docker exec args from session', () => {
    const session = {
      composeArgs: ['compose', '--project-directory', '.', '--project-name', 'test', '-f', '.devrig/compose.yml'],
    };
    const args = buildExecArgs(session);
    assert.ok(args.includes('exec'));
    assert.ok(args.includes('-it'));
    assert.ok(args.includes('dev'));
    assert.ok(args.includes('bash'));
  });

  it('validates session — returns error when no session file', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-exec-'));
    const result = validateSession(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No active session'));
  });

  it('validates session — returns error when session PID is dead', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-exec-'));
    const devrigDir = join(tmp, '.devrig');
    mkdirSync(devrigDir, { recursive: true });
    writeFileSync(join(devrigDir, 'session.json'), JSON.stringify({
      pid: 999999999,
      composeArgs: ['compose', '-f', '.devrig/compose.yml'],
    }));
    const result = validateSession(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not running') || result.error.includes('stopped'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/exec.test.js`
Expected: FAIL — `src/exec.js` doesn't exist.

- [ ] **Step 3: Implement src/exec.js**

Create `src/exec.js`:

```js
// @ts-check
import { spawn } from 'node:child_process';
import { log, die } from './log.js';
import { resolveProjectDir } from './config.js';
import { readSession, isSessionAlive } from './session.js';

/**
 * Validates that a session exists and is running.
 * @param {string} projectDir
 * @returns {{ ok: true, session: object } | { ok: false, error: string }}
 */
export function validateSession(projectDir) {
  const session = readSession(projectDir);
  if (!session) {
    return { ok: false, error: 'No active session. Run "devrig start" first.' };
  }
  if (!isSessionAlive(session)) {
    return { ok: false, error: 'Session is not running (PID stopped). Run "devrig stop" then "devrig start".' };
  }
  return { ok: true, session };
}

/**
 * Builds the docker compose exec args from session info.
 * @param {{ composeArgs: string[] }} session
 * @returns {string[]}
 */
export function buildExecArgs(session) {
  return [...session.composeArgs, 'exec', '-it', 'dev', 'bash'];
}

/**
 * Main exec command handler.
 */
export async function exec() {
  const projectDir = resolveProjectDir();
  const result = validateSession(projectDir);

  if (!result.ok) {
    die(result.error);
  }

  log('Re-attaching to running container...');
  const args = buildExecArgs(result.session);
  const child = spawn('docker', args, { stdio: 'inherit' });

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
  });

  process.exit(exitCode);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/exec.test.js`
Expected: All 3 tests pass.

- [ ] **Step 5: Wire up bin/devrig.js**

In `bin/devrig.js`, add the import:

```js
import { exec } from '../src/exec.js';
```

Add the `exec` case to the switch statement:

```js
  case 'exec':
    await exec();
    break;
```

Add help text to `subcommandHelp`:

```js
  exec: `Re-attach to a running devrig container.

Opens an interactive bash shell inside the running container without
restarting the session. Useful when your terminal disconnects or you
accidentally Ctrl-C'd out of Claude Code.

If no session is active, suggests running devrig start.

Example:
  devrig exec

See also: devrig start, devrig stop`,
```

Add `exec` to the `printUsage` function's command list:

```
  exec      Re-attach to a running container
```

- [ ] **Step 6: Add test/exec.test.js to package.json test script**

In `package.json`, add `test/exec.test.js` to the `test` script (after `test/logs.test.js`):

```json
"test": "node --test test/unit.test.js test/init.test.js test/cleanup.test.js test/configure.test.js test/session.test.js test/logs.test.js test/exec.test.js",
```

Also add to `test:coverage`:

```json
"test:coverage": "node --test --experimental-test-coverage test/unit.test.js test/init.test.js test/cleanup.test.js test/configure.test.js test/session.test.js test/logs.test.js test/exec.test.js",
```

- [ ] **Step 7: Run full check suite**

Run: `npm run check`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/exec.js test/exec.test.js bin/devrig.js package.json
git commit -m "feat: add devrig exec command for container re-attach"
```

---

### Task 7: `devrig doctor` command

**Files:**

- Create: `src/doctor.js`
- Modify: `bin/devrig.js`
- Create: `test/doctor.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/doctor.test.js`:

```js
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkNodeVersion,
  checkDevrigDir,
  checkTomlValid,
  checkVersionStaleness,
  checkPortAvailable,
} from '../src/doctor.js';

describe('doctor checks', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('checkNodeVersion passes on current runtime', () => {
    const result = checkNodeVersion();
    assert.equal(result.status, 'pass');
  });

  it('checkDevrigDir fails when .devrig missing', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    const result = checkDevrigDir(tmp);
    assert.equal(result.status, 'fail');
  });

  it('checkDevrigDir passes when .devrig exists with key files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    const devrig = join(tmp, '.devrig');
    mkdirSync(devrig);
    writeFileSync(join(devrig, 'Dockerfile'), '');
    writeFileSync(join(devrig, 'compose.yml'), '');
    writeFileSync(join(devrig, 'entrypoint.sh'), '');
    const result = checkDevrigDir(tmp);
    assert.equal(result.status, 'pass');
  });

  it('checkTomlValid fails when devrig.toml missing', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    const result = checkTomlValid(tmp);
    assert.equal(result.status, 'fail');
  });

  it('checkTomlValid passes with valid toml', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    writeFileSync(join(tmp, 'devrig.toml'), 'tool = "claude"\nproject = "test"\n');
    const result = checkTomlValid(tmp);
    assert.equal(result.status, 'pass');
  });

  it('checkVersionStaleness warns on mismatch', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    mkdirSync(join(tmp, '.devrig'));
    writeFileSync(join(tmp, '.devrig', '.devrig-version'), '0.0.1\n');
    const result = checkVersionStaleness(tmp);
    assert.equal(result.status, 'warn');
  });

  it('checkPortAvailable passes for unused port', async () => {
    const result = await checkPortAvailable(0, 'test port');
    assert.equal(result.status, 'pass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/doctor.test.js`
Expected: FAIL — `src/doctor.js` doesn't exist.

- [ ] **Step 3: Implement src/doctor.js**

Create `src/doctor.js`:

```js
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
    return { status: 'warn', message: `Scaffold v${scaffoldVersion}, devrig v${currentVersion} — run "devrig update"` };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/doctor.test.js`
Expected: All 7 tests pass.

- [ ] **Step 5: Wire up bin/devrig.js**

In `bin/devrig.js`, add the import:

```js
import { runAll as runDoctor } from '../src/doctor.js';
```

Add the `doctor` case to the switch statement:

```js
  case 'doctor': {
    const projectDir = resolveProjectDir();
    await runDoctor(projectDir);
    break;
  }
```

Add help text to `subcommandHelp`:

```js
  doctor: `Run pre-flight health checks for devrig.

Checks Node.js version, Docker daemon, Docker Compose, Chrome browser,
.devrig/ directory, devrig.toml validity, version staleness, and port
availability.

Example:
  devrig doctor

See also: devrig init, devrig start`,
```

Add `doctor` to the `printUsage` function's command list:

```
  doctor    Run pre-flight health checks
```

- [ ] **Step 6: Add test/doctor.test.js to package.json test script**

In `package.json`, add `test/doctor.test.js` to the `test` script (after `test/exec.test.js`):

```json
"test": "node --test test/unit.test.js test/init.test.js test/cleanup.test.js test/configure.test.js test/session.test.js test/logs.test.js test/exec.test.js test/doctor.test.js",
```

Also add to `test:coverage`:

```json
"test:coverage": "node --test --experimental-test-coverage test/unit.test.js test/init.test.js test/cleanup.test.js test/configure.test.js test/session.test.js test/logs.test.js test/exec.test.js test/doctor.test.js",
```

- [ ] **Step 7: Run full check suite**

Run: `npm run check`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/doctor.js test/doctor.test.js bin/devrig.js package.json
git commit -m "feat: add devrig doctor pre-flight health check"
```

---

## Phase 3: Version Pinning

### Task 8: Add version field to TOML config

**Files:**

- Modify: `src/config.js:60-83`
- Modify: `test/unit.test.js` (if it has config tests)

- [ ] **Step 1: Check if unit.test.js has config tests**

Read `test/unit.test.js` to find any `parseTOML` or `loadConfig` tests.

- [ ] **Step 2: Write the failing test**

Add to the config test file (either `test/unit.test.js` or create a section):

```js
it('parses claude version from toml', () => {
  const toml = 'project = "test"\n\n[claude]\nversion = "2.1.89"\nready_timeout = 120\n';
  const result = parseTOML(toml);
  assert.equal(result.claude.version, '2.1.89');
  assert.equal(result.claude.ready_timeout, 120);
});
```

- [ ] **Step 3: Run test to verify it passes (TOML parser already handles this)**

Run: `node --test test/unit.test.js`
Expected: PASS — the TOML parser already handles string values in sections. If it fails, fix accordingly.

- [ ] **Step 4: Add claude_version to loadConfig output**

In `src/config.js`, update the `loadConfig` function to extract the version:

Add after line 71 (`const claude = raw.claude ?? {};`):

```js
  const claudeVer = claude.version ?? 'latest';
```

Add `claude_version: claudeVersion,` to the return object (after `claude_timeout`):

```js
    claude_version: claudeVer,
```

- [ ] **Step 5: Write test for loadConfig with version**

```js
it('loadConfig returns claude_version from toml', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));
  writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\n\n[claude]\nversion = "stable"\n');
  // loadConfig needs the file to exist, so we test parseTOML + defaults instead
  const raw = parseTOML('project = "test"\n\n[claude]\nversion = "stable"\n');
  assert.equal(raw.claude.version, 'stable');
  rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 6: Run full check suite**

Run: `npm run check`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/config.js test/unit.test.js
git commit -m "feat: add claude version field to TOML config"
```

---

### Task 9: Write version to TOML during configure

**Files:**

- Modify: `src/configure.js:86-103`

- [ ] **Step 1: Add version to TOML output**

In `src/configure.js`, after the chrome bridge section (around line 102), add the claude section. Replace the section starting at line 86 (`// Build TOML`) through line 103:

```js
  // Build TOML
  let toml = `# devrig — ${project}\n# Generated by: devrig config\n\n`;
  toml += `tool = "${tool}"\nproject = "${project}"\n\n`;

  if (useDevServer) {
    toml += `[dev_server]\ncommand = "${devCommand}"\nport = ${devPort}\n`;
    if (devTimeout !== 10) toml += `ready_timeout = ${devTimeout}\n`;
    toml += '\n';
  } else {
    toml += `# [dev_server]\n# command = "npm run dev"\n# port = 3000\n\n`;
  }

  if (useChrome) {
    toml += `[chrome_bridge]\nport = ${chromePort}\n\n`;
  } else {
    toml += `# [chrome_bridge]\n# port = 9229\n\n`;
  }

  toml += `[claude]\nversion = "latest"\n`;
```

- [ ] **Step 2: Run full check suite**

Run: `npm run check`
Expected: All tests pass. The existing configure test should still work — it checks for `[dev_server]` and `[chrome_bridge]` which are still present.

- [ ] **Step 3: Commit**

```bash
git add src/configure.js
git commit -m "feat: write [claude] version = \"latest\" during configure"
```

---

### Task 10: Update container-setup.js for version pinning

**Files:**

- Modify: `scaffold/container-setup.js`

- [ ] **Step 1: Rewrite installClaudeCodeNative for version awareness**

Replace the `installClaudeCodeNative` function in `scaffold/container-setup.js`:

```js
function installClaudeCodeNative() {
  const version = process.env.CLAUDE_VERSION || 'latest';
  const versionMarker = join(process.env.HOME || '/home/dev', '.claude-version');

  // Skip install if already installed and version matches
  if (which('claude') && existsSync(versionMarker)) {
    const installed = readFileSync(versionMarker, 'utf8').trim();
    if (installed === version || (version === 'latest' && installed)) {
      log(`claude already installed: ${claudeVersion()} (pinned: ${installed})`);
      return;
    }
  }

  if (which('claude')) {
    log(`claude found: ${claudeVersion()}`);
    if (version === 'latest' || version === 'stable') {
      log(`Re-installing (channel: ${version})...`);
    } else {
      log(`Re-installing (version: ${version})...`);
    }
  } else {
    log('claude not found — installing via native installer');
  }

  // Install with version argument
  const installArgs = version === 'latest'
    ? `curl -fsSL ${NATIVE_INSTALLER_URL} | bash`
    : `curl -fsSL ${NATIVE_INSTALLER_URL} | bash -s ${version}`;

  execFileSync('bash', ['-c', installArgs], { stdio: 'inherit' });

  // Write version marker
  const resolvedVersion = version === 'latest' || version === 'stable' ? version : version;
  writeFileSync(versionMarker, resolvedVersion + '\n');

  log(`Installed: ${claudeVersion()}`);
}
```

- [ ] **Step 2: Simplify installClaudeCode**

Replace the `installClaudeCode` function:

```js
function installClaudeCode() {
  installClaudeCodeNative();
}
```

- [ ] **Step 3: Add DISABLE_AUTOUPDATER to Claude settings**

At the end of the `setupChromeBridge` function (or add a new function after it), add auto-updater disabling. Add this after the `setupChromeBridge()` call in the main section:

```js
// Disable auto-updater inside the container — updates happen on --rebuild
function disableAutoUpdater() {
  const home = process.env.HOME || '/home/dev';
  const settingsPath = join(home, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch { /* start fresh */ }
  }
  settings.env = settings.env || {};
  settings.env.DISABLE_AUTOUPDATER = '1';
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  log('Auto-updater disabled (updates via --rebuild)');
}
```

Update the main section at the bottom:

```js
installClaudeCode();
setupChromeBridge();
disableAutoUpdater();
```

- [ ] **Step 4: Run lint and format**

Run: `npx prettier --write scaffold/container-setup.js && npx eslint scaffold/container-setup.js`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add scaffold/container-setup.js
git commit -m "feat: version-aware Claude Code installation with auto-update disabled"
```

---

### Task 11: Pass CLAUDE_VERSION through compose

**Files:**

- Modify: `scaffold/compose.yml`

- [ ] **Step 1: Add CLAUDE_VERSION to compose environment**

In `scaffold/compose.yml`, add to the `environment` section (after the BRIDGE_PORT line):

```yaml
      - CLAUDE_VERSION=${CLAUDE_VERSION:-latest}
```

- [ ] **Step 2: Pass CLAUDE_VERSION from launcher**

In `src/launcher.js`, after `process.env.HOST_UID = String(userInfo().uid);` (line 108), add:

```js
  process.env.CLAUDE_VERSION = cfg.claude_version;
```

- [ ] **Step 3: Run lint and format**

Run: `npm run check`
Expected: All clean.

- [ ] **Step 4: Commit**

```bash
git add scaffold/compose.yml src/launcher.js
git commit -m "feat: pass CLAUDE_VERSION from toml through compose to container"
```

---

## Phase 4: Medium Items

### Task 12: Port conflict messaging consistency

**Files:**

- Modify: `src/launcher.js:221,253-256`

- [ ] **Step 1: Improve bridge failure message**

In `src/launcher.js`, replace line 221:

```js
      die(`Chrome bridge failed to start — port ${cfg.bridge_port} may be in use.\n  Try: lsof -i :${cfg.bridge_port} to see what's using it`);
```

- [ ] **Step 2: Improve dev server warning message**

In `src/launcher.js`, replace lines 253-256:

```js
    if (!devReady) {
      log(
        `WARNING: Dev server not reachable at localhost:${cfg.dev_server_port} after ${cfg.dev_server_timeout}s — Claude can still work but won't see your app in the browser`,
      );
    }
```

- [ ] **Step 3: Run lint and format**

Run: `npm run check`
Expected: All clean.

- [ ] **Step 4: Commit**

```bash
git add src/launcher.js
git commit -m "fix: improve port conflict and dev server timeout messages"
```

---

### Task 13: `devrig update` command

**Files:**

- Create: `src/update.js`
- Modify: `bin/devrig.js`
- Create: `test/update.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/update.test.js`:

```js
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findChangedFiles } from '../src/update.js';

const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold');

describe('update', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('detects no changes when files match', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-upd-'));
    const devrig = join(tmp, '.devrig');
    cpSync(scaffoldDir, devrig, { recursive: true });
    const changed = findChangedFiles(tmp, scaffoldDir);
    assert.equal(changed.length, 0);
  });

  it('detects changed files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-upd-'));
    const devrig = join(tmp, '.devrig');
    cpSync(scaffoldDir, devrig, { recursive: true });
    // Modify a file
    writeFileSync(join(devrig, 'entrypoint.sh'), 'modified content');
    const changed = findChangedFiles(tmp, scaffoldDir);
    assert.ok(changed.length > 0);
    assert.ok(changed.some((f) => f.name === 'entrypoint.sh'));
  });

  it('skips home and session.json', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-upd-'));
    const devrig = join(tmp, '.devrig');
    cpSync(scaffoldDir, devrig, { recursive: true });
    mkdirSync(join(devrig, 'home'), { recursive: true });
    writeFileSync(join(devrig, 'home', 'testfile'), 'data');
    writeFileSync(join(devrig, 'session.json'), '{}');
    const changed = findChangedFiles(tmp, scaffoldDir);
    assert.ok(!changed.some((f) => f.name.includes('home')));
    assert.ok(!changed.some((f) => f.name.includes('session.json')));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/update.test.js`
Expected: FAIL — `src/update.js` doesn't exist.

- [ ] **Step 3: Implement src/update.js**

Create `src/update.js`:

```js
// @ts-check
import { readFileSync, writeFileSync, existsSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { log, die } from './log.js';
import { resolveProjectDir, getPackageVersion } from './config.js';

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
  log('Version marker updated.');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/update.test.js`
Expected: All 3 tests pass.

- [ ] **Step 5: Wire up bin/devrig.js**

In `bin/devrig.js`, add the import:

```js
import { update } from '../src/update.js';
```

Add the `update` case to the switch statement:

```js
  case 'update':
    await update(rest);
    break;
```

Add help text to `subcommandHelp`:

```js
  update: `Update scaffold files from the installed devrig version.

Compares each file in .devrig/ against the current devrig package and
shows which files differ. Prompts before overwriting. Skips user data
(.devrig/home/) and runtime state (.devrig/session.json).

Flags:
  --force  Skip confirmation prompt

Example:
  devrig update

See also: devrig init, devrig doctor`,
```

Add `update` to the `printUsage` function's command list:

```
  update    Update scaffold files to current version
```

- [ ] **Step 6: Add test/update.test.js to package.json test script**

Add `test/update.test.js` to the `test` and `test:coverage` scripts in `package.json`.

- [ ] **Step 7: Run full check suite**

Run: `npm run check`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/update.js test/update.test.js bin/devrig.js package.json
git commit -m "feat: add devrig update command for scaffold file updates"
```

---

## Phase 5: Documentation

### Task 14: Document Dockerfile customization and npm packages

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add Customization section to README**

After the "Configuration" section and before "What's Inside the Container", add:

```markdown
## Customization

### Dockerfile

Edit `.devrig/Dockerfile` directly to add system packages, change the base image, or modify the container setup. Your changes survive `devrig start` and `--rebuild` — the image is always built from your local Dockerfile.

> [!WARNING]
> Running `devrig init` again will prompt to overwrite `.devrig/`. Use `devrig update` to selectively update scaffold files without losing your Dockerfile changes.

For compose-level changes (volumes, ports, resource limits), create a `docker-compose.override.yml` in your project root.

### Package persistence

`node_modules` is a named Docker volume — it persists across container restarts and even `--rebuild`. Running `devrig clean` removes the volume, triggering a fresh `npm install` on the next start. For large projects, the first start may be slow while packages install inside the container.
```

- [ ] **Step 2: Run format check**

Run: `npx prettier --write README.md`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Dockerfile customization and package persistence sections"
```

---

### Task 15: Update README CLI table and config reference

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add new commands to CLI table**

In the CLI table, add rows for the new commands:

```markdown
| `devrig logs [flags]`       | Show logs from a devrig session                                              |
| `devrig exec`               | Re-attach to a running container                                             |
| `devrig doctor`             | Run pre-flight health checks                                                 |
| `devrig update [--force]`   | Update scaffold files to current devrig version                              |
```

- [ ] **Step 2: Add version field to config reference**

In the devrig.toml example, add:

```toml
[claude]
version = "latest"       # "latest", "stable", or a specific version like "2.1.89"
# ready_timeout = 120    # Seconds to wait for Claude Code setup
```

In the full config reference table, add:

```markdown
| `version`       | `[claude]`        | `"latest"`         | Claude Code version: "latest", "stable", or "2.1.89" |
```

- [ ] **Step 3: Update project structure to reflect new files**

In the project structure section, add the new source files and remove the npm ones:

```
  logs.js          Log viewer (dev server + container)
  exec.js          Container re-attach
  doctor.js        Pre-flight health checks
  update.js        Scaffold file updater
```

- [ ] **Step 4: Run format check**

Run: `npx prettier --write README.md`

- [ ] **Step 5: Run full check suite**

Run: `npm run check`
Expected: All clean.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: update CLI table, config reference, and project structure"
```

---

## Verification

After all tasks are complete:

1. `npm run check` — all lint, format, typecheck, tests pass
2. `devrig doctor` — runs without error (checks may warn about Docker if running inside container)
3. `devrig logs --help` — shows help text
4. `devrig exec --help` — shows help text
5. `devrig update --help` — shows help text
6. No references to `--npm`, `Dockerfile.npm`, or `compose.npm.yml` remain in the codebase
7. `devrig.toml` generated by `devrig config` includes `[claude] version = "latest"`
