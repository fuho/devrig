import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold');

describe('scaffold content', () => {
  describe('npm variant removed', () => {
    it('no Dockerfile.npm in scaffold', () => {
      assert.ok(!existsSync(join(scaffoldDir, 'Dockerfile.npm')));
    });

    it('no compose.npm.yml in scaffold', () => {
      assert.ok(!existsSync(join(scaffoldDir, 'compose.npm.yml')));
    });
  });

  describe('.dockerignore', () => {
    it('exists in scaffold', () => {
      assert.ok(existsSync(join(scaffoldDir, '.dockerignore')));
    });

    it('excludes runtime artifacts', () => {
      const content = readFileSync(join(scaffoldDir, '.dockerignore'), 'utf8');
      for (const entry of [
        'home/',
        'logs/',
        'session.json',
        '*.log',
        '.devrig-version',
        'template/',
      ]) {
        assert.ok(content.includes(entry), `missing ${entry}`);
      }
    });
  });

  describe('Dockerfile', () => {
    const dockerfile = readFileSync(join(scaffoldDir, 'Dockerfile'), 'utf8');

    it('installs all packages including gh and gosu in a single RUN layer', () => {
      // The RUN block should contain gh and gosu in the install list
      assert.ok(
        dockerfile.includes('apt-get install -y git socat ripgrep'),
        'missing base packages',
      );
      assert.ok(
        dockerfile.includes('install -y git socat ripgrep jq vim tree gh gosu'),
        'gh and gosu should be in the main install',
      );
    });

    it('adds GitHub CLI repo before installing gh', () => {
      const repoIdx = dockerfile.indexOf('githubcli-archive-keyring.gpg');
      const ghInstallIdx = dockerfile.indexOf('install -y git socat ripgrep jq vim tree gh gosu');
      assert.ok(repoIdx < ghInstallIdx, 'GH CLI repo setup should come before gh install');
    });

    it('creates dev user with host-matching UID and GID', () => {
      assert.ok(dockerfile.includes('ARG USER_GID='), 'missing USER_GID build arg');
      assert.ok(
        dockerfile.includes('groupadd --non-unique -g ${USER_GID} dev'),
        'missing groupadd with --non-unique',
      );
      assert.ok(dockerfile.includes('useradd -m -s /bin/bash -u ${USER_UID}'), 'missing useradd');
    });

    it('pins pnpm to major version 9', () => {
      assert.ok(dockerfile.includes('pnpm@9'), 'should pin pnpm@9');
      assert.ok(!dockerfile.includes('pnpm@latest'), 'should not use pnpm@latest');
    });
  });

  describe('compose.yml', () => {
    const compose = readFileSync(join(scaffoldDir, 'compose.yml'), 'utf8');

    it('has init: true', () => {
      assert.ok(compose.includes('init: true'));
    });

    it('has tmpfs /tmp', () => {
      assert.ok(compose.includes('tmpfs:'));
      assert.ok(compose.includes('- /tmp'));
    });

    it('shadow-mounts container CLAUDE.md over host version', () => {
      assert.ok(compose.includes('./.devrig/CLAUDE.md:/workspace/CLAUDE.md:ro'));
    });

    it('masks .devrig/ with named volume', () => {
      assert.ok(compose.includes('devrig-mask:/workspace/.devrig'));
    });

    it('defines devrig-mask volume with labels', () => {
      const volumesSection = compose.slice(compose.lastIndexOf('volumes:'));
      assert.ok(volumesSection.includes('devrig-mask:'));
      // devrig-mask must have labels so devrig clean can find it
      const maskIdx = volumesSection.indexOf('devrig-mask:');
      const afterMask = volumesSection.slice(maskIdx);
      assert.ok(afterMask.includes('devrig.project'), 'devrig-mask needs project label');
    });

    it('runs as root so entrypoint can chown before dropping to dev', () => {
      assert.ok(compose.includes('user: "root"'), 'compose should run as root for chown');
    });

    it('resolves host.docker.internal on Linux via extra_hosts', () => {
      assert.ok(
        compose.includes('host.docker.internal:host-gateway'),
        'extra_hosts needed for Linux',
      );
    });

    it('healthcheck start_period allows time for Claude install', () => {
      assert.ok(
        compose.includes('start_period: 120s'),
        'start_period should be 120s to match claude_timeout',
      );
    });

    it('passes USER_GID build arg', () => {
      assert.ok(compose.includes('USER_GID:'), 'compose should pass USER_GID');
    });

    it('passes BRIDGE_ENABLED env var', () => {
      assert.ok(compose.includes('BRIDGE_ENABLED'), 'compose should pass BRIDGE_ENABLED');
    });
  });

  describe('entrypoint.sh', () => {
    const entrypoint = readFileSync(join(scaffoldDir, 'entrypoint.sh'), 'utf8');

    it('chowns /home/dev to dev before any user operations', () => {
      assert.ok(entrypoint.includes('chown -R dev:dev /home/dev'), 'must fix bind-mount ownership');
    });

    it('drops privileges via gosu before running container-setup.js', () => {
      assert.ok(entrypoint.includes('gosu dev node'), 'setup must run as dev not root');
    });

    it('drops privileges via gosu for the final exec', () => {
      assert.ok(entrypoint.includes('exec gosu dev "$@"'), 'CMD must run as dev not root');
    });

    it('chown happens before gosu', () => {
      const chownIdx = entrypoint.indexOf('chown -R dev:dev /home/dev');
      const gosuIdx = entrypoint.indexOf('gosu dev node');
      assert.ok(chownIdx < gosuIdx, 'chown must precede gosu');
    });
  });
});
