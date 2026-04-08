import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseTOML,
  loadConfig,
  loadDotenv,
  resolveProjectDir,
  resolveEnvDir,
} from '../src/config.js';
import { composeCmd, initVariant, buildFiles, buildHash } from '../src/docker.js';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// parseTOML
// ---------------------------------------------------------------------------

describe('parseTOML', () => {
  it('parses basic top-level key=value', () => {
    assert.deepStrictEqual(parseTOML('project = "my-app"'), { project: 'my-app' });
  });

  it('parses integer values', () => {
    assert.deepStrictEqual(parseTOML('port = 3000'), { port: 3000 });
  });

  it('parses sections', () => {
    const input = '[dev_server]\ncommand = "npm run dev"\nport = 3000';
    assert.deepStrictEqual(parseTOML(input), {
      dev_server: { command: 'npm run dev', port: 3000 },
    });
  });

  it('skips comments and blank lines', () => {
    const input = '# a comment\n\nproject = "app"\n\n# another comment';
    assert.deepStrictEqual(parseTOML(input), { project: 'app' });
  });

  it('parses a full config with tool field', () => {
    const input = [
      'project = "my-app"',
      'tool = "claude"',
      '',
      '[dev_server]',
      'command = "npm run dev"',
      'port = 8080',
      '',
      '[chrome_bridge]',
      'port = 9229',
    ].join('\n');

    assert.deepStrictEqual(parseTOML(input), {
      project: 'my-app',
      tool: 'claude',
      dev_server: { command: 'npm run dev', port: 8080 },
      chrome_bridge: { port: 9229 },
    });
  });

  it('handles single-quoted strings', () => {
    assert.deepStrictEqual(parseTOML("name = 'hello'"), { name: 'hello' });
  });

  it('parses claude version from toml', () => {
    const toml = 'project = "test"\n\n[claude]\nversion = "2.1.89"\nready_timeout = 120\n';
    const result = parseTOML(toml);
    assert.equal(result.claude.version, '2.1.89');
    assert.equal(result.claude.ready_timeout, 120);
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads and normalizes a devrig.toml', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    const toml = [
      'project = "test-proj"',
      'tool = "cursor"',
      '[dev_server]',
      'command = "node server.js"',
      'port = 4000',
      '[chrome_bridge]',
      'port = 9999',
    ].join('\n');
    writeFileSync(join(tmpDir, 'devrig.toml'), toml);

    const cfg = loadConfig(tmpDir);
    assert.equal(cfg.project, 'test-proj');
    assert.equal(cfg.tool, 'cursor');
    assert.equal(cfg.dev_server_cmd, 'node server.js');
    assert.equal(cfg.dev_server_port, 4000);
    assert.equal(cfg.bridge_enabled, true);
    assert.equal(cfg.bridge_port, 9999);
  });

  it('applies defaults when sections are missing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    writeFileSync(join(tmpDir, 'devrig.toml'), 'project = "bare"');

    const cfg = loadConfig(tmpDir);
    assert.equal(cfg.bridge_port, 9229);
    assert.equal(cfg.dev_server_port, 3000);
    assert.equal(cfg.tool, 'claude');
    assert.equal(cfg.bridge_enabled, false);
  });

  it('sets bridge_enabled true when [chrome_bridge] present', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    writeFileSync(join(tmpDir, 'devrig.toml'), 'project = "x"\n[chrome_bridge]');

    const cfg = loadConfig(tmpDir);
    assert.equal(cfg.bridge_enabled, true);
  });
});

// ---------------------------------------------------------------------------
// loadDotenv
// ---------------------------------------------------------------------------

describe('loadDotenv', () => {
  let tmpDir;
  const envKeys = [];

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    for (const k of envKeys) delete process.env[k];
    envKeys.length = 0;
  });

  it('loads key=value pairs into process.env', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    const content = [
      'SIMPLE=hello',
      'DOUBLE="quoted value"',
      "SINGLE='single quoted'",
      '# comment line',
      '',
      'NUM=42',
    ].join('\n');
    writeFileSync(join(tmpDir, '.env'), content);
    envKeys.push('SIMPLE', 'DOUBLE', 'SINGLE', 'NUM');

    loadDotenv(tmpDir);

    assert.equal(process.env.SIMPLE, 'hello');
    assert.equal(process.env.DOUBLE, 'quoted value');
    assert.equal(process.env.SINGLE, 'single quoted');
    assert.equal(process.env.NUM, '42');
  });

  it('does not throw when .env is missing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-env-'));
    assert.doesNotThrow(() => loadDotenv(tmpDir));
  });
});

