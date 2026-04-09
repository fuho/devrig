import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { hostname } from 'node:os';

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = process.cwd();
const DEVRIG_DIR = join(ROOT, '.devrig');
const startedAt = new Date();
const startedAtISO = startedAt.toISOString();

let agentConnected = false;
let agentHeaders = null;
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

function git(...args) {
  try { return execFileSync('git', args, { cwd: ROOT, timeout: 3000 }).toString().trim(); }
  catch { return null; }
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

async function fetchProxyStats() {
  try {
    const ctrl = AbortSignal.timeout(1500);
    const [domRes, trafficRes, rulesRes] = await Promise.all([
      fetch('http://localhost:8082/domains', { signal: ctrl }).then(r => r.json()).catch(() => null),
      fetch('http://localhost:8082/traffic/recent?n=500', { signal: ctrl }).then(r => r.json()).catch(() => null),
      fetch('http://localhost:8082/rules', { signal: ctrl }).then(r => r.json()).catch(() => null),
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
<title>devrig — hello</title>
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
  .value.green { color: #4ade80; }
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
  ${line('STATUS', dirtyText, dirtyCount > 0 ? '' : '')}
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

  if (path === '/devrig/traffic') {
    serveFile(res, join(DEVRIG_DIR, 'traffic.html'));
    return;
  }

  if (path === '/devrig/hello_claude') {
    const hdrs = Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => !['cookie', 'authorization'].includes(k))
    );
    agentHeaders = hdrs;
    if (!agentConnected) {
      agentConnected = true;
    }
    broadcast('agent-connected', { agent: req.headers['x-devrig-agent'] || agentName, headers: hdrs });

    // Serve HTML for browsers, JSON for curl/fetch
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
      buildHelloPage(req).then((html) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      }).catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, agent: agentName, startedAt: startedAtISO }));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: agentName, startedAt: startedAtISO }));
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
      res.write(`event: agent-connected\ndata: ${JSON.stringify({ agent: agentName, headers: agentHeaders })}\n\n`);
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
    res.end(JSON.stringify({ agentConnected, agentName, agentHeaders, startedAt: startedAtISO, startedAtMs: startedAt.getTime() }));
    return;
  }

  // Legacy agent detection: ?agent= query param on index page (kept for backward compat)
  if (req.method === 'GET' && (path === '/' || path === '/index.html') && url.searchParams.has('agent')) {
    if (!agentConnected) {
      agentConnected = true;
      broadcast('agent-connected', { agent: url.searchParams.get('agent') || agentName });
    }
  }

  const filePath = join(ROOT, path === '/' ? 'index.html' : path);
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`devrig server listening on http://localhost:${PORT}`);
});
