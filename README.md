[![CI](https://github.com/fuho/devrig/actions/workflows/ci.yml/badge.svg)](https://github.com/fuho/devrig/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/devrig)](https://npmjs.com/package/devrig) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/node/v/devrig)](https://nodejs.org)

# devrig

**Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in Docker so it can't break your machine.**

Claude Code is powerful — it installs packages, modifies system files, and runs arbitrary commands on your behalf. Devrig gives it a containerized playground with network-level security, optional Chrome browser control, and traffic inspection. Two commands to start, zero runtime dependencies.

## Why devrig?

- **Network isolation** — All outbound traffic passes through a transparent MITM proxy with domain allowlisting. Only approved domains (Anthropic API, npm, GitHub) can be reached. Everything else is blocked and logged.
- **Traffic inspection** — Full HTTP/S request/response logging via mitmproxy. Web UI at `localhost:8081` for live monitoring. Captured traffic can be analyzed offline.
- **Filesystem isolation** — Claude Code runs in a Docker container and can only touch `/workspace` (your project) and its own home directory. Your host OS, dotfiles, and other projects are untouched.
- **Browser control** — Claude Code inside Docker can't access a browser on its own. Devrig bridges Chrome's debugging protocol into the container, letting Claude see and interact with your running app.
- **Shared environments** — Named environments share Claude Code auth, memories, and settings across projects. Log in once, use everywhere.
- **Zero config** — `npx devrig init` scaffolds everything. No Dockerfiles to write, no compose files to maintain.
- **Clean host** — no global packages, no Claude Code installation on your machine, no leftover processes after sessions end.

## Quick Start

```bash
# Scaffold a project and choose an environment
npx devrig init

# Build the container and start a session
npx devrig start
```

Here's what `devrig start` looks like:

```
[devrig] Using environment "default" at ~/.devrig/environments/default
[devrig] Building Docker image (files changed)...
[devrig] Build complete.
[devrig] Chrome bridge started on port 9229
[devrig] Starting dev server: npm run dev
[devrig] Dev server ready at http://localhost:3000
[devrig] Opening browser...
[devrig] Waiting for Claude Code to be ready in container...
[devrig] Claude Code is ready.
[devrig] Dev server: http://localhost:3000
[devrig] Network inspector: http://localhost:8081
[devrig] Connecting to Claude Code in container...
```

## CLI

| Command                | Description                                                                       |
| ---------------------- | --------------------------------------------------------------------------------- |
| `devrig init`          | Scaffold project and run configuration wizard                                     |
| `devrig start [flags]` | Start a coding session                                                            |
| `devrig stop`          | Stop a running session from another terminal                                      |
| `devrig status`        | Show whether container, bridge, and dev server are running                        |
| `devrig config`        | Re-run the configuration wizard                                                   |
| `devrig env <command>` | Manage named environments (`list`, `create`, `inspect`, `delete`)                 |
| `devrig clean [flags]` | Remove Docker artifacts (`--project`, `-a/--all`, `-l/--list`, `--orphans`, `-y`) |
| `devrig logs [flags]`  | Show logs (`--dev-server`, `--container`, `--network`, `-f`)                      |
| `devrig exec`          | Re-attach to a running container                                                  |
| `devrig doctor`        | Run pre-flight health checks                                                      |
| `devrig update`        | Update scaffold files to current devrig version                                   |

All commands support `--help` for usage details. Use `devrig help <command>` as an alternative.

### Global Flags

| Flag        | Effect                          |
| ----------- | ------------------------------- |
| `--verbose` | Show detailed diagnostic output |

### Flags for `start`

| Flag              | Effect                         |
| ----------------- | ------------------------------ |
| `--rebuild`       | Force rebuild the Docker image |
| `--no-chrome`     | Skip Chrome bridge and browser |
| `--no-dev-server` | Skip the dev server            |

## Environments

Environments share Claude Code auth, memories, and settings across projects. They live at `~/.devrig/environments/{name}/`.

```bash
devrig env list                # Show all environments
devrig env create work         # Create a named environment
devrig env inspect default     # Show details (path, version, auth status)
devrig env delete work         # Remove an environment
```

### Environment types

| Type             | Location                          | Use case                                   |
| ---------------- | --------------------------------- | ------------------------------------------ |
| `"default"`      | `~/.devrig/environments/default/` | Most users — shared across all projects    |
| Named (`"work"`) | `~/.devrig/environments/work/`    | Separate Claude identity for work/personal |
| `"local"`        | `.devrig/` in project             | Fully isolated, legacy behavior            |

Set during `devrig init` or in `devrig.toml`:

```toml
environment = "default"   # or "work", "local", etc.
```

## Network Security

All outbound traffic from the dev container passes through a transparent mitmproxy:

- **Domain blocklist** — All traffic is allowed by default. Specific domains can be blocked (e.g. telemetry endpoints). More practical than an allowlist since Claude Code needs many domains to function.
- **HTTPS inspection** — mitmproxy CA certificate is trusted inside the container. Full request/response bodies are captured.
- **Traffic capture** — `.mitm` files with hourly rotation. Analyze offline with `mitmproxy -r <file>` or convert to HAR.
- **Firewall** — iptables rules redirect HTTP/HTTPS to mitmproxy and block all other outbound traffic.

### Dashboards

| URL                     | What                                       |
| ----------------------- | ------------------------------------------ |
| `http://localhost:3000` | Your dev server (port configurable)        |
| `http://localhost:8081` | mitmproxy web UI — live traffic inspection |

### Network logs

```bash
devrig logs --network          # Show mitmproxy log locations and recent captures
```

## Configuration

### devrig.toml

```toml
tool = "claude"           # AI tool (currently only "claude")
project = "my-project"    # Docker image and container name
environment = "default"   # Shared environment name, or "local"

[dev_server]
command = "npm run dev"   # Command to start your dev server
port = 3000               # Port the dev server listens on
ready_timeout = 10        # Seconds to wait for the server to respond

[chrome_bridge]
port = 9229               # Chrome debugging protocol port

[claude]
version = "latest"        # "latest", "stable", or a specific version like "2.1.89"
# ready_timeout = 120     # Seconds to wait for Claude Code setup
```

<details>
<summary>Full configuration reference</summary>

| Field           | Section           | Default            | Description                                          |
| --------------- | ----------------- | ------------------ | ---------------------------------------------------- |
| `tool`          | top-level         | `"claude"`         | AI tool to use                                       |
| `project`       | top-level         | `"claude-project"` | Docker image/container name                          |
| `environment`   | top-level         | `"default"`        | Environment name: "default", named, or "local"       |
| `command`       | `[dev_server]`    | _(none)_           | Shell command to start your dev server               |
| `port`          | `[dev_server]`    | `3000`             | Port the dev server listens on                       |
| `ready_timeout` | `[dev_server]`    | `10`               | Seconds to wait for dev server readiness             |
| `port`          | `[chrome_bridge]` | `9229`             | Chrome debugging protocol port                       |
| `version`       | `[claude]`        | `"latest"`         | Claude Code version: "latest", "stable", or "2.1.89" |
| `ready_timeout` | `[claude]`        | `120`              | Seconds to wait for Claude Code setup                |

</details>

### .env

Per-session environment variables. `devrig config` creates this file (or appends to it if it already exists) — your existing entries are preserved.

```bash
CLAUDE_PARAMS=--dangerously-skip-permissions
GIT_AUTHOR_NAME=Your Name
GIT_AUTHOR_EMAIL=you@example.com
```

> [!TIP]
> `CLAUDE_PARAMS=--dangerously-skip-permissions` lets Claude Code run without confirmation prompts. Inside devrig's container, Claude can only touch `/workspace` and `/home/dev`, and all network traffic is filtered through the mitmproxy allowlist.

> [!NOTE]
> The container has **no SSH keys and no git credentials** by design. Claude Code can modify files and make commits locally, but it cannot push code or access private repositories. You review and push from your host.

## What's Inside the Container

<details>
<summary>Container details</summary>

| Aspect          | Details                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| **Base image**  | `node:25-slim`                                                           |
| **Shell**       | zsh with Powerlevel10k theme                                             |
| **Tools**       | git, ripgrep, gh, socat, vim, tree, pnpm, curl, jq, fzf, git-delta       |
| **User**        | `dev` with UID matching your host (no permission issues on Linux)        |
| **Network**     | mitmproxy transparent proxy with domain allowlist + iptables firewall    |
| **Routing**     | Dev server on host, accessible at `http://localhost:{port}`              |
| **Resources**   | 8 GB memory, 4 CPUs (edit compose files to change)                       |
| **PID 1**       | tini (`init: true`) for proper zombie process reaping                    |
| **tmpfs**       | `/tmp` mounted in-memory for faster temp operations                      |
| **Claude Code** | Installed at build time, version configurable via `devrig.toml`          |
| **Volumes**     | Project at `/workspace`, node_modules persisted, home dir at `/home/dev` |
| **Isolation**   | `.devrig/` masked inside container; `CLAUDE.md` shadow-mounted read-only |

</details>

## Prerequisites

> [!IMPORTANT]
>
> - Node.js >= 18.3
> - [OrbStack](https://orbstack.dev/) (recommended on macOS), [Docker Desktop](https://www.docker.com/products/docker-desktop/), or any Docker-compatible runtime with Compose support

## Development

| Command                 | What it does                                               |
| ----------------------- | ---------------------------------------------------------- |
| `npm test`              | Unit + integration tests (including scaffold verification) |
| `npm run test:docker`   | Docker integration tests (build + runtime)                 |
| `npm run test:coverage` | Tests with V8 coverage report                              |
| `npm run lint`          | ESLint                                                     |
| `npm run format:check`  | Prettier check                                             |
| `npm run typecheck`     | TypeScript JSDoc type checking                             |
| `npm run check`         | All of the above, sequentially                             |

<details>
<summary>Project structure</summary>

```
bin/
  devrig.js          CLI entry point
src/
  launcher.js        Main orchestrator (build, start, connect)
  config.js          TOML parser, config loading, resolveEnvDir
  env.js             Named environment CRUD operations
  session.js         Session lock, stop, status, staleness
  cleanup.js         Process termination, Docker teardown
  docker.js          Compose commands, build hash, rebuild detection
  configure.js       Interactive configuration wizard
  browser.js         Platform-aware Chrome launcher
  bridge-host.cjs    TCP-to-Unix relay for Chrome bridge (host side)
  init.js            Scaffold copying, gitignore management
  log.js             Logging helpers (log, die, verbose, setVerbose)
  logs.js            Log viewer (dev server, container, network)
  exec.js            Container re-attach
  doctor.js          Pre-flight health checks
  update.js          Scaffold file updater
scaffold/
  Dockerfile            Container image (zsh, Claude Code, tools)
  .dockerignore         Excludes runtime artifacts from Docker build context
  chrome-mcp-bridge.cjs MCP-to-NMH protocol translator for Chrome bridge
  compose.yml           Docker Compose (mitmproxy + dev container)
  entrypoint.sh         Container entrypoint (CA cert install, privilege drop)
  container-setup.js    Runs inside container (bridge setup, settings config)
  firewall.sh           iptables rules for outbound traffic control
  mitmproxy/
    allowlist.py        Domain allowlist addon for mitmproxy
  template/             Starter files for new projects
docs/
  chrome-bridge.md    Chrome bridge architecture documentation
test/
  *.test.js          Node built-in test runner, no external deps
```

</details>

## Acknowledgments

The Chrome browser bridge is based on [claude-code-remote-chrome](https://github.com/vaclavpavek/claude-code-remote-chrome) by [Vaclav Pavek](https://github.com/vaclavpavek).

## License

[MIT](LICENSE)
