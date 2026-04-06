import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDevServerLog, buildDockerLogsArgs } from '../src/logs.js';

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
