# Changelog

## Unreleased

### Features

- **Traffic control dashboard** at `/devrig/traffic` (renamed from `/devrig/firewall`) — live traffic stream with pause/resume/clear, domain discovery with request counts, rules management with enable/disable/delete, and add-rule form with client-side regex validation and match preview
- **Rules engine** — replaces hardcoded `BLOCKED_DOMAINS`/`PASSTHROUGH_DOMAINS` sets with a regex-based rules engine supporting four rule types: `block`, `passthrough`, `strip_header`, `add_header`. Rules are evaluated first-match against the full URL, then hostname
- **Rules API** on port 8082 — REST endpoints for rules CRUD (`GET/POST/PUT/DELETE /rules`), SSE live traffic stream (`GET /traffic`), domain hit counts (`GET /domains`), recent traffic history (`GET /traffic/recent`). CORS headers included
- Rules persist across container restarts via `rules.json` (bind-mounted from `{envDir}/rules/`)
- Quick actions: click a domain in the domains panel to pre-fill a block rule in the form
- **`/devrig/hello_claude` endpoint** — Claude checks in via Chrome MCP; returns a personalized welcome page showing project name, git branch, latest commit, connection speed, proxy traffic stats, and top domains. Browsers get styled HTML, curl/fetch gets JSON
- **Agent connection indicator** in traffic dashboard — "Claude: connected" dot with clickable header inspection
- **mitmweb deep link** in detail pane — opens the flow in mitmproxy's built-in UI for replay, export, and modification
- Dark-themed scrollbars matching dashboard aesthetic
- **Dedicated devrig server** — infrastructure routes (`/devrig/hello_claude`, `/devrig/traffic`, `/devrig/events`, `/devrig/status`) now run on a dedicated Node.js server inside the dev container (port 8083 by default, configurable via `[devrig] port` in toml). Reverse-proxies the mitmproxy rules API so the browser only needs one port. Works independently of the user's dev server — `devrig start --no-dev-server` now has full dashboard support
- **Configurable devrig dashboard port** via `devrig.toml` `[devrig] port` and the configuration wizard
- Detail pane payload blocks expand to full height (no inner scroll)

### Fixes

