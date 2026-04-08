# TODO

## High priority

_(none)_

## Medium priority

- [ ] Multi-tool support — implement adapters for Codex, open-code (config `tool` field is parsed but only Claude is wired up)

## Low priority

_(none)_

## Done

- [x] Document `.devrig/logs/` for TTY and bridge debugging (`docs/logs.md`)
- [x] Per-subcommand help for `devrig env` (e.g. `devrig env reset --help`)
- [x] ShellCheck lint for `firewall.sh` and `entrypoint.sh`
- [x] pytest unit tests for `scaffold/mitmproxy/allowlist.py`
- [x] Traffic persistence across restarts (bind mount replaces named volume)
- [x] Dashboard URLs show mitmproxy password hint
- [x] Session lock — guard against parallel `devrig start` sessions (PID-based lock file)
- [x] `devrig stop` — explicit teardown without starting a session
- [x] `devrig status` — show what's running (container, bridge, dev server)
- [x] Scaffold staleness warning on `devrig start`
- [x] Error hardening in `init.js` (user-friendly file I/O errors)
- [x] Dual-page handshake with custom Node dev server (replaces `npx -y serve`)
- [x] CLAUDE.md generation during `devrig init` (auto-loaded by Claude Code)
- [x] Chrome MCP auto-configuration (settings.json written from host side)
- [x] `devrig clean --all` with Docker label-based discovery
- [x] `--help`/`-h` on all subcommands
- [x] `--chrome` auto-injected into Claude params when bridge is enabled
- [x] Port/project name validation
- [x] HOST_UID set from host for Linux permissions
- [x] Dev server timeout warning
- [x] Config-missing error suggests `devrig init`
- [x] Remove stale launcher.py reference from devrig.toml.example
- [x] `devrig update` — refresh scaffold files from newer package version while preserving config
- [x] `devrig logs` — view container and dev server logs (with `--container`, `--dev-server`, `--follow`)
- [x] `devrig doctor` — pre-flight health checks (Node, Docker, ports, config, version staleness)
- [x] `devrig exec` — re-attach to a running container
- [x] Claude Code version pinning via `[claude] version` in devrig.toml
- [x] `.dockerignore` in scaffold to reduce build context
- [x] Combined GitHub CLI into single apt layer in Dockerfile
- [x] Pinned pnpm to major version 9
- [x] `init: true` in compose for proper zombie process reaping
- [x] `tmpfs /tmp` in compose for faster temp operations
- [x] Scaffold verification tests (no npm variant, Dockerfile structure, compose config)
- [x] Docker integration tests (image build, package verification, tini, tmpfs)
- [x] CLAUDE.md host/container isolation — shadow mount + devrig-mask volume, separate instructions for each side

## Known rough edges

- ~~Template dev server uses `npx -y serve` which can hang on slow networks~~ (replaced with Node server)
- No timeout enforcement for npm install inside container (second retry can hang)