// ---------------------------------------------------------------------------
// resolveEnvDir
// ---------------------------------------------------------------------------

describe('resolveEnvDir', () => {
  it('returns project .devrig/ for local environment', () => {
    const result = resolveEnvDir({ environment: 'local' }, '/tmp/myproject');
    assert.equal(result, join('/tmp/myproject', '.devrig'));
  });

  it('returns ~/.devrig/environments/{name}/ for named environment', () => {
    const result = resolveEnvDir({ environment: 'default' }, '/tmp/myproject');
    assert.equal(result, join(homedir(), '.devrig', 'environments', 'default'));
  });

  it('returns ~/.devrig/environments/{name}/ for custom environment', () => {
    const result = resolveEnvDir({ environment: 'work' }, '/tmp/myproject');
    assert.equal(result, join(homedir(), '.devrig', 'environments', 'work'));
  });

  it('uses custom environmentsRoot when provided', () => {
    const result = resolveEnvDir({ environment: 'work' }, '/tmp/myproject', '/custom/root');
    assert.equal(result, join('/custom/root', 'work'));
  });

  it('ignores environmentsRoot for local environment', () => {
    const result = resolveEnvDir({ environment: 'local' }, '/tmp/myproject', '/custom/root');
    assert.equal(result, join('/tmp/myproject', '.devrig'));
  });
});

// ---------------------------------------------------------------------------
// loadConfig (environment field)
// ---------------------------------------------------------------------------

describe('loadConfig environment field', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults environment to "default" when omitted', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    writeFileSync(join(tmpDir, 'devrig.toml'), 'project = "test"');
    const cfg = loadConfig(tmpDir);
    assert.equal(cfg.environment, 'default');
  });

  it('reads environment from toml', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    writeFileSync(join(tmpDir, 'devrig.toml'), 'project = "test"\nenvironment = "work"\n');
    const cfg = loadConfig(tmpDir);
    assert.equal(cfg.environment, 'work');
  });
});

// ---------------------------------------------------------------------------
// composeCmd
// ---------------------------------------------------------------------------

describe('composeCmd', () => {
  it('returns the correct docker compose array', () => {
    const ctx = { project: 'test', composeFile: '.devrig/compose.yml' };
    const result = composeCmd(ctx, 'up', '-d');
    assert.deepStrictEqual(result, [
      'docker',
      'compose',
      '--project-directory',
      '.',
      '--project-name',
      'test',
      '-f',
      '.devrig/compose.yml',
      'up',
      '-d',
    ]);
  });
});

// ---------------------------------------------------------------------------
// initVariant
// ---------------------------------------------------------------------------

describe('initVariant', () => {
  it('returns native variant config with default devrig dir', () => {
    const v = initVariant({ project: 'myproj' });
    assert.ok(v.composeFile.includes('compose.yml'));
    assert.equal(v.image, 'myproj-dev:latest');
    assert.equal(v.dockerfile, 'Dockerfile');
    assert.equal(v.devrigDir, '.devrig');
  });

  it('uses provided envDir', () => {
    const v = initVariant({ project: 'myproj' }, '/home/user/.devrig/environments/default');
    assert.ok(v.composeFile.includes('/home/user/.devrig/environments/default/compose.yml'));
    assert.equal(v.devrigDir, '/home/user/.devrig/environments/default');
  });
});

// ---------------------------------------------------------------------------
// buildFiles with environment paths
// ---------------------------------------------------------------------------

describe('buildFiles with environment dir', () => {
  it('returns absolute paths when devrigDir is an absolute environment path', () => {
    const envDir = '/tmp/devrig-environments/myenv';
    const ctx = initVariant({ project: 'myproj' }, envDir);
    const files = buildFiles(ctx);
    for (const f of files) {
      assert.ok(f.startsWith(envDir), `expected ${f} to start with ${envDir}`);
    }
    assert.equal(files.length, 5);
  });
});

