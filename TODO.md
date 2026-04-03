# TODO

## High priority

- [ ] `devrig update` — refresh scaffold files from newer package version while preserving config

## Medium priority

- [ ] Multi-tool support — implement adapters for Codex, open-code (config `tool` field is parsed but only Claude is wired up)
- [ ] `devrig logs` — tail container/bridge/dev-server logs

## Low priority

- [ ] `devrig doctor` — diagnose setup issues (Docker, Node, ports, config)
- [ ] Document `.devrig/logs/` for TTY and bridge debugging

## Done

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

## Known rough edges

- ~~Template dev server uses `npx -y serve` which can hang on slow networks~~ (replaced with Node server)
- No timeout enforcement for npm install inside container (second retry can hang)
