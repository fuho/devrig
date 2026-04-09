/**
 * devrig-server.js — Devrig infrastructure server.
 *
 * Runs inside the dev container. Serves devrig dashboard routes and
 * reverse-proxies the mitmproxy rules API so the browser only needs
 * one port.
 *
 * Routes served directly:
 *   GET /devrig/hello_claude  — agent check-in (git info + proxy stats)
 *   GET /devrig/traffic       — traffic control dashboard
 *   GET /devrig/events        — SSE stream for agent connection events
 *   GET /devrig/status        — JSON status endpoint
 *
 * Routes proxied to mitmproxy API (localhost:8082):
 *   /rules, /domains, /traffic, /traffic/recent
 */

import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { hostname } from 'node:os';

const PORT = parseInt(process.env.DEVRIG_PORT || '8083', 10);
const MITMPROXY_API = 'http://localhost:8082';
const ROOT = process.env.DEVRIG_WORKSPACE || '/workspace';
const TRAFFIC_HTML = process.env.DEVRIG_TRAFFIC_HTML || '/static/traffic.html';

const startedAt = new Date();

let agentConnected = false;
let agentHeaders = null;

/** @type {import('node:http').ServerResponse[]} */
const sseClients = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, timeout: 3000 }).toString().trim();
  } catch {
    return null;
  }
}

function parseUA(ua) {
  if (!ua) return { browser: null, os: null };
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const browser = chrome ? `Chrome ${chrome[1].split('.')[0]}` : null;
  let os = null;
  if (ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Linux')) os = 'Linux';
  return { browser, os };
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { /* client gone */ }
  }
}

async function fetchProxyStats() {
  try {
    const ctrl = AbortSignal.timeout(1500);
    const [domRes, trafficRes, rulesRes] = await Promise.all([
      fetch(`${MITMPROXY_API}/domains`, { signal: ctrl }).then(r => r.json()).catch(() => null),
      fetch(`${MITMPROXY_API}/traffic/recent?n=500`, { signal: ctrl }).then(r => r.json()).catch(() => null),
      fetch(`${MITMPROXY_API}/rules`, { signal: ctrl }).then(r => r.json()).catch(() => null),
    ]);
    const domains = domRes ? Object.entries(domRes).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
    const totalRequests = Array.isArray(trafficRes) ? trafficRes.length : 0;
    const blocked = Array.isArray(trafficRes) ? trafficRes.filter(t => t.rule_type === 'block').length : 0;
    const activeRules = Array.isArray(rulesRes) ? rulesRes.filter(r => r.enabled !== false).length : 0;
    return { domains, totalRequests, blocked, activeRules, available: true };
  } catch {
    return { domains: [], totalRequests: 0, blocked: 0, activeRules: 0, available: false };
  }
}

// ---------------------------------------------------------------------------
// Hello Claude page
// ---------------------------------------------------------------------------

