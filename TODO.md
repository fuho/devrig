# TODO

## High priority

- [ ] Validate port numbers in config wizard (range 1-65535, must be integer)
- [ ] Validate project name for Docker naming rules (`^[a-z0-9][a-z0-9-]*$`)
- [ ] Guard against parallel `devrig start` sessions (port/container conflicts)
- [ ] `devrig update` — refresh scaffold files from newer package version while preserving config

## Medium priority

- [ ] Multi-tool support — implement adapters for Codex, open-code (config `tool` field is parsed but only Claude is wired up)
- [ ] `devrig stop` — explicit teardown without starting a session
- [ ] `devrig status` — show what's running (container, bridge, dev server)
- [ ] `devrig logs` — tail container/bridge/dev-server logs
- [ ] Scaffold staleness warning — compare `.devrig-version` against installed package on `devrig start`
- [ ] `--help` for subcommands (`devrig start --help`)

## Low priority

- [ ] `devrig doctor` — diagnose setup issues (Docker, Node, ports, config)
- [ ] `--tunnel` flag — TTY diagnostic logging (needs node-pty or keep Python fallback)
- [ ] Lock file to prevent concurrent sessions on same project

## Known rough edges

- compose.npm.yml doesn't explicitly set `CLAUDE_INSTALL_METHOD` (relies on container-setup.js default)
- Template dev server uses `npx -y serve` which can hang on slow networks
- No timeout enforcement for npm install inside container (second retry can hang)
