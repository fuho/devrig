# Changelog

## 0.3.0 — 2026-04-03

### Features

- Custom Node dev server (`server.js`) replaces `npx -y serve` in project template — zero dependencies
- `/devrig/setup` — user-facing status dashboard with live SSE updates when agent connects
- `/devrig/status` — JSON endpoint for programmatic status checks
- `/devrig/events` — SSE stream for real-time agent connection events
- `AGENTS.md` generated during `devrig init` with workspace, dev server, and Chrome bridge details
- AGENTS.md uses `<!-- devrig:start/end -->` markers for safe re-generation on subsequent inits
- Browser now opens `/devrig/setup` instead of the raw dev server root

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
- Chrome browser bridge (TCP-to-Unix relay for Docker ↔ Chrome integration)
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
