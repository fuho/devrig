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
      'Dockerfile.npm',
      'compose.yml',
      'compose.npm.yml',
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
