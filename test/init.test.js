import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { getPackageVersion } from '../src/config.js';
import { generateClaudeMd } from '../src/init.js';

const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold');

describe('init scaffold', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('copies scaffold files and sets executable permissions', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cdev-init-'));
    const target = join(tmp, '.devrig');
    cpSync(scaffoldDir, target, { recursive: true });
    chmodSync(join(target, 'entrypoint.sh'), 0o755);
    chmodSync(join(target, 'container-setup.js'), 0o755);

    const expected = [
      'Dockerfile',
      'compose.yml',
      'entrypoint.sh',
      'container-setup.js',
      'devrig.toml.example',
      'template/index.html',
      'template/package.json',
    ];
    for (const f of expected) assert.ok(existsSync(join(target, f)), `${f} missing`);

    const entryMode = statSync(join(target, 'entrypoint.sh')).mode;
    assert.ok(entryMode & 0o111, 'entrypoint.sh should be executable');
    const setupMode = statSync(join(target, 'container-setup.js')).mode;
    assert.ok(setupMode & 0o111, 'container-setup.js should be executable');
  });

  it('writes version marker', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cdev-ver-'));
    const target = join(tmp, '.devrig');
    mkdirSync(target);
    const version = getPackageVersion();
    writeFileSync(join(target, '.devrig-version'), version + '\n');

    assert.equal(readFileSync(join(target, '.devrig-version'), 'utf8'), version + '\n');
  });
});

describe('gitignore update', () => {
  let tmp;
  const entries = ['.devrig/logs/', '.devrig/home/'];
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function applyGitignore(projectDir) {
    const p = join(projectDir, '.gitignore');
    let existing = existsSync(p) ? readFileSync(p, 'utf8') : '';
    const missing = entries.filter((e) => !existing.includes(e));
    if (missing.length > 0) {
      const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
      writeFileSync(p, existing + prefix + missing.join('\n') + '\n');
    }
  }

  it('creates .gitignore when none exists', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cdev-gi-'));
    applyGitignore(tmp);
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');
    assert.ok(content.includes('.devrig/logs/'));
    assert.ok(content.includes('.devrig/home/'));
  });

  it('appends entries to existing .gitignore', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cdev-gi-'));
    writeFileSync(join(tmp, '.gitignore'), 'node_modules/\n');
    applyGitignore(tmp);
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');
    assert.ok(content.startsWith('node_modules/\n'));
    assert.ok(content.includes('.devrig/logs/'));
    assert.ok(content.includes('.devrig/home/'));
  });

  it('does not duplicate existing entries', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cdev-gi-'));
    writeFileSync(join(tmp, '.gitignore'), '.devrig/logs/\n.devrig/home/\n');
    applyGitignore(tmp);
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');
    assert.equal(content.split('.devrig/logs/').length - 1, 1);
    assert.equal(content.split('.devrig/home/').length - 1, 1);
  });
});

describe('devrig.toml.example copy', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('copies devrig.toml.example to project root', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cdev-toml-'));
    const src = join(scaffoldDir, 'devrig.toml.example');
    const dest = join(tmp, 'devrig.toml.example');
    if (existsSync(src) && !existsSync(dest)) cpSync(src, dest);
    assert.ok(existsSync(dest));
    assert.equal(readFileSync(dest, 'utf8'), readFileSync(src, 'utf8'));
  });
});

describe('CLAUDE.md generation', () => {
  let tmp;
  const cfg = { tool: 'claude', dev_server_port: 3000, bridge_enabled: true, bridge_port: 9229 };

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('creates CLAUDE.md when none exists', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    generateClaudeMd(tmp, cfg);
    const content = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('<!-- devrig:start -->'));
    assert.ok(content.includes('<!-- devrig:end -->'));
    assert.ok(content.includes('http://localhost:3000'));
    assert.ok(content.includes('enabled (port 9229)'));
  });

  it('appends to existing CLAUDE.md', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    writeFileSync(join(tmp, 'CLAUDE.md'), '# My Project\n\nExisting content.\n');
    generateClaudeMd(tmp, cfg);
    const content = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    assert.ok(content.startsWith('# My Project'));
    assert.ok(content.includes('<!-- devrig:start -->'));
  });

  it('replaces devrig section on re-run', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    generateClaudeMd(tmp, cfg);
    generateClaudeMd(tmp, {
      tool: 'claude',
      dev_server_port: 8080,
      bridge_enabled: false,
      bridge_port: 9229,
    });
    const content = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('http://localhost:8080'));
    assert.ok(!content.includes('http://localhost:3000'));
    assert.ok(content.includes('disabled'));
    assert.equal(content.split('<!-- devrig:start -->').length - 1, 1);
  });
});
