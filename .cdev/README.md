# cdev Scaffold

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) inside a Docker container with optional Chrome browser control and dev server management.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- Python 3.11+
- Node.js (for the Chrome bridge)

## Quick Start

```bash
# 1. Copy the scaffold into your project
cp -r .cdev/ /path/to/your-project/.cdev/
cp cdev /path/to/your-project/
cd /path/to/your-project

# 2. Create your .env
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY

# 3. Configure
./cdev config

# 4. Launch
./cdev claude
```

## What It Does

The launcher (`./cdev claude`) orchestrates a full session:

1. **Builds** a Docker image (auto-rebuilds when Dockerfile or compose config changes)
2. **Starts** the container with your project mounted at `/workspace`
3. **Starts** the Chrome bridge (optional — lets Claude control your host browser)
4. **Starts** your dev server (optional — e.g. `npm run dev`)
5. **Opens** the browser to your dev server URL
6. **Waits** for Claude Code to install inside the container
7. **Connects** you to Claude Code with direct TTY passthrough

On exit (Ctrl+C or `/exit`), everything is cleaned up automatically.

## Configuration

### cdev.toml

Created by `./cdev config` or by copying `cdev.toml.example`.

```toml
project = "my-project"           # Docker image/container naming

[dev_server]
command = "npm run dev"           # Host command to start dev server
port = 3000                       # Port to poll for readiness
ready_timeout = 10                # Seconds to wait

[chrome_bridge]
port = 9229                       # Bridge relay port
```

Remove a section to disable that feature.

### .env

```bash
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_PARAMS=--dangerously-skip-permissions
GIT_AUTHOR_NAME=Your Name
GIT_AUTHOR_EMAIL=you@example.com
```

`CLAUDE_PARAMS` is passed to the `claude` command inside the container.

## CLI Reference

```
./cdev claude [flags]
  --npm            Use npm Claude Code installer instead of native (default: native)
  --rebuild        Force rebuild the Docker image
  --no-chrome      Skip opening the browser
  --no-dev-server  Skip starting the dev server (if configured)
  --tunnel         Log all TTY bytes for diagnostics

./cdev config
  Interactive wizard to create cdev.toml
```

## Container Details

- **Base image**: `node:25-slim` with git, ripgrep, gh, socat, python3, vim, tree, pnpm
- **User**: `dev` with UID matching your host (avoids permission issues)
- **Git safety**: `git push` is blocked; `git pull` on master is blocked
- **Volumes**: `node_modules` (named volume) + `.cdev/home/` (bind-mounted as `/home/dev` — persists Claude config, installs, npm cache)
- **Resources**: 8 GB memory, 4 CPUs (configurable in compose files)

## Files

```
.cdev/
  compose.yml                       # Compose config (native installer, default)
  compose.npm.yml                   # Compose config (npm install)
  Dockerfile                        # Container image (native, default)
  Dockerfile.npm                    # Container image (npm)
  entrypoint.sh                     # Container entrypoint
  container-setup.py                # Installs Claude Code on first run
  launcher.py                       # Main orchestrator
  configure.py                      # Config wizard
  bridge-host.cjs                   # Chrome extension bridge relay
  tty-tunnel.py                     # TTY diagnostics logger
  analyze-tty-log.py                # TTY log analyzer
  cdev.toml.example                 # Example config
cdev                                # Entry point script
.env.example                        # Example environment variables
```
