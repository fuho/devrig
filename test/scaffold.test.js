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
        'mitmproxy/',
        'firewall.sh',
      ]) {
        assert.ok(content.includes(entry), `missing ${entry}`);
      }
    });
  });

  describe('Dockerfile', () => {
    const dockerfile = readFileSync(join(scaffoldDir, 'Dockerfile'), 'utf8');

    it('installs all packages including gh, gosu, and zsh in a single RUN layer', () => {
      assert.ok(
        dockerfile.includes('apt-get install -y git socat ripgrep'),
        'missing base packages',
      );
      assert.ok(
        dockerfile.includes('gh gosu zsh fzf'),
        'gh, gosu, zsh, and fzf should be in the main install',
      );
    });

    it('adds GitHub CLI repo before installing gh', () => {
      const repoIdx = dockerfile.indexOf('githubcli-archive-keyring.gpg');
      const ghInstallIdx = dockerfile.indexOf('gh gosu zsh fzf');
      assert.ok(repoIdx < ghInstallIdx, 'GH CLI repo setup should come before gh install');
    });

    it('installs git-delta for better diffs', () => {
      assert.ok(dockerfile.includes('git-delta'), 'should install git-delta');
    });

    it('creates dev user with zsh and host-matching UID/GID', () => {
      assert.ok(dockerfile.includes('ARG USER_GID='), 'missing USER_GID build arg');
      assert.ok(
        dockerfile.includes('groupadd --non-unique -g ${USER_GID} dev'),
        'missing groupadd with --non-unique',
      );
      assert.ok(
        dockerfile.includes('useradd -m -s /bin/zsh -u ${USER_UID}'),
        'missing useradd with zsh',
      );
    });

    it('installs powerlevel10k via zsh-in-docker', () => {
      assert.ok(dockerfile.includes('zsh-in-docker'), 'should use zsh-in-docker for p10k');
    });

    it('pins pnpm to major version 9', () => {
      assert.ok(dockerfile.includes('pnpm@9'), 'should pin pnpm@9');
      assert.ok(!dockerfile.includes('pnpm@latest'), 'should not use pnpm@latest');
    });

    it('installs Claude Code at build time to /opt/claude + /usr/local/bin', () => {
      assert.ok(
        dockerfile.includes('claude.ai/install.sh'),
        'should install Claude Code via native installer',
      );
      assert.ok(
        dockerfile.includes('/opt/claude') && dockerfile.includes('/usr/local/bin/claude'),
        'should copy claude to /opt and link to /usr/local/bin to survive home bind mount',
      );
    });

    it('uses zsh as default CMD', () => {
      assert.ok(dockerfile.includes('CMD ["zsh"]'), 'default CMD should be zsh');
    });

    it('does not contain git shim (replaced by network firewall)', () => {
      assert.ok(!dockerfile.includes('GITSHIM'), 'git shim should be removed');
      assert.ok(
        !dockerfile.includes('git push is blocked'),
        'git push blocking message should be removed',
      );
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
      assert.ok(compose.includes('CLAUDE.md:/workspace/CLAUDE.md:ro'));
    });

    it('masks .devrig/ with named volume', () => {
      assert.ok(compose.includes('devrig-mask:/workspace/.devrig'));
    });

    it('defines devrig-mask volume with labels', () => {
      const volumesSection = compose.slice(compose.lastIndexOf('volumes:'));
      assert.ok(volumesSection.includes('devrig-mask:'));
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

    it('has mitmproxy sidecar service', () => {
      assert.ok(compose.includes('mitmproxy:'), 'should have mitmproxy service');
      assert.ok(compose.includes('Dockerfile.mitmproxy'), 'should build from Dockerfile.mitmproxy');
    });

    it('dev container routes traffic through mitmproxy', () => {
      assert.ok(
        compose.includes('network_mode: "service:mitmproxy"'),
        'dev should use mitmproxy network',
      );
    });

    it('shares mitmproxy certs with dev container', () => {
      assert.ok(
        compose.includes('mitmproxy-certs:/usr/local/share/mitmproxy-certs:ro'),
        'dev should mount mitmproxy certs read-only',
      );
    });

    it('sets NODE_EXTRA_CA_CERTS for mitmproxy trust', () => {
      assert.ok(
        compose.includes(
          'NODE_EXTRA_CA_CERTS=/usr/local/share/mitmproxy-certs/mitmproxy-ca-cert.pem',
        ),
        'should trust mitmproxy CA via NODE_EXTRA_CA_CERTS',
      );
    });

    it('exposes mitmproxy web UI on localhost only', () => {
      assert.ok(
        compose.includes('127.0.0.1:8081:8081'),
        'mitmproxy web UI should be localhost-only',
      );
    });

    it('has Traefik reverse proxy service', () => {
      assert.ok(compose.includes('traefik:'), 'should have traefik service');
      assert.ok(compose.includes('traefik:v3'), 'should use Traefik v3');
    });

    it('Traefik dashboard is localhost-only', () => {
      assert.ok(
        compose.includes('127.0.0.1:8080:8080'),
        'Traefik dashboard should be localhost-only',
      );
    });

    it('Traefik uses Docker provider with explicit opt-in', () => {
      assert.ok(compose.includes('providers.docker=true'), 'should enable Docker provider');
      assert.ok(
        compose.includes('exposedByDefault=false'),
        'should not expose services by default',
      );
    });

    it('Traefik labels on mitmproxy for .localhost routing', () => {
      assert.ok(compose.includes('traefik.enable'), 'should have traefik.enable label');
      assert.ok(compose.includes('.localhost'), 'should route to .localhost domain');
    });

    it('mounts Docker socket read-only for Traefik', () => {
      assert.ok(
        compose.includes('/var/run/docker.sock:/var/run/docker.sock:ro'),
        'Docker socket should be read-only',
      );
    });
  });

  describe('firewall.sh', () => {
    it('exists in scaffold', () => {
      assert.ok(existsSync(join(scaffoldDir, 'firewall.sh')));
    });

    it('redirects HTTP and HTTPS to mitmproxy', () => {
      const content = readFileSync(join(scaffoldDir, 'firewall.sh'), 'utf8');
      assert.ok(content.includes('--dport 80'), 'should redirect HTTP');
      assert.ok(content.includes('--dport 443'), 'should redirect HTTPS');
      assert.ok(content.includes('REDIRECT --to-port 8080'), 'should redirect to mitmproxy port');
    });

    it('allows DNS and loopback', () => {
      const content = readFileSync(join(scaffoldDir, 'firewall.sh'), 'utf8');
      assert.ok(content.includes('--dport 53'), 'should allow DNS');
      assert.ok(content.includes('-o lo -j ACCEPT'), 'should allow loopback');
    });

    it('blocks unauthorized traffic', () => {
      const content = readFileSync(join(scaffoldDir, 'firewall.sh'), 'utf8');
      assert.ok(content.includes('-j REJECT'), 'should reject unauthorized traffic');
    });

    it('owner bypass rule appears before REJECT', () => {
      const content = readFileSync(join(scaffoldDir, 'firewall.sh'), 'utf8');
      const ownerBypassIdx = content.indexOf('--uid-owner "$MITM_UID" -j ACCEPT');
      const rejectIdx = content.indexOf('-j REJECT');
      assert.ok(ownerBypassIdx > 0, 'should have mitmproxy owner bypass rule');
      assert.ok(ownerBypassIdx < rejectIdx, 'owner bypass must appear before REJECT');
    });
  });

  describe('mitmproxy/allowlist.py', () => {
    it('exists in scaffold', () => {
      assert.ok(existsSync(join(scaffoldDir, 'mitmproxy', 'allowlist.py')));
    });

    it('allows essential domains', () => {
      const content = readFileSync(join(scaffoldDir, 'mitmproxy', 'allowlist.py'), 'utf8');
      assert.ok(content.includes('anthropic.com'), 'should allow Claude API');
      assert.ok(content.includes('registry.npmjs.org'), 'should allow npm');
      assert.ok(content.includes('github.com'), 'should allow GitHub');
    });

    it('kills blocked requests', () => {
      const content = readFileSync(join(scaffoldDir, 'mitmproxy', 'allowlist.py'), 'utf8');
      assert.ok(content.includes('flow.kill()'), 'should kill blocked requests');
    });

    it('defines _is_allowed function and request hook', () => {
      const content = readFileSync(join(scaffoldDir, 'mitmproxy', 'allowlist.py'), 'utf8');
      assert.ok(content.includes('def _is_allowed('), 'should define _is_allowed function');
      assert.ok(content.includes('def request('), 'should define request hook');
    });

    it('checks _is_allowed before killing', () => {
      const content = readFileSync(join(scaffoldDir, 'mitmproxy', 'allowlist.py'), 'utf8');
      // The request function should call _is_allowed before flow.kill
      const isAllowedIdx = content.indexOf('_is_allowed(');
      const killIdx = content.lastIndexOf('flow.kill()');
      assert.ok(isAllowedIdx < killIdx, '_is_allowed check should precede flow.kill');
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

    it('installs mitmproxy CA certificate if available', () => {
      assert.ok(entrypoint.includes('mitmproxy-ca-cert.pem'), 'should reference mitmproxy CA cert');
      assert.ok(entrypoint.includes('update-ca-certificates'), 'should run update-ca-certificates');
    });
  });
});