- **Double-fired mitmproxy hooks** — module-level `request()`/`response()`/`tls_clienthello()` functions plus `addons = [_addon]` caused mitmproxy to call every hook twice, creating duplicate traffic entries. Removed module-level hook functions; all hooks now live solely on the addon instance
- **Traffic entry IDs** now use `flow.id` (mitmproxy's stable UUID) instead of `uuid.uuid4().hex` — eliminates ID mismatches between request and response hooks
- **`error`/`close` hooks** added to `RulesAddon` — cleans up `_flow_map` entries for errored/timed-out flows that never reach `response()`, preventing memory leak
- **Port 8082** added to iptables accept list in `firewall.sh` — API responses were being rejected by the final REJECT rule
- **`devrig update` overhaul** — fixed early return that skipped scaffold directory sync, template files, UI files, and CLAUDE.md regeneration when scaffold files were already up to date. Update now runs all steps independently
- `devrig update` now detects and reports changes in scaffold directories (`mitmproxy/allowlist.py` etc.) with per-file diff reporting
- `devrig update` now detects and offers to update template files (`server.js`, `index.html`) in the project root
- `devrig update` now copies UI files to project `.devrig/` for named environments
- `devrig update` now sets executable permissions (`chmod 755`) on `entrypoint.sh`, `container-setup.js`, `firewall.sh` after copying
- `devrig update` now ensures `rules/` and `logs/` directories exist in project `.devrig/`
- `devrig update -f` short flag added (alias for `--force`)
- CLAUDE.md network description corrected — "default-allow with specific blocks" instead of "restricted to approved domains"

### Changed

- `/devrig/firewall` renamed to `/devrig/traffic`; `firewall.html` renamed to `traffic.html`
- Setup page (`/devrig/setup`) removed — traffic control dashboard is now the landing page opened by `devrig start`
- Agent check-in via `/devrig/hello_claude` replaces `?agent=` query param on index page (legacy `?agent=` kept for backward compat)
- `devrig config` no longer asks "AI tool" question — devrig is Claude-only; `tool` field removed from generated toml
- `devrig config` no longer copies `package.json` to project — only `index.html` and `server.js` are offered as starter templates
- `[claude]` section commented out in generated toml (still parseable if manually added)
- **Environments simplified** — collapsed three modes (`"default"`, named, `"local"`) to two (`"shared"`, `"local"`). Existing `environment = "default"` configs are auto-normalized to `"shared"`. Legacy `~/.devrig/environments/default/` migrated to `~/.devrig/shared/` on first access. `devrig env` reduced to `inspect` + `reset` (removed `list`, `create`, `delete`)
- **`devrig config` confirmation step** — wizard now shows a summary of all settings and files before writing anything to disk
- **`devrig config` template question** — starter template only offered when dev server is enabled and no existing server.js/index.html
- **Template server.js simplified** — devrig routes removed from template, now a plain static file server (~40 lines). Devrig features work regardless of user's dev server choice
- **Port 8082 no longer exposed to host** — rules API proxied through devrig server on port 8083

## 0.7.1 — 2026-04-08

### Fixes

- Setup page (`/devrig/setup`) no longer gets stuck on "Waiting for Claude Code..." — added `/devrig/status` fetch fallback for missed SSE events

## 0.7.0 — 2026-04-08

### Features

- `devrig env reset [name]` — re-copies scaffold files while preserving Claude auth/memories
- Improved error message when project not initialized: suggests `devrig init`
- Custom `Dockerfile.mitmproxy` with pre-installed iptables (eliminates ~20s startup delay)
- Switched from domain allowlist to blocklist (default-allow, block specific domains)
- mitmproxy web UI password set to `devrig` (was random token in mitmproxy 12.x)
- Per-subcommand help for `devrig env` (e.g. `devrig env reset --help`)
- Traffic captures persist across restarts via bind mount at `{envDir}/mitmproxy/logs/`
- Dashboard URLs during `devrig start` now show mitmproxy password hint

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
- Re-enabled compose runtime tests (tini, tmpfs, masking, CLAUDE.md shadow mount, zsh)

### Removed

- Traefik reverse proxy — dev server runs on host, Traefik couldn't route to it
- Domain allowlist — replaced by blocklist (default-allow)
- Git shim in Dockerfile — replaced by network-level firewall
- `mitmproxy-logs` named Docker volume — replaced by bind mount for host accessibility

### Documentation

- New `docs/logs.md` — log locations, viewing commands, traffic capture analysis, cleanup lifecycle
- README: added "All logs" section with link to docs/logs.md

### Development

- ShellCheck lint for `scaffold/firewall.sh` and `scaffold/entrypoint.sh` (added to CI and `npm run check`)
- pytest tests for `scaffold/mitmproxy/allowlist.py` (16 tests covering blocklist, passthrough, and hooks)
- Python CI job added to GitHub Actions
- `npm run lint:shell` and `npm run test:python` scripts added
- 4 new env subcommand help tests

## 0.6.0 — 2026-04-08

### Breaking Changes

- **Named environments** — Scaffold files and Claude Code home directory now live in `~/.devrig/environments/{name}/` instead of per-project `.devrig/`. Set `environment = "local"` to preserve old behavior.
- **Git shim removed** — Network-level security (iptables firewall + mitmproxy) replaces the git push/pull blocking shim.
- **compose.yml restructured** — Now includes mitmproxy sidecar + dev container. Volume paths use `DEVRIG_ENV_DIR` env var.

### Features

- **Named environments** (`devrig env`) — Share Claude Code auth, memories, and settings across projects. Types: `"default"` (shared), named (e.g. `"work"`), `"local"` (project-isolated). CLI: `devrig env list|create|inspect|delete`.
- **Network security** — iptables firewall + mitmproxy transparent proxy with domain blocklist and traffic inspection.
- **Traffic inspection** — mitmproxy captures all HTTP/S traffic. Web UI at `localhost:8081`. Hourly `.mitm` file rotation. Offline analysis via `mitmproxy -r` or HAR export.
- **zsh + Powerlevel10k** — Default shell switched to zsh with Powerlevel10k theme, fzf integration, and git-delta for better diffs.
- **Build-time Claude install** — Claude Code installed during Docker image build to `/opt/claude`, symlinked to `/usr/local/bin/`. Survives `/home/dev` bind mount.
- **`devrig logs --network`** — Shows mitmproxy web UI URL, log directory, and recent capture files.
- **`environment` field in devrig.toml** — Controls which environment a project uses. Added to configuration wizard.

### Docker

- mitmproxy sidecar service with transparent proxy mode, domain blocklist addon, and traffic capture
- Dev container uses `network_mode: "service:mitmproxy"` for outbound traffic routing
- mitmproxy CA certificate shared via Docker volume and trusted via `NODE_EXTRA_CA_CERTS` + `update-ca-certificates`
- `firewall.sh` — iptables rules: DNS/loopback/Docker networks allowed, HTTP/HTTPS redirected to mitmproxy, everything else rejected
- `DEVRIG_ENV_DIR` environment variable for compose volume paths
- zsh, fzf, git-delta added to Dockerfile
- Claude Code installed at build time via native installer, moved to `/opt/claude`
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
- New `scaffold/mitmproxy/allowlist.py` — domain blocklist mitmproxy addon
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
