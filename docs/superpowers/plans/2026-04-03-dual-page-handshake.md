# Dual-Page Handshake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static file server template with a Node dev server that enables a live SSE handshake between the user's setup page and the agent's index page, and generate AGENTS.md during init.

**Architecture:** The template gets a new `server.js` (pure `http.createServer`, zero deps) that serves static files, an SSE endpoint, and a status JSON endpoint. The user sees `/devrig/setup` (from `.devrig/setup.html`), the agent sees `/` (`index.html`). When the agent GETs `/`, the server pushes an SSE event to the setup page. AGENTS.md is generated after `configure()` using `<!-- devrig:start/end -->` markers.

**Tech Stack:** Node.js stdlib only (`http`, `fs`, `path`). Node built-in test runner. ESLint + Prettier + TSC JSDoc.

**Spec:** `docs/superpowers/specs/2026-04-03-dual-page-handshake-design.md`

---

## Task 1: Create `scaffold/template/server.js`

**Files:**

- Create: `scaffold/template/server.js`

- [ ] **Step 1: Create the dev server**

Create `/Users/fuho/Repos/cdev/scaffold/template/server.js`:

```js
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = process.cwd();
const DEVRIG_DIR = join(ROOT, '.devrig');
const startedAt = new Date().toISOString();

let agentConnected = false;
const agentName = process.env.DEVRIG_TOOL || 'claude';

/** @type {import('node:http').ServerResponse[]} */
const sseClients = [];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

function serveFile(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const body = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // --- devrig routes (matched first) ---

  if (path === '/devrig/setup') {
    serveFile(res, join(DEVRIG_DIR, 'setup.html'));
    return;
  }

  if (path === '/devrig/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: connected\ndata: {}\n\n`);
    if (agentConnected) {
      res.write(`event: agent-connected\ndata: ${JSON.stringify({ agent: agentName })}\n\n`);
    }
    sseClients.push(res);
    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  if (path === '/devrig/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agentConnected, agentName, startedAt }));
    return;
  }

  // --- Agent detection on GET / ---

  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    if (!agentConnected) {
      agentConnected = true;
      broadcast('agent-connected', { agent: agentName });
    }
  }

  // --- Static file serving ---

  const filePath = join(ROOT, path === '/' ? 'index.html' : path);
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`devrig server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Commit**

```bash
git add scaffold/template/server.js
git commit -m "feat: add template dev server with SSE handshake"
```

---

## Task 2: Create `scaffold/setup.html`

**Files:**

- Create: `scaffold/setup.html`

- [ ] **Step 1: Create the setup page**

Create `/Users/fuho/Repos/cdev/scaffold/setup.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>devrig — Setup</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        background: #0a0a0a;
        color: #e0e0e0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .card {
        background: #161616;
        border: 1px solid #2a2a2a;
        border-radius: 12px;
        padding: 48px;
        max-width: 520px;
        width: 90%;
      }
      h1 {
        font-size: 28px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .subtitle {
        color: #888;
        font-size: 14px;
        margin-bottom: 32px;
      }
      .checks {
        list-style: none;
        margin-bottom: 32px;
      }
      .checks li {
        padding: 10px 0;
        border-bottom: 1px solid #1e1e1e;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 15px;
      }
      .checks li:last-child {
        border-bottom: none;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #22c55e;
        flex-shrink: 0;
      }
      .dot.pending {
        background: #555;
        animation: pulse 1.5s ease-in-out infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 0.4;
        }
        50% {
          opacity: 1;
        }
      }
      .hint {
        background: #1a1a1a;
        border: 1px solid #252525;
        border-radius: 8px;
        padding: 16px;
        font-size: 13px;
        color: #999;
        line-height: 1.5;
      }
      .hint code {
        background: #222;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        color: #ccc;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>devrig</h1>
      <div class="subtitle">Setup status</div>
      <ul class="checks">
        <li><span class="dot"></span> Dev server running</li>
        <li>
          <span class="dot pending" id="agent-dot"></span>
          <span id="agent-status">Waiting for Claude Code...</span>
        </li>
      </ul>
      <div class="hint" id="hint">Waiting for Claude Code to connect via Chrome MCP...</div>
    </div>
    <script>
      const dot = document.getElementById('agent-dot');
      const status = document.getElementById('agent-status');
      const hint = document.getElementById('hint');
      const es = new EventSource('/devrig/events');
      es.addEventListener('agent-connected', () => {
        dot.classList.remove('pending');
        status.textContent = 'Claude Code connected';
        hint.innerHTML =
          'Claude Code is connected and can see your app at <code>localhost:' +
          location.port +
          '</code>';
      });
      es.onerror = () => {
        status.textContent = 'Connection lost — refresh to retry';
        dot.classList.add('pending');
      };
    </script>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add scaffold/setup.html
git commit -m "feat: add setup page with SSE agent detection"
```

---

## Task 3: Rewrite `scaffold/template/index.html`

**Files:**

- Modify: `scaffold/template/index.html`

- [ ] **Step 1: Replace with agent-facing page**

Replace the entire contents of `/Users/fuho/Repos/cdev/scaffold/template/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>devrig</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        background: #0a0a0a;
        color: #e0e0e0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .card {
        background: #161616;
        border: 1px solid #2a2a2a;
        border-radius: 12px;
        padding: 48px;
        max-width: 520px;
        width: 90%;
        text-align: center;
      }
      h1 {
        font-size: 28px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .subtitle {
        color: #888;
        font-size: 14px;
        margin-bottom: 24px;
      }
      .status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 24px;
        font-size: 14px;
        color: #22c55e;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #22c55e;
      }
      .greeting {
        font-size: 13px;
        color: #666;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>devrig</h1>
      <div class="subtitle">my-project</div>
      <div class="status"><span class="dot"></span> Ready</div>
      <div class="greeting">Hello, Claude.</div>
    </div>
    <!--devrig-config
  workspace: /workspace
  dev_server: http://localhost:3000
  chrome_bridge: enabled
  tool: claude
  --></body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add scaffold/template/index.html
git commit -m "feat: rewrite template index.html as agent-facing page"
```

---

## Task 4: Update `scaffold/template/package.json`

**Files:**

- Modify: `scaffold/template/package.json`

- [ ] **Step 1: Change dev script**

Replace contents of `/Users/fuho/Repos/cdev/scaffold/template/package.json`:

```json
{
  "name": "my-project",
  "private": true,
  "scripts": {
    "dev": "node server.js"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scaffold/template/package.json
git commit -m "feat: change template dev script to use node server.js"
```

---

## Task 5: Add `server.js` to template copy list in `src/configure.js`

**Files:**

- Modify: `src/configure.js`

- [ ] **Step 1: Edit the template file loop**

In `/Users/fuho/Repos/cdev/src/configure.js`, find the line:

```js
      for (const f of ['index.html', 'package.json']) {
```

Change to:

```js
      for (const f of ['index.html', 'package.json', 'server.js']) {
```

- [ ] **Step 2: Commit**

```bash
git add src/configure.js
git commit -m "feat: include server.js in template file copy"
```

---

## Task 6: Add setup.html copy + AGENTS.md generation to `src/init.js`

**Files:**

- Modify: `src/init.js`

- [ ] **Step 1: Add loadConfig import**

In `/Users/fuho/Repos/cdev/src/init.js`, add to the imports (line 6):

```js
import { getPackageVersion, loadConfig } from './config.js';
```

And remove the standalone `getPackageVersion` import.

- [ ] **Step 2: Add marker constants and generateAgentsMd function**

After the `const __dirname` line (line 10), add:

```js
const AGENTS_START = '<!-- devrig:start -->';
const AGENTS_END = '<!-- devrig:end -->';

/**
 * Generates or updates the devrig section in AGENTS.md.
 * @param {string} projectDir
 * @param {{ dev_server_port: number, bridge_enabled: boolean, bridge_port: number }} cfg
 */
export function generateAgentsMd(projectDir, cfg) {
  const agentsPath = join(projectDir, 'AGENTS.md');
  const block = [
    AGENTS_START,
    '## devrig',
    '',
    'This project uses devrig to run AI agents in a Docker container.',
    '',
    `- **Workspace:** /workspace`,
    `- **Dev server:** http://localhost:${cfg.dev_server_port}`,
    `- **Chrome bridge:** ${cfg.bridge_enabled ? `enabled (port ${cfg.bridge_port})` : 'disabled'}`,
    '',
    `When starting a session, open http://localhost:${cfg.dev_server_port} in your Chrome MCP tab`,
    'group to see the project and confirm the connection.',
    '',
    'Git push is blocked inside this container. Make commits freely — the user will',
    'review and push from the host.',
    AGENTS_END,
  ].join('\n');

  if (existsSync(agentsPath)) {
    let content = readFileSync(agentsPath, 'utf8');
    const startIdx = content.indexOf(AGENTS_START);
    const endIdx = content.indexOf(AGENTS_END);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + block + content.slice(endIdx + AGENTS_END.length);
    } else {
      const sep = content.endsWith('\n') ? '\n' : '\n\n';
      content = content + sep + block + '\n';
    }
    writeFileSync(agentsPath, content);
  } else {
    writeFileSync(agentsPath, block + '\n');
  }
  log('Generated AGENTS.md');
}
```

- [ ] **Step 3: Add setup.html copy after scaffold copy**

After the chmod try/catch block (after line 44), add:

```js
// Copy setup.html into .devrig/ (not in template/ — survives user file changes)
const setupSrc = join(scaffoldDir, 'setup.html');
if (existsSync(setupSrc)) {
  cpSync(setupSrc, join(targetDir, 'setup.html'));
}
```

- [ ] **Step 4: Add AGENTS.md generation after configure()**

After `await configure(projectDir);` (line 76), before the summary output, add:

```js
// Generate AGENTS.md with devrig section
try {
  const cfg = loadConfig(projectDir);
  generateAgentsMd(projectDir, cfg);
} catch {
  log('WARNING: Could not generate AGENTS.md');
}
```

- [ ] **Step 5: Add AGENTS.md to the summary output**

After the `.gitignore` line in the summary, add:

```js
console.log('  AGENTS.md          Instructions for AI agents');
```

- [ ] **Step 6: Commit**

```bash
git add src/init.js
git commit -m "feat: generate AGENTS.md and copy setup.html during init"
```

---

## Task 7: Update `src/launcher.js` browser URL

**Files:**

- Modify: `src/launcher.js`

- [ ] **Step 1: Change openBrowser URL**

In `/Users/fuho/Repos/cdev/src/launcher.js`, change line 231 from:

```js
openBrowser(`http://localhost:${cfg.dev_server_port}`);
```

to:

```js
openBrowser(`http://localhost:${cfg.dev_server_port}/devrig/setup`);
```

- [ ] **Step 2: Commit**

```bash
git add src/launcher.js
git commit -m "feat: open /devrig/setup instead of root URL"
```

---

## Task 8: Add tests

**Files:**

- Create: `test/server.test.js`
- Modify: `test/init.test.js`

- [ ] **Step 1: Create server tests**

Create `/Users/fuho/Repos/cdev/test/server.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templateDir = join(__dirname, '..', 'scaffold', 'template');
const scaffoldDir = join(__dirname, '..', 'scaffold');

describe('template server', () => {
  let tmp;
  let proc;
  const PORT = 19876;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-srv-'));
    mkdirSync(join(tmp, '.devrig'));
    cpSync(join(templateDir, 'server.js'), join(tmp, 'server.js'));
    cpSync(join(templateDir, 'index.html'), join(tmp, 'index.html'));
    cpSync(join(scaffoldDir, 'setup.html'), join(tmp, '.devrig', 'setup.html'));

    proc = spawn('node', ['server.js'], {
      cwd: tmp,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'pipe',
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timeout')), 5000);
      proc.stdout.on('data', (d) => {
        if (d.toString().includes('listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      });
    });
  });

  after(async () => {
    if (proc) proc.kill();
    await new Promise((r) => setTimeout(r, 200));
    rmSync(tmp, { recursive: true, force: true });
  });

  it('serves index.html on GET /', async () => {
    const res = await fetch(`http://localhost:${PORT}/`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('devrig'));
  });

  it('serves /devrig/setup from .devrig/setup.html', async () => {
    const res = await fetch(`http://localhost:${PORT}/devrig/setup`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('Setup status'));
  });

  it('returns JSON from /devrig/status', async () => {
    const res = await fetch(`http://localhost:${PORT}/devrig/status`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(typeof json.agentConnected, 'boolean');
    assert.equal(typeof json.agentName, 'string');
    assert.equal(typeof json.startedAt, 'string');
  });

  it('marks agent as connected after GET /', async () => {
    const res = await fetch(`http://localhost:${PORT}/devrig/status`);
    const json = await res.json();
    assert.equal(json.agentConnected, true);
  });

  it('returns 404 for missing files', async () => {
    const res = await fetch(`http://localhost:${PORT}/nonexistent.html`);
    assert.equal(res.status, 404);
  });

  it('streams SSE events on /devrig/events', async () => {
    const res = await fetch(`http://localhost:${PORT}/devrig/events`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    // Read first chunk (should contain connected + agent-connected since agent already connected)
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('event: connected'));
  });
});
```

- [ ] **Step 2: Add AGENTS.md tests to init.test.js**

At the top of `/Users/fuho/Repos/cdev/test/init.test.js`, add `generateAgentsMd` to the import from `../src/init.js`. Then add at the end of the file:

```js
describe('AGENTS.md generation', () => {
  let tmp;
  const cfg = { dev_server_port: 3000, bridge_enabled: true, bridge_port: 9229 };

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('creates AGENTS.md when none exists', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    generateAgentsMd(tmp, cfg);
    const content = readFileSync(join(tmp, 'AGENTS.md'), 'utf8');
    assert.ok(content.includes('<!-- devrig:start -->'));
    assert.ok(content.includes('<!-- devrig:end -->'));
    assert.ok(content.includes('http://localhost:3000'));
    assert.ok(content.includes('enabled (port 9229)'));
  });

  it('appends to existing AGENTS.md', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    writeFileSync(join(tmp, 'AGENTS.md'), '# My Project\n\nExisting content.\n');
    generateAgentsMd(tmp, cfg);
    const content = readFileSync(join(tmp, 'AGENTS.md'), 'utf8');
    assert.ok(content.startsWith('# My Project'));
    assert.ok(content.includes('<!-- devrig:start -->'));
  });

  it('replaces devrig section on re-run', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    generateAgentsMd(tmp, cfg);
    generateAgentsMd(tmp, { dev_server_port: 8080, bridge_enabled: false, bridge_port: 9229 });
    const content = readFileSync(join(tmp, 'AGENTS.md'), 'utf8');
    assert.ok(content.includes('http://localhost:8080'));
    assert.ok(!content.includes('http://localhost:3000'));
    assert.ok(content.includes('disabled'));
    assert.equal(content.split('<!-- devrig:start -->').length - 1, 1);
  });
});
```

- [ ] **Step 3: Add test scripts to package.json**

Add to scripts in `package.json`:

```json
"test:server": "node --test test/server.test.js",
```

- [ ] **Step 4: Commit**

```bash
git add test/server.test.js test/init.test.js package.json
git commit -m "test: add server and AGENTS.md generation tests"
```

---

## Task 9: Update docs (README, CHANGELOG, TODO)

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `TODO.md`

- [ ] **Step 1: Update TODO.md**

Remove from "Known rough edges":

```
- Template dev server uses `npx -y serve` which can hang on slow networks
```

Add to "Done":

```
- [x] Dual-page handshake with custom Node dev server (replaces `npx -y serve`)
- [x] AGENTS.md generation during `devrig init`
```

- [ ] **Step 2: Update CHANGELOG.md**

The existing 0.2.2 section should be bumped. Add a new section at the top for the features added.

- [ ] **Step 3: Update README.md**

Add mention of AGENTS.md in the "What It Does" or Quick Start area, and note that `/devrig/setup` shows live connection status.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md TODO.md
git commit -m "docs: update README, CHANGELOG, and TODO for handshake feature"
```

---

## Task 10: Run checks

- [ ] **Step 1: Format all files**

```bash
npx prettier --write scaffold/template/server.js scaffold/setup.html scaffold/template/index.html scaffold/template/package.json src/init.js src/configure.js src/launcher.js test/server.test.js test/init.test.js
```

- [ ] **Step 2: Run full check suite**

```bash
npm run check
```

Expected: lint clean, format clean, typecheck clean, all tests pass.

- [ ] **Step 3: Run server tests**

```bash
npm run test:server
```

Expected: all server tests pass.

---

## Verification

1. `devrig init` in fresh dir → scaffold created, AGENTS.md generated, setup.html in .devrig/
2. `devrig start` → browser opens `/devrig/setup`, shows "Waiting for Claude Code..."
3. Inside Claude session, ask Claude to open localhost:3000 → setup page flips to "Connected"
4. Replace index.html with custom content → `/devrig/setup` still works
5. Re-run `devrig init` → AGENTS.md devrig section updated, not duplicated
6. `npm run check` passes
7. `npm run test:server` passes
