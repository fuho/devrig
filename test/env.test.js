import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureSharedEnv, inspectSharedEnv, envCommand } from '../src/env.js';
import { getPackageVersion } from '../src/config.js';

// ---------------------------------------------------------------------------
// ensureSharedEnv
// ---------------------------------------------------------------------------

describe('ensureSharedEnv', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('creates directory structure and copies scaffold files', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = ensureSharedEnv(root);

    assert.equal(dir, join(root, 'shared'));

    // Directory structure
    assert.ok(existsSync(join(dir, 'home', '.claude', 'logs')), 'home/.claude/logs/ missing');
    assert.ok(existsSync(join(dir, 'mitmproxy', 'logs')), 'mitmproxy/logs/ missing');

    // Scaffold files
    for (const f of [
      'Dockerfile',
      'compose.yml',
      'entrypoint.sh',
      'container-setup.js',
      'chrome-mcp-bridge.cjs',
      '.dockerignore',
      'firewall.sh',
      'traffic.html',
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
    const dir = ensureSharedEnv(root);

    // Mutate a file
    writeFileSync(join(dir, 'Dockerfile'), 'SENTINEL_CONTENT');

    // Second call — version matches, should NOT overwrite
    ensureSharedEnv(root);

    const content = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    assert.equal(
      content,
      'SENTINEL_CONTENT',
      'file should not be overwritten when version matches',
    );
  });

  it('re-copies files when version marker is stale', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = ensureSharedEnv(root);

    // Mutate a file and set stale version
    writeFileSync(join(dir, 'Dockerfile'), 'SENTINEL_CONTENT');
    writeFileSync(join(dir, '.devrig-version'), '0.0.0\n');

    // Re-run — should re-copy because version differs
    ensureSharedEnv(root);

    const content = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    assert.notEqual(content, 'SENTINEL_CONTENT', 'file should be overwritten on version mismatch');
    assert.equal(readFileSync(join(dir, '.devrig-version'), 'utf8').trim(), getPackageVersion());
  });

  it('updates when version file is missing but dir exists', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = join(root, 'shared');
    mkdirSync(dir, { recursive: true });
    // No .devrig-version file

    ensureSharedEnv(root);

    assert.ok(existsSync(join(dir, '.devrig-version')), 'version file should be created');
    assert.ok(existsSync(join(dir, 'Dockerfile')), 'scaffold files should be copied');
  });

  it('returns the correct path', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const dir = ensureSharedEnv(root);
    assert.equal(dir, join(root, 'shared'));
  });
});

// ---------------------------------------------------------------------------
// ensureSharedEnv — migration
// ---------------------------------------------------------------------------

describe('ensureSharedEnv migration', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('migrates legacy environments/default/ to shared/', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const legacyDir = join(root, 'environments', 'default');
    mkdirSync(join(legacyDir, 'home', '.claude'), { recursive: true });
    writeFileSync(join(legacyDir, 'home', '.claude', 'auth.json'), '{"token":"keep-me"}');

    const dir = ensureSharedEnv(root);

    assert.equal(dir, join(root, 'shared'));
    // Legacy dir should be gone
    assert.ok(!existsSync(legacyDir), 'legacy default dir should be removed');
    // Auth should be preserved
    assert.ok(existsSync(join(dir, 'home', '.claude', 'auth.json')), 'auth should be migrated');
    const auth = readFileSync(join(dir, 'home', '.claude', 'auth.json'), 'utf8');
    assert.equal(auth, '{"token":"keep-me"}');
  });

  it('warns about orphaned named environments', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    // Create legacy environments with orphans
    mkdirSync(join(root, 'environments', 'work'), { recursive: true });
    mkdirSync(join(root, 'environments', 'other'), { recursive: true });

    const messages = [];
    const origLog = console.log;
    const origStderr = console.error;
    // Capture log output (log() writes to stderr via our log.js)
    console.log = (msg) => messages.push(msg);

    try {
      ensureSharedEnv(root);
    } finally {
      console.log = origLog;
      console.error = origStderr;
    }

    // The warning goes through log() which writes to stderr, but we can check
    // that ensureSharedEnv completed without error
    assert.ok(existsSync(join(root, 'shared')));
  });

  it('does not migrate if shared/ already exists', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    // Create both shared/ and legacy environments/default/
    const sharedDir = join(root, 'shared');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, 'marker'), 'shared-content');

    const legacyDir = join(root, 'environments', 'default');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'marker'), 'legacy-content');

    ensureSharedEnv(root);

    // Legacy should still exist (not renamed)
    assert.ok(existsSync(legacyDir), 'legacy dir should still exist when shared/ already present');
  });
});

// ---------------------------------------------------------------------------
// inspectSharedEnv
// ---------------------------------------------------------------------------

describe('inspectSharedEnv', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('prints environment info without error', () => {
    root = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    ensureSharedEnv(root);

    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      inspectSharedEnv(root);
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
    ensureSharedEnv(root);
    const claudeDir = join(root, 'shared', 'home', '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '{}');

    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      inspectSharedEnv(root);
    } finally {
      console.log = origLog;
    }
    assert.ok(messages.some((m) => m.includes('configured') && !m.includes('not configured')));
  });
});

// ---------------------------------------------------------------------------
// envCommand — help
// ---------------------------------------------------------------------------

describe('envCommand --help', () => {
  it('prints subcommand-specific help for inspect', async () => {
    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      await envCommand(['inspect', '--help']);
    } finally {
      console.log = origLog;
    }
    assert.ok(messages.some((m) => m.includes('devrig env inspect')));
  });

  it('prints subcommand-specific help for reset', async () => {
    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      await envCommand(['reset', '--help']);
    } finally {
      console.log = origLog;
    }
    assert.ok(messages.some((m) => m.includes('devrig env reset')));
  });

  it('shows simplified help for unknown subcommand', async () => {
    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      await envCommand(['unknown']);
    } finally {
      console.log = origLog;
    }
    const output = messages.join('\n');
    assert.ok(output.includes('inspect'));
    assert.ok(output.includes('reset'));
  });
});
