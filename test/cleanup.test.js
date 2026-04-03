import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { registerProcess, setComposeArgs, cleanup } from '../src/cleanup.js';

describe('cleanup', () => {
  it('terminates registered processes and survives double-call', async () => {
    const proc = spawn('sleep', ['60'], { stdio: 'ignore' });
    registerProcess('test-sleep', proc);
    setComposeArgs(['compose', '--project-name', 'fake', '-f', 'fake.yml']);

    await cleanup();

    // cleanup() waits for processes to exit, so proc should be killed
    assert.ok(proc.killed, 'process should have been killed');

    // Second call should be a no-op (no throw)
    await cleanup();
  });
});
