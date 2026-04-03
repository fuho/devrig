# TODO

## High priority

- [ ] `devrig update` — refresh scaffold files from newer package version while preserving config

## Medium priority

- [ ] Multi-tool support — implement adapters for Codex, open-code (config `tool` field is parsed but only Claude is wired up)
- [ ] `devrig logs` — tail container/bridge/dev-server logs
- [ ] `--help` for subcommands (`devrig start --help`)

## Low priority

- [ ] `devrig doctor` — diagnose setup issues (Docker, Node, ports, config)
- [ ] Document `.devrig/logs/` for TTY and bridge debugging

## Done

- [x] Session lock — guard against parallel `devrig start` sessions (PID-based lock file)
- [x] `devrig stop` — explicit teardown without starting a session
- [x] `devrig status` — show what's running (container, bridge, dev server)
- [x] Scaffold staleness warning on `devrig start`
- [x] Error hardening in `init.js` (user-friendly file I/O errors)
- [x] Port/project name validation
- [x] HOST_UID set from host for Linux permissions
- [x] Dev server timeout warning
- [x] Config-missing error suggests `devrig init`
- [x] Remove stale launcher.py reference from devrig.toml.example

## Known rough edges

- Template dev server uses `npx -y serve` which can hang on slow networks
- No timeout enforcement for npm install inside container (second retry can hang)
