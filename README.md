[![CI](https://github.com/fuho/devrig/actions/workflows/ci.yml/badge.svg)](https://github.com/fuho/devrig/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/devrig)](https://npmjs.com/package/devrig) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/node/v/devrig)](https://nodejs.org)

# devrig

**Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in Docker so it can't break your machine.**

Claude Code is powerful — it installs packages, modifies system files, and runs arbitrary commands on your behalf. devrig gives it a containerized playground with your project mounted, optional Chrome browser control, and git safety rails. Two commands to start, zero runtime dependencies. Support for other CLI AI tools may be added in the future.

## Why devrig?

- **Filesystem isolation** — Claude Code runs in a Docker container and can only touch `/workspace` (your project) and its own home directory. Your host OS, dotfiles, and other projects are untouched. This makes `--dangerously-skip-permissions` practical — Claude can't modify anything outside the container's filesystem.
- **Git safety** — `git push` is blocked inside the container, and there are no SSH keys or git credentials mounted — so even if the block were bypassed, there's nothing to authenticate with. Claude can commit freely but can't ship code anywhere. You review and push from your host.
- **Browser control** — Claude Code inside Docker can't access a browser on its own. devrig bridges that gap by relaying Chrome's debugging protocol into the container, letting Claude see and interact with your running app.
- **Zero config** — `npx devrig init` scaffolds everything. No Dockerfiles to write, no compose files to maintain.
- **Clean host** — no global packages, no Claude Code installation on your machine, no leftover processes after sessions end.

> [!NOTE]
> **What devrig does and doesn't isolate:** The container provides filesystem and git credential isolation — Claude cannot access your host files or push to your repos. The container does have internet access, same as running on your host, because Claude Code needs it to install packages and function normally. devrig protects your machine and your repos, not your network.

## Quick Start

```bash
# Scaffold .devrig/ in your project directory
npx devrig init

# Build the container and start a session
npx devrig start
```

Here's what `devrig start` looks like:

```
[devrig] Building Docker image (files changed)...
 => [dev 1/6] FROM node:25-slim
 => ...
[devrig] Build complete.
[devrig] Chrome bridge started on port 9229
[devrig] Starting dev server: npm run dev
[devrig] Dev server ready at http://localhost:3000
[devrig] Opening browser...
[devrig] Waiting for Claude Code to be ready in container...
  [container] Installing Claude Code (native)...
  [container] Claude Code v1.x.x installed
  [container] Setup complete
[devrig] Claude Code is ready.
[devrig] Connecting to Claude Code in container...
```

Your browser opens `/devrig/setup` — a status dashboard that updates live when Claude connects. `devrig init` generates two `CLAUDE.md` files: a host version (with devrig commands) and a container version (with workspace, port, and Chrome bridge instructions). The container version is shadow-mounted read-only, so host and container Claude each see their own instructions — even when running simultaneously. On the first launch after a fresh install, Chrome MCP isn't available yet — Claude will tell you to `/exit` and `devrig start` again to activate it.

From here you're inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with your project at `/workspace`. Claude runs with `--dangerously-skip-permissions`, which skips confirmation prompts — safe here because Claude can't modify anything outside the container's filesystem. When you're done, Ctrl+C or type `/exit` — devrig stops the container, bridge, and dev server. Your code changes, git history, and node_modules persist; the next `devrig start` picks up where you left off.

## CLI

| Command                     | Description                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `devrig init`               | Scaffold `.devrig/` directory and run configuration wizard                    |
| `devrig start [flags]`      | Start a coding session (alias: `devrig claude`)                               |
| `devrig stop`               | Stop a running session from another terminal                                  |
| `devrig status`             | Show whether container, bridge, and dev server are running                    |
| `devrig config`             | Re-run the configuration wizard                                               |
| `devrig clean [--all] [-y]` | Remove Docker artifacts for this project (or `--all` for all devrig projects) |
| `devrig logs [flags]`       | Show logs from a devrig session                                               |
| `devrig exec`               | Re-attach to a running container                                              |
| `devrig doctor`             | Run pre-flight health checks                                                  |
| `devrig update [--force]`   | Update scaffold files to current devrig version                               |

All commands support `--help` for usage details.

### Flags for `start`

| Flag              | Effect                         |
| ----------------- | ------------------------------ |
| `--rebuild`       | Force rebuild the Docker image |
| `--no-chrome`     | Skip Chrome bridge and browser |
| `--no-dev-server` | Skip the dev server            |

## Configuration

### devrig.toml

```toml
tool = "claude"          # AI tool (currently only "claude")
project = "my-project"   # Docker image and container name

[dev_server]
command = "npm run dev"  # Command to start your dev server
port = 3000              # Port the dev server listens on
ready_timeout = 10       # Seconds to wait for the server to respond

[chrome_bridge]
port = 9229              # Chrome debugging protocol port

[claude]
version = "latest"       # "latest", "stable", or a specific version like "2.1.89"
# ready_timeout = 120    # Seconds to wait for Claude Code setup
```

To disable the Chrome bridge or dev server, delete its entire section (including the `[section_name]` header) from `devrig.toml`.

<details>
<summary>Full configuration reference</summary>

| Field           | Section           | Default            | Description                                          |
| --------------- | ----------------- | ------------------ | ---------------------------------------------------- |
| `tool`          | top-level         | `"claude"`         | AI tool to use (future: codex, open-code)            |
| `project`       | top-level         | `"claude-project"` | Docker image/container name                          |
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
> `CLAUDE_PARAMS=--dangerously-skip-permissions` lets Claude Code run without confirmation prompts. Normally risky on a host machine, but inside devrig's container Claude can only touch `/workspace` and `/home/dev` — your host filesystem is off limits. The config wizard sets this by default.

> [!NOTE]
> The container has **no SSH keys and no git credentials** by design. Claude Code can modify files and make commits locally, but it cannot push code or access private repositories. You review and push from your host.

### Session Management

- `devrig stop` tears down a running session from another terminal — stops the container, bridge, and dev server.
- `devrig status` shows the current state of each component.
- If a session crashes, the next `devrig start` detects the stale lock and recovers automatically.

## Customization

### Dockerfile

Edit `.devrig/Dockerfile` directly to add system packages, change the base image, or modify the container setup. Your changes survive `devrig start` and `--rebuild` — the image is always built from your local Dockerfile.

> [!WARNING]
> Running `devrig init` again will prompt to overwrite `.devrig/`. Use `devrig update` to selectively update scaffold files without losing your Dockerfile changes.

For compose-level changes (volumes, ports, resource limits), create a `docker-compose.override.yml` in your project root.

### Package persistence

`node_modules` is a named Docker volume — it persists across container restarts and even `--rebuild`. Running `devrig clean` removes the volume, triggering a fresh `npm install` on the next start. For large projects, the first start may be slow while packages install inside the container.

## What's Inside the Container

<details>
<summary>Container details</summary>

| Aspect          | Details                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| **Base image**  | `node:25-slim`                                                                 |
| **Tools**       | git, ripgrep, gh, socat, vim, tree, pnpm, curl, jq                             |
| **User**        | `dev` with UID matching your host (no permission issues on Linux)              |
| **Git safety**  | `git push` blocked, `git pull` on master blocked, no SSH keys                  |
| **Resources**   | 8 GB memory, 4 CPUs (edit compose files to change)                             |
| **PID 1**       | tini (`init: true`) for proper zombie process reaping                          |
| **tmpfs**       | `/tmp` mounted in-memory for faster temp operations                            |
| **Claude Code** | Installed automatically on first start, version configurable via `devrig.toml` |
| **Volumes**     | Project at `/workspace`, node_modules persisted, home dir at `/home/dev`       |
| **Isolation**   | `.devrig/` masked inside container; `CLAUDE.md` shadow-mounted read-only       |

</details>

## Prerequisites

> [!IMPORTANT]
>
> - Node.js >= 18.3
> - [OrbStack](https://orbstack.dev/) (recommended on macOS), [Docker Desktop](https://www.docker.com/products/docker-desktop/), or any Docker-compatible runtime with Compose support (Docker Engine + plugin, Podman with `podman-compose`)

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
  config.js          TOML parser, config loading
  session.js         Session lock, stop, status, staleness
  cleanup.js         Process termination, Docker teardown
  docker.js          Compose commands, build hash, rebuild detection
  configure.js       Interactive configuration wizard
  browser.js         Platform-aware Chrome launcher
  bridge-host.cjs    TCP-to-Unix relay for Chrome bridge
  init.js            Scaffold copying, gitignore management
  log.js             Logging helpers
  logs.js            Log viewer (dev server + container)
  exec.js            Container re-attach
  doctor.js          Pre-flight health checks
  update.js          Scaffold file updater
scaffold/
  Dockerfile         Container image
  .dockerignore      Excludes runtime artifacts from Docker build context
  compose.yml        Docker Compose configuration
  entrypoint.sh      Container entrypoint
  container-setup.js Runs inside container — installs Claude Code, sets up bridge
  template/          Starter files for new projects
test/
  *.test.js          Node built-in test runner, no external deps
                     (includes scaffold content + Docker integration tests)
```

</details>

## Acknowledgments

The Chrome browser bridge is based on [claude-code-remote-chrome](https://github.com/vaclavpavek/claude-code-remote-chrome) by [Vaclav Pavek](https://github.com/vaclavpavek).

## License

[MIT](LICENSE)
