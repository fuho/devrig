# Changelog

## Unreleased

_(nothing yet)_

## 0.6.0 — 2026-04-08

### Breaking Changes

- **Named environments** — Scaffold files and Claude Code home directory now live in `~/.devrig/environments/{name}/` instead of per-project `.devrig/`. Existing projects using `.devrig/` can set `environment = "local"` in `devrig.toml` to preserve the old behavior.
- **Git shim removed** — `git push` is no longer blocked by a shell shim in the Dockerfile. Network-level security (iptables firewall + mitmproxy allowlist) replaces it.
- **Dockerfile changes** — Default shell changed from bash to zsh. Claude Code installed at build time instead of runtime. `container-setup.js` no longer handles Claude installation.
- **compose.yml restructured** — Now includes three services (Traefik, mitmproxy, dev) instead of one. Volume mount paths use `DEVRIG_ENV_DIR` environment variable.

### Features

- **Named environments** (`devrig env`) — Share Claude Code auth, memories, and settings across projects. Environments live at `~/.devrig/environments/{name}/`. Types: `"default"` (shared), named (e.g. `"work"`), `"local"` (project-isolated). New CLI: `devrig env list|create|inspect|delete`.
- **Network security** — iptables firewall blocks all unauthorized outbound traffic. HTTP/HTTPS redirected through mitmproxy transparent proxy with domain allowlist. Allowed: Anthropic API, npm, GitHub, Sentry, Statsig, PyPI.
- **Traffic inspection** — mitmproxy captures all HTTP/S traffic with full request/response bodies (HTTPS decrypted via trusted CA cert). Web UI at `localhost:8081`. Hourly rotation of `.mitm` capture files. Offline analysis via `mitmproxy -r` or HAR export.
- **Traefik reverse proxy** — Routes `http://{project}.localhost` to the dev server. Dashboard at `localhost:8080`. Docker label-based autodiscovery. No HTTPS needed (`.localhost` is a secure context per RFC 6761).
- **zsh + Powerlevel10k** — Default shell switched to zsh with Powerlevel10k theme, fzf integration, and git-delta for better diffs.
- **Build-time Claude install** — Claude Code installed during Docker image build instead of at container startup. Faster session starts.
- **`devrig logs --network`** — Shows mitmproxy web UI URL, log directory, and recent capture files.
- **`environment` field in devrig.toml** — Controls which environment a project uses. Added to configuration wizard.

### Docker

- mitmproxy sidecar service with transparent proxy mode, domain allowlist addon, and traffic capture
- Traefik v3.6 service with Docker provider, `exposedByDefault=false`, localhost-only dashboard
- Dev container uses `network_mode: "service:mitmproxy"` for outbound traffic routing
- mitmproxy CA certificate shared via Docker volume and trusted via `NODE_EXTRA_CA_CERTS` + `update-ca-certificates`
- `firewall.sh` — iptables rules: DNS/loopback/Docker networks allowed, HTTP/HTTPS redirected to mitmproxy, everything else rejected
- `DEVRIG_ENV_DIR` environment variable for compose volume paths
- `DEVRIG_DEV_PORT` environment variable for Traefik routing
- zsh, fzf, git-delta added to Dockerfile
- Claude Code installed at build time via native installer
- Git push/pull shim removed from Dockerfile

### Fixes

- `container-setup.js` simplified — removed ~40 lines of Claude Code installation logic (now handled at build time)
- `findChangedFiles()` in update.js now accepts target directory directly instead of deriving it from project dir
- `checkDevrigDir()` and `checkVersionStaleness()` in doctor.js safely read environment config without calling `die()`
- `showNetworkLogs()` in logs.js safely reads config without calling `die()`
- Server test: `?agent=` query param now required for agent connection detection (matches server behavior)

### Development

- New `src/env.js` — environment CRUD operations (envDir, ensureEnv, listEnvs, deleteEnv, inspectEnv, envCommand)
- New `scaffold/firewall.sh` — iptables firewall script
- New `scaffold/mitmproxy/allowlist.py` — domain allowlist mitmproxy addon
- `src/config.js` — added `environment` field to loadConfig(), new `resolveEnvDir()` with optional `environmentsRoot` parameter for testability
- `src/docker.js` — `initVariant()` accepts optional environment directory
- `src/session.js` — `checkScaffoldStaleness()` accepts optional environment directory
- `src/env.js` — all functions accept optional `root` parameter for test injection (no global mutation)
- `src/logs.js` — `showNetworkLogs()` exported for direct testing
- New `test/env.test.js` — 15 tests covering all environment CRUD functions with temp dirs
- Test coverage improved: 58% → 66% line, 76% → 78% branch, 62% → 73% function
- Tests expanded from 122 to 197 (176 unit/integration + 21 Docker/e2e)
- Docker integration tests added for zsh, fzf, git-delta, Claude Code pre-install, git shim removal
- Compose runtime tests skipped pending custom mitmproxy image with pre-installed iptables

## 0.5.1 — 2026-04-07

### Fixes

- TypeScript error on `err.code` in uncaughtException handler

## 0.5.0 — 2026-04-06

### Features

- **CLAUDE.md host/container isolation** — `devrig init` now generates two CLAUDE.md files: host version (generic devrig commands) and container version (workspace, ports, git push warning). The container version is shadow-mounted read-only over `/workspace/CLAUDE.md`, so host and container Claude can run simultaneously with their own instructions. `.devrig/` is masked inside the container via a named volume, preventing context pollution from scaffold files and runtime artifacts.
- `devrig start` and `devrig update` regenerate the container CLAUDE.md to pick up user edits

