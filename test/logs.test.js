import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDevServerLog, buildDockerLogsArgs, showNetworkLogs } from '../src/logs.js';

describe('logs', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('reads dev server log file', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-logs-'));
    const logsDir = join(tmp, '.devrig', 'logs');
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, 'dev-server.log'), 'line1\nline2\nline3\n');

    const lines = readDevServerLog(tmp);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'line1');
    assert.equal(lines[2], 'line3');
  });

  it('returns empty array when no log file exists', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-logs-'));
    const lines = readDevServerLog(tmp);
    assert.equal(lines.length, 0);
  });

  it('builds docker logs args from session', () => {
    const session = {
      composeArgs: [
        'compose',
        '--project-directory',
        '.',
        '--project-name',
        'test',
        '-f',
        '.devrig/compose.yml',
      ],
    };
    const args = buildDockerLogsArgs(session, { follow: false });
    assert.ok(args.includes('logs'));
    assert.ok(args.includes('dev'));
  });

  it('builds docker logs args with follow flag', () => {
    const session = {
      composeArgs: [
        'compose',
        '--project-directory',
        '.',
        '--project-name',
        'test',
        '-f',
        '.devrig/compose.yml',
      ],
    };
    const args = buildDockerLogsArgs(session, { follow: true });
    assert.ok(args.includes('--follow'));
  });
});

describe('showNetworkLogs', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function capture(fn) {
    const messages = [];
    const origLog = console.log;
    console.log = (msg) => messages.push(msg);
    try {
      fn();
    } finally {
      console.log = origLog;
    }
    return messages.join('\n');
  }

  it('shows web UI URL and log dir when no logs exist', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-netlogs-'));
    // Write devrig.toml with local environment so it uses .devrig/
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "local"\n');

    const output = capture(() => showNetworkLogs(tmp));
    assert.ok(output.includes('localhost:8081'), 'should show mitmproxy web UI URL');
    assert.ok(output.includes('No mitmproxy logs found'), 'should indicate no logs');
  });

  it('shows "no capture files" when log dir exists but is empty', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-netlogs-'));
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "local"\n');
    mkdirSync(join(tmp, '.devrig', 'mitmproxy', 'logs'), { recursive: true });

    const output = capture(() => showNetworkLogs(tmp));
    assert.ok(output.includes('No capture files'), 'should say no capture files');
  });

  it('lists recent .mitm files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-netlogs-'));
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "local"\n');
    const logsDir = join(tmp, '.devrig', 'mitmproxy', 'logs');
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, 'traffic-2026-04-08_14.mitm'), '');
    writeFileSync(join(logsDir, 'traffic-2026-04-08_15.mitm'), '');

    const output = capture(() => showNetworkLogs(tmp));
    assert.ok(output.includes('traffic-2026-04-08_14.mitm'));
    assert.ok(output.includes('traffic-2026-04-08_15.mitm'));
  });

  it('caps display at 5 most recent files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-netlogs-'));
    writeFileSync(join(tmp, 'devrig.toml'), 'project = "test"\nenvironment = "local"\n');
    const logsDir = join(tmp, '.devrig', 'mitmproxy', 'logs');
    mkdirSync(logsDir, { recursive: true });
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(logsDir, `traffic-2026-04-0${i}_14.mitm`), '');
    }

    const output = capture(() => showNetworkLogs(tmp));
    const fileLines = output.split('\n').filter((l) => l.trim().startsWith('traffic-'));
    assert.ok(fileLines.length <= 5, `should show at most 5 files, got ${fileLines.length}`);
  });

  it('falls back to .devrig/ when config is missing', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-netlogs-'));
    // No devrig.toml — should fall back gracefully

    const output = capture(() => showNetworkLogs(tmp));
    assert.ok(output.includes('localhost:8081'), 'should still show web UI URL');
  });
});
