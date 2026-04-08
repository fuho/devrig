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
    tmp = mkdtempSync(join(tmpdir(), 'devrig-init-'));
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
      '.dockerignore',
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
    tmp = mkdtempSync(join(tmpdir(), 'devrig-ver-'));
    const target = join(tmp, '.devrig');
    mkdirSync(target);
    const version = getPackageVersion();
    writeFileSync(join(target, '.devrig-version'), version + '\n');

    assert.equal(readFileSync(join(target, '.devrig-version'), 'utf8'), version + '\n');
  });
});

describe('gitignore update', () => {
  let tmp;
  const entries = ['.devrig/'];
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
    tmp = mkdtempSync(join(tmpdir(), 'devrig-gi-'));
    applyGitignore(tmp);
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');
    assert.ok(content.includes('.devrig/'));
  });

  it('appends entries to existing .gitignore', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-gi-'));
    writeFileSync(join(tmp, '.gitignore'), 'node_modules/\n');
    applyGitignore(tmp);
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');
    assert.ok(content.startsWith('node_modules/\n'));
    assert.ok(content.includes('.devrig/'));
  });

  it('does not duplicate existing entries', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-gi-'));
    writeFileSync(join(tmp, '.gitignore'), '.devrig/\n');
    applyGitignore(tmp);
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');
    assert.equal(content.split('.devrig/').length - 1, 1);
  });
});

describe('devrig.toml.example copy', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('copies devrig.toml.example to project root', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-toml-'));
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

  it('host CLAUDE.md contains host block and NOT container text', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    const content = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('<!-- devrig:start -->'));
    assert.ok(content.includes('<!-- devrig:end -->'));
    assert.ok(content.includes('containerized AI development'));
    assert.ok(content.includes('devrig start'));
    assert.ok(!content.includes('Git push is blocked'));
    assert.ok(!content.includes('/workspace'));
  });

  it('container .devrig/CLAUDE.md contains container block', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    const content = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('<!-- devrig:start -->'));
    assert.ok(content.includes('<!-- devrig:end -->'));
    assert.ok(content.includes('/workspace'));
    assert.ok(content.includes('http://localhost:3000'));
    assert.ok(
      content.includes('outbound network access is restricted') ||
        content.includes('Outbound network access'),
    );
  });

  it('user content outside sentinels preserved in both files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    writeFileSync(join(tmp, 'CLAUDE.md'), '# My Project\n\nExisting content.\n');
    generateClaudeMd(tmp, cfg);
    const hostContent = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    assert.ok(hostContent.includes('# My Project'));
    assert.ok(hostContent.includes('Existing content.'));
    const containerContent = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    assert.ok(containerContent.includes('# My Project'));
    assert.ok(containerContent.includes('Existing content.'));
  });

  it('re-run replaces devrig section in both files reflecting config changes', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    generateClaudeMd(tmp, {
      tool: 'claude',
      dev_server_port: 8080,
      bridge_enabled: false,
      bridge_port: 9229,
    });
    const hostContent = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    assert.equal(hostContent.split('<!-- devrig:start -->').length - 1, 1);
    const containerContent = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    assert.ok(containerContent.includes('http://localhost:8080'));
    assert.ok(!containerContent.includes('http://localhost:3000'));
    assert.ok(containerContent.includes('disabled'));
    assert.equal(containerContent.split('<!-- devrig:start -->').length - 1, 1);
  });

  it('user edits to host CLAUDE.md are picked up in container version on re-generation', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    // User adds new content to host CLAUDE.md outside sentinels
    const hostPath = join(tmp, 'CLAUDE.md');
    const afterFirst = readFileSync(hostPath, 'utf8');
    writeFileSync(hostPath, '# My Project\n\nUser added this.\n' + afterFirst);
    generateClaudeMd(tmp, cfg);
    const containerContent = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    assert.ok(containerContent.includes('User added this.'));
  });
});
