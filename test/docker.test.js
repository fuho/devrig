import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { needsRebuild, buildHash } from '../src/docker.js';

const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold');

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
    try {
      execFileSync('docker', ['rmi', testImage], { stdio: 'ignore' });
    } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when image does not exist', () => {
    // Make sure image doesn't exist
    try {
      execFileSync('docker', ['rmi', testImage], { stdio: 'ignore' });
    } catch {}
    assert.strictEqual(needsRebuild(ctx), true);
  });

  it('returns false when image has matching hash', () => {
    const hash = buildHash(ctx);
    // Build a minimal image with the correct label
    // Use docker build with a label from stdin
    const dockerfile = `FROM scratch\nLABEL devrig.build.hash="${hash}"\n`;
    writeFileSync(join(ctx.devrigDir, 'Dockerfile.test'), dockerfile);
    execFileSync(
      'docker',
      ['build', '-t', testImage, '-f', join(ctx.devrigDir, 'Dockerfile.test'), ctx.devrigDir],
      { stdio: 'ignore' },
    );

    assert.strictEqual(needsRebuild(ctx), false);
  });

  it('returns true when build files change', () => {
    // Change a build file — hash will differ from what's in the image label
    writeFileSync(join(ctx.devrigDir, 'entrypoint.sh'), '#!/bin/bash\necho changed\n');
    assert.strictEqual(needsRebuild(ctx), true);
  });
});

describe('scaffold image verification', { timeout: 120_000 }, () => {
  const testImage = 'devrig-test-scaffold:latest';
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-scaffold-'));
    cpSync(scaffoldDir, tmpDir, { recursive: true });
    // Build the real scaffold Dockerfile
    execFileSync('docker', ['build', '-t', testImage, tmpDir], {
      stdio: 'pipe',
      timeout: 90_000,
    });
  });

  after(() => {
    try { execFileSync('docker', ['rmi', '-f', testImage], { stdio: 'ignore' }); } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function dockerRun(...cmd) {
    return execFileSync('docker', ['run', '--rm', '--entrypoint', '', testImage, ...cmd], {
      encoding: 'utf8',
      timeout: 15_000,
    }).trim();
  }

  it('gh CLI is installed', () => {
    const output = dockerRun('gh', '--version');
    assert.ok(output.includes('gh version'), `expected gh version output, got: ${output}`);
  });

  it('pnpm is pinned to version 9.x', () => {
    const output = dockerRun('pnpm', '--version');
    assert.ok(output.startsWith('9.'), `expected pnpm 9.x, got: ${output}`);
  });

  it('all expected packages are installed', () => {
    for (const bin of ['git', 'socat', 'rg', 'curl', 'jq', 'vim', 'tree']) {
      const output = dockerRun('which', bin);
      assert.ok(output.length > 0, `${bin} should be on PATH`);
    }
  });
});

describe('compose runtime verification', { timeout: 120_000 }, () => {
  const projectName = 'devrig-test-compose';
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devrig-compose-'));
    const devrigDir = join(tmpDir, '.devrig');
    cpSync(scaffoldDir, devrigDir, { recursive: true });

    // Generate container CLAUDE.md for shadow mount test
    writeFileSync(join(devrigDir, 'CLAUDE.md'), [
      '<!-- devrig:start -->',
      '## devrig',
      '',
      'You are running inside a devrig Docker container.',
      '',
      '- **Workspace:** /workspace',
      '- **Dev server:** http://localhost:3000',
      '- **Chrome bridge:** disabled',
      '',
      'Git push is blocked inside this container. Make commits freely — the user will',
      'review and push from the host.',
      '<!-- devrig:end -->',
    ].join('\n') + '\n');

    // Create host CLAUDE.md (will be shadowed by container version)
    writeFileSync(join(tmpDir, 'CLAUDE.md'), [
      '<!-- devrig:start -->',
      '## devrig',
      '',
      'This project uses devrig for containerized AI development.',
      '<!-- devrig:end -->',
    ].join('\n') + '\n');

    // Start container in background using compose
    execFileSync('docker', [
      'compose', '--project-directory', tmpDir,
      '-f', join(devrigDir, 'compose.yml'),
      '--project-name', projectName,
      'up', '-d', '--build',
    ], { stdio: 'pipe', timeout: 90_000, env: { ...process.env, DEVRIG_PROJECT: projectName, HOST_UID: String(process.getuid()) } });
  });

  after(() => {
    try {
      execFileSync('docker', [
        'compose', '--project-directory', tmpDir,
        '-f', join(tmpDir, '.devrig', 'compose.yml'),
        '--project-name', projectName,
        'down', '--rmi', 'local', '-v',
      ], { stdio: 'ignore', timeout: 30_000, env: { ...process.env, DEVRIG_PROJECT: projectName, HOST_UID: String(process.getuid()) } });
    } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function composeExec(...cmd) {
    return execFileSync('docker', [
      'compose', '--project-directory', tmpDir,
      '-f', join(tmpDir, '.devrig', 'compose.yml'),
      '--project-name', projectName,
      'exec', '-T', 'dev', ...cmd,
    ], { encoding: 'utf8', timeout: 15_000, env: { ...process.env, DEVRIG_PROJECT: projectName, HOST_UID: String(process.getuid()) } }).trim();
  }

  it('PID 1 is tini (init: true)', () => {
    const output = composeExec('cat', '/proc/1/cmdline');
    // Docker uses tini or docker-init depending on runtime
    assert.ok(output.includes('tini') || output.includes('docker-init'),
      `expected tini or docker-init as PID 1, got: ${output}`);
  });

  it('/tmp is mounted as tmpfs', () => {
    const output = composeExec('mount');
    const tmpMount = output.split('\n').find((l) => l.includes(' /tmp '));
    assert.ok(tmpMount, '/tmp mount not found');
    assert.ok(tmpMount.includes('tmpfs'), `/tmp should be tmpfs, got: ${tmpMount}`);
  });

  it('.devrig/ is hidden from container workspace', () => {
    // The devrig-mask volume should hide .devrig/ contents
    const output = composeExec('ls', '/workspace/.devrig/');
    // Should be empty or only contain the volume's initial empty state
    assert.ok(!output.includes('Dockerfile'), '.devrig/Dockerfile should not be visible');
    assert.ok(!output.includes('entrypoint.sh'), '.devrig/entrypoint.sh should not be visible');
    assert.ok(!output.includes('home'), '.devrig/home should not be visible');
  });

  it('container sees container version of CLAUDE.md', () => {
    const output = composeExec('cat', '/workspace/CLAUDE.md');
    assert.ok(output.includes('You are running inside a devrig Docker container'),
      'container should see container CLAUDE.md');
    assert.ok(!output.includes('containerized AI development'),
      'container should not see host CLAUDE.md content');
  });
});
