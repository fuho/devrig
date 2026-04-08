import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

import { execFileSync } from 'node:child_process';
import {
  acquireSession,
  releaseSession,
  readSession,
  isSessionAlive,
  checkScaffoldStaleness,
  stopSession,
  showStatus,
} from '../src/session.js';
import { getPackageVersion } from '../src/config.js';

describe('session', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-session-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const makeInfo = (overrides = {}) => ({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    project: 'test-project',
    bridgePort: 9229,
    devServerPort: 3000,
    bridgePid: null,
    devServerPid: null,
    composeArgs: ['compose', '-f', '.devrig/compose.yml', '-p', 'test-project'],
    ...overrides,
  });

  it('acquireSession writes valid JSON', () => {
    acquireSession(tmp, makeInfo());
    const data = JSON.parse(readFileSync(join(tmp, '.devrig', 'session.json'), 'utf8'));
    assert.equal(data.project, 'test-project');
    assert.equal(data.pid, process.pid);
  });

  it('readSession returns parsed object', () => {
    acquireSession(tmp, makeInfo());
    const session = readSession(tmp);
    assert.equal(session.project, 'test-project');
    assert.equal(session.pid, process.pid);
  });

  it('readSession returns null for missing file', () => {
    const result = readSession(tmp);
    assert.equal(result, null);
  });

  it('releaseSession removes the file', () => {
    acquireSession(tmp, makeInfo());
    assert.ok(existsSync(join(tmp, '.devrig', 'session.json')));
    releaseSession(tmp);
    assert.ok(!existsSync(join(tmp, '.devrig', 'session.json')));
  });

  it('releaseSession ignores missing file', () => {
    assert.doesNotThrow(() => releaseSession(tmp));
  });

  it('acquireSession dies when live PID holds lock', () => {
    // Write a lock with our own PID (alive)
    acquireSession(tmp, makeInfo());

    // Try to acquire with a different PID — should die
    const script = `
      import { acquireSession } from './src/session.js';
      acquireSession('${tmp}', {
        pid: 99998,
        startedAt: new Date().toISOString(),
        project: 'test-project',
        composeArgs: [],
      });
    `;
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
    assert.ok(result.stderr.includes('Another devrig session is running'));
  });

  it('acquireSession overwrites stale lock', () => {
    // Write a lock with a dead PID
    writeFileSync(
      join(tmp, '.devrig', 'session.json'),
      JSON.stringify({ pid: 999999, project: 'old', composeArgs: [] }),
    );

    // Should succeed since PID 999999 is (almost certainly) dead
    assert.doesNotThrow(() => acquireSession(tmp, makeInfo()));
    const session = readSession(tmp);
    assert.equal(session.pid, process.pid);
  });

  it('isSessionAlive returns true for own PID', () => {
    assert.ok(isSessionAlive({ pid: process.pid }));
  });

  it('isSessionAlive returns false for dead PID', () => {
    assert.ok(!isSessionAlive({ pid: 999999 }));
  });

  it('isSessionAlive returns false for null', () => {
    assert.ok(!isSessionAlive(null));
  });

  it('stopSession with no session file returns cleanly', () => {
    assert.doesNotThrow(() => stopSession(tmp));
  });

  it('showStatus with no session file returns cleanly', () => {
    assert.doesNotThrow(() => showStatus(tmp));
  });
});

describe('checkScaffoldStaleness', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-stale-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('does not warn when versions match', () => {
    writeFileSync(join(tmp, '.devrig', '.devrig-version'), getPackageVersion() + '\n');
    // Should not throw
    assert.doesNotThrow(() => checkScaffoldStaleness(tmp));
  });

  it('does not throw when version file is missing', () => {
    assert.doesNotThrow(() => checkScaffoldStaleness(tmp));
  });

  it('logs warning when versions differ', () => {
    writeFileSync(join(tmp, '.devrig', '.devrig-version'), '0.0.0\n');
    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      checkScaffoldStaleness(tmp);
    } finally {
      console.log = origLog;
    }
    assert.ok(messages.some((m) => m.includes('WARNING') && m.includes('0.0.0')));
  });

  it('uses explicit envDir parameter when provided', () => {
    const envDir = mkdtempSync(join(tmpdir(), 'devrig-envdir-'));
    try {
      writeFileSync(join(envDir, '.devrig-version'), '0.0.0\n');
      const messages = [];
      const origLog = console.log;
      console.log = (msg) => messages.push(msg);
      try {
        checkScaffoldStaleness(tmp, envDir);
      } finally {
        console.log = origLog;
      }
      assert.ok(messages.some((m) => m.includes('WARNING') && m.includes('0.0.0')));
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});

describe('stopSession edge cases', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-session-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('cleans up stale lock with dead PID', () => {
    writeFileSync(
      join(tmp, '.devrig', 'session.json'),
      JSON.stringify({ pid: 999999, project: 'stale', composeArgs: [] }),
    );
    stopSession(tmp);
    assert.ok(!existsSync(join(tmp, '.devrig', 'session.json')), 'stale lock should be removed');
  });
});