### Docker

- `.dockerignore` added to scaffold — reduces build context by excluding runtime artifacts (`home/`, `logs/`, `session.json`, `*.log`, `.devrig-version`, `template/`)
- Combined GitHub CLI setup into single apt layer in Dockerfile — saves one cache layer and one `apt-get update`
- Pinned pnpm to major version 9 (was `@latest`)
- `init: true` added to compose — uses tini for proper zombie process reaping
- `tmpfs /tmp` added to compose — faster temp file operations in-memory

### Fixes

- Fixed Dockerfile: install `curl` before GitHub CLI repo setup (node:25-slim doesn't include curl)

### Development

- New `test/scaffold.test.js` — verifies scaffold content (no npm variant files, .dockerignore, Dockerfile structure, pnpm pin, compose config)
- Docker integration tests in `test/docker.test.js` — builds scaffold image and verifies gh, pnpm 9.x, all system packages; compose runtime tests for tini PID 1 and tmpfs /tmp
- New e2e assertions: `--npm` flag removed from help, `.dockerignore` copied during init
- `.dockerignore` added to init test expected files list
- Docker integration tests for CLAUDE.md shadow mount and `.devrig/` masking
- E2E test verifies both host and container CLAUDE.md generated during init

## 0.3.0 — 2026-04-04

### Features

- Custom Node dev server (`server.js`) replaces `npx -y serve` in project template — zero dependencies
- `/devrig/setup` — user-facing status dashboard with live SSE updates when agent connects
- `/devrig/status` — JSON endpoint for programmatic status checks
- `/devrig/events` — SSE stream for real-time agent connection events
- Agent handshake: `?agent=claude` query param triggers connection notification on setup page
- `CLAUDE.md` generated during `devrig init` with workspace, dev server, and Chrome bridge instructions (replaces AGENTS.md)
- Claude Code auto-opens Chrome MCP on launch via initial prompt
- First-run handling: Claude detects if Chrome MCP is unavailable and tells user to restart
- Chrome MCP settings written from host side before container starts — available on second launch
- `devrig clean --all` finds ALL devrig resources system-wide via Docker labels
- Docker resources (containers, images, volumes) labeled with `devrig.project` for reliable cleanup
- `devrig clean` uses label-based discovery with fallback to image name matching
- `--chrome` flag auto-injected into Claude Code params when bridge is running
- `devrig init` prints summary of created files with config contents
- `--help`/`-h` on all subcommands with examples and cross-references

## 0.2.2 — 2026-04-03

### Features

- `devrig clean` — remove Docker images, volumes, and networks for the current project (with `-y` to skip confirmation)
- `--help` / `-h` support on all subcommands
- `devrig init` now shows a summary of created files and next steps
- `--chrome` flag automatically injected into Claude Code params when bridge is enabled (and stripped when `--no-chrome` is passed)

### Security

- Chrome bridge now listens on `127.0.0.1` instead of `0.0.0.0`
- Session lock uses atomic file creation (`O_EXCL`) to prevent race conditions
- README security messaging rewritten to be precise about what's protected (filesystem, git credentials) and what's not (network)

### Fixes

- File descriptor leak in launcher after spawning bridge and dev server
- `devrig init` no longer prints "Aborted." on normal completion
- Fixed CLAUDE_PARAMS log to show actual params including injected `--chrome`
- Template `index.html` now shows correct `devrig start` command
- README clarifies what persists on exit vs what stops
- Added `author`, `homepage`, `bugs` fields to package.json

## 0.2.0 — 2026-04-03

### Features

- `devrig stop` — stop a running session from another terminal
- `devrig status` — show running components and their state
- Session lock — prevents parallel sessions on the same project with PID-based lock file
- Scaffold staleness warning — alerts when `.devrig/` files are from an older version
- Error hardening — user-friendly messages for file I/O failures in `devrig init`

### Development

- ESLint 9 with flat config and eslint-config-prettier
- Prettier formatting (2-space indent, single quotes, trailing commas)
- TypeScript JSDoc type checking via `tsc --checkJs`
- Test coverage via Node's built-in `--experimental-test-coverage`
- GitHub Actions CI across Node 18, 20, and 22
- JSDoc on all exported functions
- `npm run check` runs lint + format + typecheck + test in one command

### Documentation

- README rewritten with Mermaid architecture diagram, GitHub alerts, collapsible sections, badges
- SSH & Git setup guide for containerized workflows
- Expanded CLI and configuration reference tables

## 0.1.0 — 2026-04-03

Initial release as a pure JavaScript npm package.

### Features

- `devrig init` — scaffold `.devrig/` with Docker infrastructure and run config wizard
- `devrig start` — build container, start Chrome bridge + dev server, attach to Claude Code
- `devrig config` — re-run the configuration wizard
- Zero production dependencies
- Auto-rebuild detection via SHA-256 hashing of build files
- Chrome browser bridge (TCP-to-Unix relay for Docker-Chrome integration)
- Direct TTY passthrough to Claude Code inside the container
- Graceful cleanup on exit (SIGINT/SIGTERM)
- Scaffold staleness detection via `.devrig-version` marker

### Container

- Based on `node:25-slim` with git, ripgrep, gh, socat, vim, tree, pnpm
- Git safety: `push` blocked, `pull` on master blocked
- Host UID matching for correct file permissions
- Claude Code installed via native installer or npm (configurable)

### Prior art

- Chrome bridge based on [claude-code-remote-chrome](https://github.com/vaclavpavek/claude-code-remote-chrome) by Vaclav Pavek
