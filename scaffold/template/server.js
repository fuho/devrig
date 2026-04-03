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

  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    if (!agentConnected) {
      agentConnected = true;
      broadcast('agent-connected', { agent: agentName });
    }
  }

  const filePath = join(ROOT, path === '/' ? 'index.html' : path);
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`devrig server listening on http://localhost:${PORT}`);
});
