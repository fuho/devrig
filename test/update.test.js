import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
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
