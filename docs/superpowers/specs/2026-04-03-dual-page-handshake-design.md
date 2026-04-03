# Spec: Dual-Page Template, Agent Handshake, and AGENTS.md

## Goal

Replace the static file server template with a tiny Node server that enables a live handshake between the user and the AI agent. When Claude Code opens the dev server in its Chrome MCP tab, the user's setup page updates in real time. Also generate an AGENTS.md during init to guide the agent.

## Constraints

- Zero runtime dependencies (Node stdlib only)
- server.js should be ~80-100 lines max
- Must work as a drop-in replacement for `npx -y serve`
- /setup page must survive user replacing all project files

---

## Architecture

### URL Structure

| URL              | Audience           | Purpose                                                                                          |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `/`              | Agent + User's app | Serves `index.html` from project dir. Initially the agent welcome page, later the user's app.    |
| `/devrig/setup`  | User               | Status dashboard. Live SSE updates when agent connects. Served from `.devrig/`, not project dir. |
| `/devrig/events` | User's browser     | SSE stream. Pushes `agent-connected` event when agent hits `/`.                                  |
| `/devrig/status` | Programmatic       | JSON: `{ agentConnected, agentName, uptime }`                                                    |
| `/*`             | Anyone             | Static files from project directory (user's app)                                                 |

All devrig routes are namespaced under `/devrig/` so they never collide with the user's own routes.

### Flow

1. `devrig start` opens `localhost:3000/setup` in the user's browser
2. Setup page shows two status indicators: "Dev server running" (green) + "Waiting for Claude Code..." (pulsing gray)
3. Claude Code starts, reads AGENTS.md, opens `localhost:3000` in Chrome MCP tab group
4. Server detects request to `/`, marks agent as connected, pushes SSE event to `/devrig/events`
5. Setup page flips "Waiting for Claude Code..." to "Claude Code connected" (green)
6. User begins developing. They replace `index.html` with their app. `/setup` remains available from `.devrig/`.

---

## Components

### 1. Template Server (`scaffold/template/server.js`)

Pure `http.createServer`, ~80-100 lines. Responsibilities:

- **Static file serving:** Serves files from the project directory (cwd). Supports `.html`, `.js`, `.css`, `.json`, `.png`, `.jpg`, `.svg`, `.ico`. Returns 404 for missing files.
- **SSE endpoint (`/devrig/events`):** Keeps connections open. Stores active connections in an array. When agent connects, iterates connections and writes `event: agent-connected\ndata: {}\n\n`.
- **Status endpoint (`/devrig/status`):** Returns JSON with `agentConnected` (boolean), `agentName` (from env or "claude"), `startedAt` (ISO timestamp).
- **Agent detection:** Any GET request to `/` or `/index.html` sets `agentConnected = true` and broadcasts SSE. Simple boolean flip — no authentication needed since this is localhost-only.
- **Setup page (`/devrig/setup`):** Reads and serves `.devrig/setup.html`. Not from the project directory — survives user file changes. Returns 404 if `.devrig/setup.html` is missing (edge case — shouldn't happen with scaffold).
- **Routing priority:** `/devrig/*` routes are matched first, then static files from the project directory.
- **Port:** Reads from `PORT` env var (set by devrig launcher), defaults to 3000.

### 2. Setup Page (`.devrig/setup.html` via `scaffold/setup.html`)

Dark theme, same visual style as the current template. Not in the project directory — lives in `.devrig/` so it's always available.

Content:

- "devrig" heading + project name
- Two status rows:
  - "Dev server" — always green (if you're seeing this page, it's running)
  - "Claude Code" — pulsing gray initially, flips to green on SSE `agent-connected` event
- Hint text: "Waiting for Claude Code to connect via Chrome MCP..."
- After connection: hint changes to "Claude Code is connected and can see your app at localhost:3000"

JavaScript: Opens `EventSource('/devrig/events')`. On `agent-connected` event, updates the dot and text.

### 3. Agent Page (`scaffold/template/index.html`)

The root page that the agent sees. Visually minimal:

- "devrig" heading, project name subtitle, green status dot
- "Hello, Claude." greeting (or dynamic based on tool name)

Hidden instructions in an HTML comment:

```html
<!--devrig-config
workspace: /workspace
dev_server: http://localhost:3000
chrome_bridge: enabled
tool: claude
-->
```

This is what the agent's Chrome MCP reads when it opens the page.

### 4. AGENTS.md Generation

Generated during `devrig init`, after the config wizard. Content is dynamic based on config:

```markdown
<!-- devrig:start -->

## devrig

This project uses devrig to run AI agents in a Docker container.

- **Workspace:** /workspace
- **Dev server:** http://localhost:{port}
- **Chrome bridge:** {enabled|disabled} (port {bridge_port})

When starting a session, open http://localhost:{port} in your Chrome MCP tab
group to see the project and confirm the connection.

Git push is blocked inside this container. Make commits freely — the user will
review and push from the host.

<!-- devrig:end -->
```

**Append behavior:** If AGENTS.md exists, look for `<!-- devrig:start -->` / `<!-- devrig:end -->` markers. If found, replace the block. If not found, append the block. If AGENTS.md doesn't exist, create it.

Same marker pattern used in `.env` management (`configure.js`).

---

## Changes to Existing Files

### scaffold/template/package.json

```json
{
  "name": "my-project",
  "scripts": {
    "dev": "node server.js"
  }
}
```

Changed from `"dev": "npx -y serve . -l ${PORT:-3000}"` to `"dev": "node server.js"`.

### scaffold/ (new files)

- `scaffold/template/server.js` — the Node dev server
- `scaffold/setup.html` — the setup/status page (copied to `.devrig/setup.html`, NOT to project dir)

### scaffold/template/index.html

Rewrite to be the agent-facing page with hidden config comment. Keep the dark theme and visual style.

### src/init.js

- Copy `scaffold/setup.html` to `.devrig/setup.html` (alongside other scaffold files)
- Generate AGENTS.md after config wizard runs (needs config values)

### src/configure.js

- Change default `dev_server_cmd` suggestion from `npm run dev` (keep this — it's what package.json scripts use) — no change needed here actually, since we're updating the package.json template's `dev` script.

### src/launcher.js

- Change `openBrowser()` call to open `localhost:{port}/devrig/setup` instead of `localhost:{port}`

---

## What This Does NOT Change

- The Chrome bridge relay (`bridge-host.cjs`) — unchanged
- Container setup (`container-setup.js`) — unchanged
- Docker configuration (Dockerfile, compose files) — unchanged
- Config format (`devrig.toml`) — unchanged
- Session management — unchanged

---

## Verification

1. `devrig init` in fresh dir → generates AGENTS.md, copies setup.html to .devrig/
2. `devrig start` → browser opens `/devrig/setup`, shows "Waiting for Claude Code..."
3. Inside Claude session, ask Claude to open localhost:3000 → setup page flips to "Connected"
4. Replace index.html with custom content → `/devrig/setup` still works
5. Re-run `devrig init` on existing project → AGENTS.md devrig section updated, not duplicated
6. `npm run check` passes
