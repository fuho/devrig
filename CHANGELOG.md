# Changelog

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
