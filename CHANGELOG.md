# Changelog

## Unreleased

### Features

- `devrig env reset [name]` — re-copies scaffold files while preserving Claude auth/memories
- Improved error message when project not initialized: suggests `devrig init`
- Custom `Dockerfile.mitmproxy` with pre-installed iptables (eliminates ~20s startup delay)
- Switched from domain allowlist to blocklist (default-allow, block specific domains)
- mitmproxy web UI password set to `devrig` (was random token in mitmproxy 12.x)

### Fixes

- `devrig doctor` detects pre-v0.6 projects and suggests migration path
- `devrig doctor` version staleness check falls back to `.devrig/.devrig-version` for pre-v0.6 projects
- `extra_hosts` moved from dev to mitmproxy service (Docker conflict with `network_mode: service:`)
- Firewall preserves Docker DNS NAT rules across flush (was breaking DNS resolution)
- Firewall allows `host.docker.internal` IP (OrbStack uses non-standard `0.250.x.x` range)
- Bridge host listens on `0.0.0.0` instead of `127.0.0.1` (Docker `host.docker.internal` needs non-loopback)
- Claude Code binary moved to `/opt/claude` + symlinked to `/usr/local/bin/` (survives `/home/dev` bind mount)
- `chrome-native-host` shim set to 0755 (was 0555, Claude Code v2.1.96 needs to update it)
- TLS passthrough for `claudeusercontent.com` (WebSocket bridge breaks under MITM interception)
- `setup.html` copied to project `.devrig/` for non-local environments
- `container-setup.js` simplified: verifies claude at startup, no longer installs it

### Removed

- Traefik reverse proxy — dev server runs on host, Traefik couldn't route to it
- Domain allowlist — replaced by blocklist (default-allow)
- Git shim in Dockerfile — replaced by network-level firewall

### TODO

- Per-subcommand help for `devrig env` (e.g. `devrig env reset --help` shows reset-specific help)
- Re-enable compose runtime tests when custom mitmproxy image is stable
- pytest unit tests for `scaffold/mitmproxy/allowlist.py`
- ShellCheck lint for `firewall.sh` and `entrypoint.sh`
- Traefik reverse proxy for multi-service projects (when dev server runs in container)
- Traffic persistence across restarts (mitmproxy-logs volume lifecycle)
- Custom mitmproxy web UI

## 0.6.0 — 2026-04-08
