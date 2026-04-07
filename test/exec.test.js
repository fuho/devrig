import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildExecArgs, validateSession } from '../src/exec.js';

describe('exec', () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('builds docker exec args from session', () => {
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
    const args = buildExecArgs(session);
    assert.ok(args.includes('exec'));
    assert.ok(args.includes('-it'));
    assert.ok(args.includes('--user'));
    assert.ok(args.includes('dev'));
    assert.ok(args.includes('bash'));
  });

  it('validates session — returns error when no session file', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-exec-'));
    const result = validateSession(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No active session'));
  });

  it('validates session — returns error when session PID is dead', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-exec-'));
    const devrigDir = join(tmp, '.devrig');
    mkdirSync(devrigDir, { recursive: true });
    writeFileSync(
      join(devrigDir, 'session.json'),
      JSON.stringify({
        pid: 999999999,
        composeArgs: ['compose', '-f', '.devrig/compose.yml'],
      }),
    );
    const result = validateSession(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not running') || result.error.includes('stopped'));
  });
});