async function buildHelloPage(req) {
  const connectMs = Date.now() - startedAt.getTime();
  const connectSec = (connectMs / 1000).toFixed(1);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';

  const project = basename(ROOT);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const lastCommit = git('log', '-1', '--format=%s');
  const lastCommitAge = git('log', '-1', '--format=%ar');
  const commitCount = git('rev-list', '--count', 'HEAD');
  const dirtyRaw = git('status', '--porcelain');
  const dirtyCount = dirtyRaw ? dirtyRaw.split('\n').filter(Boolean).length : 0;
  const dirtyText = dirtyCount === 0 ? 'clean working tree' : `${dirtyCount} uncommitted change${dirtyCount > 1 ? 's' : ''}`;

  const { browser, os } = parseUA(req.headers['user-agent']);
  const host = hostname();
  const proxy = await fetchProxyStats();

  const esc = (s) => s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';

  const line = (label, value, cls) =>
    `<div class="row${cls ? ' ' + cls : ''}"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`;

  const sub = (value) =>
    `<div class="row sub"><span class="label"></span><span class="value dim">${esc(value)}</span></div>`;

  let proxySection = '';
  if (proxy.available) {
    proxySection = `
      <div class="sep"></div>
      ${line('PROXY', `${proxy.totalRequests} request${proxy.totalRequests !== 1 ? 's' : ''} \u00b7 ${proxy.blocked} blocked`)}
      ${proxy.domains.length ? line('DOMAINS', '') : ''}
      ${proxy.domains.map(([d, c]) => sub(`${d} (${c})`)).join('\n')}
      ${line('RULES', `${proxy.activeRules} active`)}`;
  }

  const envLine = [browser, os, `localhost:${PORT}`].filter(Boolean).join(' \u00b7 ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>devrig \u2014 hello</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
    background: #0a0a0a; color: #e0e0e0;
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh; padding: 40px 20px;
  }
  .card { max-width: 520px; width: 100%; }
  .greeting { font-size: 24px; font-weight: 300; color: #e0e0e0; margin-bottom: 16px; }
  .connected { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; font-size: 13px; color: #4ade80; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
  .sep { border-top: 1px solid #2a2a2a; margin: 16px 0; }
  .row { display: flex; gap: 12px; padding: 2px 0; font-size: 13px; line-height: 1.6; }
  .row.sub { padding: 0; }
  .label { width: 90px; flex-shrink: 0; color: #555; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; padding-top: 1px; }
  .value { color: #e0e0e0; }
  .value.dim { color: #888; }
  .env { font-size: 11px; color: #555; margin-top: 4px; }
  .cta { display: inline-block; margin-top: 24px; padding: 8px 20px; font-size: 13px;
    color: #93c5fd; background: #1e3a5f; border: 1px solid #2563eb; border-radius: 4px;
    text-decoration: none; font-family: inherit; }
  .cta:hover { background: #1e40af; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .card > * { animation: fadeIn 0.4s ease both; }
  .card > :nth-child(1) { animation-delay: 0s; }
  .card > :nth-child(2) { animation-delay: 0.15s; }
  .card > :nth-child(3) { animation-delay: 0.3s; }
  .card > :nth-child(n+4) { animation-delay: 0.45s; }
</style>
</head>
<body>
<div class="card">
  <div class="greeting">${esc(greeting)}</div>
  <div class="connected"><span class="dot"></span> Connected in ${esc(connectSec)}s</div>
  <div class="sep"></div>
  ${line('PROJECT', project, '')}
  ${branch ? line('BRANCH', branch, '') : ''}
  ${lastCommit ? line('LATEST', `\u201c${lastCommit}\u201d`, '') : ''}
  ${lastCommitAge ? sub(lastCommitAge) : ''}
  ${line('STATUS', dirtyText, '')}
  ${commitCount ? line('COMMITS', commitCount, '') : ''}
  ${proxySection}
  <div class="sep"></div>
  <div class="env">${esc(envLine)}${host ? ` \u00b7 ${esc(host)}` : ''}</div>
  <div style="text-align:center">
    <a class="cta" href="/devrig/traffic">Open Traffic Control \u2192</a>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Reverse proxy to mitmproxy API
// ---------------------------------------------------------------------------

const PROXY_ROUTES = new Set(['/rules', '/domains', '/traffic', '/traffic/recent']);

function shouldProxy(path) {
  if (PROXY_ROUTES.has(path)) return true;
  // /rules/{id} for PUT/DELETE
  if (path.startsWith('/rules/')) return true;
  return false;
}

function proxyToMitmproxy(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const opts = {
    hostname: 'localhost',
    port: 8082,
    path: url.pathname + url.search,
    method: req.method,
    headers: { ...req.headers, host: 'localhost:8082' },
  };

  const proxyReq = httpRequest(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mitmproxy API unavailable' }));
    }
  });

  req.pipe(proxyReq, { end: true });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // -- Devrig routes (served directly) ------------------------------------

  if (path === '/devrig/traffic') {
    if (existsSync(TRAFFIC_HTML)) {
      const body = readFileSync(TRAFFIC_HTML);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('traffic.html not found');
    }
    return;
  }

  if (path === '/devrig/hello_claude') {
    const hdrs = Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => !['cookie', 'authorization'].includes(k))
    );
    agentHeaders = hdrs;
    agentConnected = true;
    broadcast('agent-connected', { agent: 'claude', headers: hdrs });

    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
      buildHelloPage(req).then((html) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      }).catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, agent: 'claude', startedAt: startedAt.toISOString() }));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: 'claude', startedAt: startedAt.toISOString() }));
    return;
  }

  if (path === '/devrig/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('event: connected\ndata: {}\n\n');
    if (agentConnected) {
      res.write(`event: agent-connected\ndata: ${JSON.stringify({ agent: 'claude', headers: agentHeaders })}\n\n`);
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
    res.end(JSON.stringify({
      agentConnected,
      agentName: 'claude',
      agentHeaders,
      startedAt: startedAt.toISOString(),
      startedAtMs: startedAt.getTime(),
    }));
    return;
  }

  // -- Proxy to mitmproxy API --------------------------------------------

  if (shouldProxy(path)) {
    proxyToMitmproxy(req, res);
    return;
  }

  // -- CORS preflight for proxied routes ----------------------------------

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // -- Fallback -----------------------------------------------------------

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[devrig-server] listening on http://localhost:${PORT}`);
});

// ---------------------------------------------------------------------------
// Hot reload — watch own file and restart on change
// ---------------------------------------------------------------------------

const SELF = new URL(import.meta.url).pathname;
try {
  let debounce = null;
  watch(SELF, () => {
    if (debounce) return;
    debounce = setTimeout(() => {
      console.log('[devrig-server] file changed, restarting...');
      process.exit(0); // supervisor (entrypoint) will respawn
    }, 500);
  });
} catch {
  // watch not supported or file not found — skip hot reload
}
