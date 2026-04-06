import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'devrig.js');

function run(...args) {
  return execFileSync('node', [bin, 'clean', ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

describe('clean', () => {
  it('--list runs without error', () => {
    const out = run('--list');
    // Should either find projects or say none found
    assert.ok(
      out.includes('devrig project') || out.includes('No devrig'),
      'should report project list or empty',
    );
  });

  it('--project with unknown name reports no resources', () => {
    const out = run('--project', 'nonexistent-project-xyz');
    assert.ok(out.includes('No Docker resources found'), 'should find nothing for fake project');
  });

  it('--all -y with no resources is a no-op', () => {
    // If there happen to be real devrig resources, -y will remove them,
    // but this test is about not crashing. In CI there are none.
    const out = run('--all', '-y');
    assert.ok(
      out.includes('No Docker resources') || out.includes('Cleaned up'),
      'should complete without error',
    );
  });
});
