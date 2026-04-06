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
      for (const entry of ['home/', 'logs/', 'session.json', '*.log', '.devrig-version', 'template/']) {
        assert.ok(content.includes(entry), `missing ${entry}`);
      }
    });
  });

  describe('Dockerfile', () => {
    const dockerfile = readFileSync(join(scaffoldDir, 'Dockerfile'), 'utf8');

    it('installs all packages including gh in a single RUN layer', () => {
      // The RUN block should contain gh in the install list
      assert.ok(dockerfile.includes('apt-get install -y git socat ripgrep'), 'missing base packages');
      assert.ok(dockerfile.includes('install -y git socat ripgrep jq vim tree gh'), 'gh should be in the main install');
    });

    it('adds GitHub CLI repo before installing gh', () => {
      const repoIdx = dockerfile.indexOf('githubcli-archive-keyring.gpg');
      const ghInstallIdx = dockerfile.indexOf('install -y git socat ripgrep jq vim tree gh');
      assert.ok(repoIdx < ghInstallIdx, 'GH CLI repo setup should come before gh install');
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
  });
});
