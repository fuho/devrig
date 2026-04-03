import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { needsRebuild, buildHash, buildFiles } from '../src/docker.js';

describe('needsRebuild (Docker)', () => {
  const testImage = 'devrig-test-needsrebuild:latest';
  let tmpDir;
  let ctx;

  before(() => {
    // Create temp dir with fake build files
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-docker-'));
    const devrigDir = join(tmpDir, '.devrig');
    execFileSync('mkdir', ['-p', devrigDir]);

    writeFileSync(join(devrigDir, 'Dockerfile'), 'FROM scratch\n');
    writeFileSync(join(devrigDir, 'entrypoint.sh'), '#!/bin/bash\n');
    writeFileSync(join(devrigDir, 'container-setup.js'), '// setup\n');
    writeFileSync(join(tmpDir, '.devrig', 'compose.yml'), 'version: "3"\n');

    ctx = {
      project: 'devrig-test',
      composeFile: join(tmpDir, '.devrig', 'compose.yml'),
      image: testImage,
      dockerfile: 'Dockerfile',
      devrigDir: join(tmpDir, '.devrig'),
      service: 'dev',
    };
  });

  after(() => {
    // Clean up test image
    try { execFileSync('docker', ['rmi', testImage], { stdio: 'ignore' }); } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when image does not exist', () => {
    // Make sure image doesn't exist
    try { execFileSync('docker', ['rmi', testImage], { stdio: 'ignore' }); } catch {}
    assert.strictEqual(needsRebuild(ctx), true);
  });

  it('returns false when image has matching hash', () => {
    const hash = buildHash(ctx);
    // Build a minimal image with the correct label
    // Use docker build with a label from stdin
    const dockerfile = `FROM scratch\nLABEL devrig.build.hash="${hash}"\n`;
    writeFileSync(join(ctx.devrigDir, 'Dockerfile.test'), dockerfile);
    execFileSync('docker', ['build', '-t', testImage, '-f', join(ctx.devrigDir, 'Dockerfile.test'), ctx.devrigDir], { stdio: 'ignore' });

    assert.strictEqual(needsRebuild(ctx), false);
  });

  it('returns true when build files change', () => {
    // Change a build file — hash will differ from what's in the image label
    writeFileSync(join(ctx.devrigDir, 'entrypoint.sh'), '#!/bin/bash\necho changed\n');
    assert.strictEqual(needsRebuild(ctx), true);
  });
});
