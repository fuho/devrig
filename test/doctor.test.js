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
