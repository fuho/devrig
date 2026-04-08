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

  it('checkDevrigDir fails when .devrig missing and no config', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    const result = checkDevrigDir(tmp);
    assert.equal(result.status, 'fail');
  });

  it('checkDevrigDir passes when using local environment with key files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    // Write a config that uses local environment so it checks .devrig/
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "local"\n');
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
    // Use local environment so version check looks at .devrig/
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "local"\n');
    mkdirSync(join(tmp, '.devrig'));
    writeFileSync(join(tmp, '.devrig', '.devrig-version'), '0.0.1\n');
    const result = checkVersionStaleness(tmp);
    assert.equal(result.status, 'warn');
  });

  it('checkPortAvailable passes for unused port', async () => {
    const result = await checkPortAvailable(0, 'test port');
    assert.equal(result.status, 'pass');
  });

  it('checkDevrigDir fails when named env dir does not exist', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "nonexistent-env"\n');
    const result = checkDevrigDir(tmp);
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('not found'));
  });

  it('checkVersionStaleness warns when version file is missing', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "local"\n');
    mkdirSync(join(tmp, '.devrig'));
    // No .devrig-version file
    const result = checkVersionStaleness(tmp);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('No version marker'));
  });

  it('checkTomlValid warns when project field is missing', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-doc-'));
    writeFileSync(join(tmp, 'devrig.toml'), 'tool = "claude"\n');
    const result = checkTomlValid(tmp);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('missing'));
  });
});
