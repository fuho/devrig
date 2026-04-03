# devrig

Containerized AI coding environment with browser control.

Run AI coding agents (currently Claude Code) inside Docker with optional Chrome browser control and dev server management. Zero dependencies.

## Quick Start

```bash
# In your project directory
npx devrig init
npx devrig start
```

`devrig init` scaffolds a `.devrig/` directory with Docker infrastructure and walks you through configuration. `devrig start` builds the container, starts services, and connects you to Claude Code.

## What It Does

`devrig start` orchestrates a full session:

1. Builds a Docker image (auto-rebuilds when config changes)
2. Starts the container with your project mounted at `/workspace`
3. Starts the Chrome bridge (optional — lets the AI control your host browser)
4. Starts your dev server (optional — e.g. `npm run dev`)
5. Opens the browser to your dev server URL
6. Waits for the AI tool to install inside the container
7. Connects you with direct TTY passthrough

On exit (Ctrl+C or `/exit`), everything is cleaned up automatically.

## CLI

```
devrig init                 Initialize devrig in the current directory
devrig start [flags]        Start a coding session (alias: devrig claude)
devrig config               Re-run the configuration wizard
```

Flags for `start`:

```
--rebuild        Force rebuild the Docker image
--no-chrome      Skip Chrome bridge and browser
--no-dev-server  Skip the dev server
--npm            Use npm installer instead of native
```

## Configuration

### devrig.toml

Created by `devrig init` or `devrig config`.

```toml
tool = "claude"
project = "my-project"

[dev_server]
command = "npm run dev"
port = 3000

[chrome_bridge]
port = 9229
```

Remove a section to disable that feature. The `tool` field is for future multi-tool support.

### .env

```bash
CLAUDE_PARAMS=--dangerously-skip-permissions
GIT_AUTHOR_NAME=Your Name
GIT_AUTHOR_EMAIL=you@example.com
```

## Container Details

- **Base image**: `node:25-slim` with git, ripgrep, gh, socat, vim, tree, pnpm
- **User**: `dev` with UID matching your host (avoids permission issues)
- **Git safety**: `git push` is blocked; `git pull` on master is blocked
- **Resources**: 8 GB memory, 4 CPUs (configurable in compose files)

## Prerequisites

- Node.js >= 18.3
- Docker Desktop (or Docker Engine + Compose plugin)

## Development

```bash
npm test            # Unit + integration tests
npm run test:docker # Docker integration tests
npm run test:e2e    # End-to-end tests
npm run test:all    # Everything
```

## Acknowledgments

The Chrome browser bridge is based on [claude-code-remote-chrome](https://github.com/vaclavpavek/claude-code-remote-chrome) by [Vaclav Pavek](https://github.com/vaclavpavek). His work on bridging Chrome's Native Messaging Host socket into Docker made this project possible.

## License

MIT
