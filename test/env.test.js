import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { envDir, ensureEnv, listEnvs, deleteEnv, inspectEnv } from '../src/env.js';
import { getPackageVersion } from '../src/config.js';

// ---------------------------------------------------------------------------
// envDir
// ---------------------------------------------------------------------------

describe('envDir', () => {
  it('returns root/name for a named environment', () => {
    const root = '/tmp/test-envs';
    assert.equal(envDir('default', root), join(root, 'default'));
    assert.equal(envDir('work', root), join(root, 'work'));
  });

  it('dies when called with "local"', () => {
    const script = `import { envDir } from './src/env.js'; envDir('local');`;
    assert.throws(() => {
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: process.cwd(),
      });
    });
  });
});

// ---------------------------------------------------------------------------
// ensureEnv
// ---------------------------------------------------------------------------

describe('ensureEnv', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('creates directory structure and copies scaffold files', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = ensureEnv('test-env', root);

    // Directory structure
    assert.ok(existsSync(join(dir, 'home', '.claude', 'logs')), 'home/.claude/logs/ missing');

    // Scaffold files
    for (const f of [
      'Dockerfile',
      'compose.yml',
      'entrypoint.sh',
      'container-setup.js',
      'chrome-mcp-bridge.cjs',
      '.dockerignore',
      'firewall.sh',
      'setup.html',
    ]) {
      assert.ok(existsSync(join(dir, f)), `missing scaffold file: ${f}`);
    }

    // Scaffold directories
    assert.ok(existsSync(join(dir, 'mitmproxy')), 'mitmproxy/ missing');
    assert.ok(existsSync(join(dir, 'mitmproxy', 'allowlist.py')), 'allowlist.py missing');

    // Version marker
    const ver = readFileSync(join(dir, '.devrig-version'), 'utf8').trim();
    assert.equal(ver, getPackageVersion());
  });

  it('is idempotent — second call with matching version skips re-copy', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = ensureEnv('test-env', root);

    // Mutate a file
    writeFileSync(join(dir, 'Dockerfile'), 'SENTINEL_CONTENT');

    // Second call — version matches, should NOT overwrite
    ensureEnv('test-env', root);

    const content = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    assert.equal(
      content,
      'SENTINEL_CONTENT',
      'file should not be overwritten when version matches',
    );
  });

  it('re-copies files when version marker is stale', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = ensureEnv('test-env', root);

    // Mutate a file and set stale version
    writeFileSync(join(dir, 'Dockerfile'), 'SENTINEL_CONTENT');
    writeFileSync(join(dir, '.devrig-version'), '0.0.0\n');

    // Re-run — should re-copy because version differs
    ensureEnv('test-env', root);

    const content = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    assert.notEqual(content, 'SENTINEL_CONTENT', 'file should be overwritten on version mismatch');
    assert.equal(readFileSync(join(dir, '.devrig-version'), 'utf8').trim(), getPackageVersion());
  });

  it('updates when version file is missing but dir exists', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = join(root, 'test-env');
    mkdirSync(dir, { recursive: true });
    // No .devrig-version file

    ensureEnv('test-env', root);

    assert.ok(existsSync(join(dir, '.devrig-version')), 'version file should be created');
    assert.ok(existsSync(join(dir, 'Dockerfile')), 'scaffold files should be copied');
  });

  it('returns the correct path', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = ensureEnv('myenv', root);
    assert.equal(dir, join(root, 'myenv'));
  });
});

// ---------------------------------------------------------------------------
// listEnvs
// ---------------------------------------------------------------------------

describe('listEnvs', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('returns empty array when root does not exist', () => {
    const envs = listEnvs('/tmp/nonexistent-devrig-root-' + Date.now());
    assert.deepStrictEqual(envs, []);
  });

  it('returns empty array when root is empty', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const envs = listEnvs(root);
    assert.deepStrictEqual(envs, []);
  });

  it('lists environments with version info', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    ensureEnv('alpha', root);
    ensureEnv('beta', root);

    const envs = listEnvs(root);
    assert.equal(envs.length, 2);
    const names = envs.map((e) => e.name).sort();
    assert.deepStrictEqual(names, ['alpha', 'beta']);
    assert.equal(envs[0].version, getPackageVersion());
  });

  it('returns null version for env without version file', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    mkdirSync(join(root, 'noversion'));

    const envs = listEnvs(root);
    assert.equal(envs.length, 1);
    assert.equal(envs[0].name, 'noversion');
    assert.equal(envs[0].version, null);
  });
});

// ---------------------------------------------------------------------------
// deleteEnv
// ---------------------------------------------------------------------------

describe('deleteEnv', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('removes an existing environment', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    ensureEnv('to-delete', root);
    assert.ok(existsSync(join(root, 'to-delete')));

    deleteEnv('to-delete', root);
    assert.ok(!existsSync(join(root, 'to-delete')));
  });

  it('dies when environment does not exist', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const script = `import { deleteEnv } from './src/env.js'; deleteEnv('nonexistent', '${root.replace(/'/g, "\\'")}');`;
    const result = (() => {
      try {
        execFileSync(process.execPath, ['--input-type=module', '-e', script], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd(),
        });
        return { exitCode: 0 };
      } catch (err) {
        return { exitCode: err.status, stderr: err.stderr };
      }
    })();
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('does not exist'));
  });
});

// ---------------------------------------------------------------------------
// inspectEnv
// ---------------------------------------------------------------------------

describe('inspectEnv', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('prints environment info without error', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    ensureEnv('inspect-test', root);

    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      inspectEnv('inspect-test', root);
    } finally {
      console.log = origLog;
    }
    const output = messages.join('\n');
    assert.ok(output.includes('Path:'));
    assert.ok(output.includes('Version:'));
    assert.ok(output.includes('not configured'), 'auth should be not configured');
  });

  it('shows auth as configured when settings.json exists', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    ensureEnv('auth-test', root);
    const claudeDir = join(root, 'auth-test', 'home', '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '{}');

    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      inspectEnv('auth-test', root);
    } finally {
      console.log = origLog;
    }
    assert.ok(messages.some((m) => m.includes('configured') && !m.includes('not configured')));
  });
});