// ---------------------------------------------------------------------------
// resolveProjectDir
// ---------------------------------------------------------------------------

describe('resolveProjectDir', () => {
  it('finds devrig.toml in current dir', () => {
    const origCwd = process.cwd();
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'devrig-test-')));
    try {
      writeFileSync(join(tmpDir, 'devrig.toml'), 'project = "test"');
      process.chdir(tmpDir);
      assert.equal(resolveProjectDir(), tmpDir);
    } finally {
      process.chdir(origCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds .devrig/ directory in current dir', () => {
    const origCwd = process.cwd();
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'devrig-test-')));
    try {
      mkdirSync(join(tmpDir, '.devrig'));
      process.chdir(tmpDir);
      assert.equal(resolveProjectDir(), tmpDir);
    } finally {
      process.chdir(origCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('walks up from nested subdir to find devrig.toml', () => {
    const origCwd = process.cwd();
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'devrig-test-')));
    try {
      writeFileSync(join(tmpDir, 'devrig.toml'), 'project = "test"');
      const deepDir = join(tmpDir, 'sub', 'deep');
      mkdirSync(deepDir, { recursive: true });
      process.chdir(deepDir);
      assert.equal(resolveProjectDir(), tmpDir);
    } finally {
      process.chdir(origCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('stops at .git boundary and dies', () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'devrig-test-')));
    try {
      mkdirSync(join(tmpDir, '.git'));
      mkdirSync(join(tmpDir, 'sub'));
      // Run in a subprocess because die() calls process.exit(1) via a captured binding
      const srcPath = new URL('../src/config.js', import.meta.url).pathname;
      assert.throws(() => {
        execFileSync(
          'node',
          ['-e', `import { resolveProjectDir } from '${srcPath}'; resolveProjectDir();`],
          { cwd: join(tmpDir, 'sub'), stdio: 'pipe' },
        );
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// buildFiles
// ---------------------------------------------------------------------------

describe('buildFiles', () => {
  it('returns the correct array of file paths', () => {
    const ctx = {
      devrigDir: '.devrig',
      dockerfile: 'Dockerfile',
      composeFile: '.devrig/compose.yml',
    };
    const files = buildFiles(ctx);
    assert.deepStrictEqual(files, [
      '.devrig/Dockerfile',
      '.devrig/entrypoint.sh',
      '.devrig/container-setup.js',
      '.devrig/chrome-mcp-bridge.cjs',
      '.devrig/compose.yml',
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildHash
// ---------------------------------------------------------------------------

describe('buildHash', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function createCtxWithFiles(tmpDir, contents) {
    const devrigDir = join(tmpDir, '.devrig');
    mkdirSync(devrigDir, { recursive: true });
    writeFileSync(join(devrigDir, 'Dockerfile'), contents.dockerfile ?? 'FROM node:20');
    writeFileSync(join(devrigDir, 'entrypoint.sh'), contents.entrypoint ?? '#!/bin/sh');
    writeFileSync(join(devrigDir, 'container-setup.js'), contents.setup ?? 'console.log("setup")');
    writeFileSync(join(devrigDir, 'compose.yml'), contents.compose ?? 'version: "3"');
    writeFileSync(join(devrigDir, 'chrome-mcp-bridge.cjs'), contents.bridge ?? '// bridge');
    return {
      devrigDir: join(tmpDir, '.devrig'),
      dockerfile: 'Dockerfile',
      composeFile: join(tmpDir, '.devrig', 'compose.yml'),
    };
  }

  it('returns a 64-char hex string', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    const ctx = createCtxWithFiles(tmpDir, {});
    const hash = buildHash(ctx);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('is deterministic (same files produce same hash)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    const ctx = createCtxWithFiles(tmpDir, {});
    const hash1 = buildHash(ctx);
    const hash2 = buildHash(ctx);
    assert.equal(hash1, hash2);
  });

  it('changes when a file is modified', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-test-'));
    const ctx = createCtxWithFiles(tmpDir, {});
    const hash1 = buildHash(ctx);
    writeFileSync(join(tmpDir, '.devrig', 'Dockerfile'), 'FROM node:22');
    const hash2 = buildHash(ctx);
    assert.notEqual(hash1, hash2);
  });
});
