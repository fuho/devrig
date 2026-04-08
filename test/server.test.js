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
    if (tmp) rmSync(tmp, { recursive: true, force: true });
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

  it('marks agent as connected after GET /?agent=test', async () => {
    // Trigger agent detection with ?agent= query param
    await fetch(`http://localhost:${PORT}/?agent=test`);
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
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('event: connected'), 'should include connected event');
    // Agent was marked connected by the previous test, so the catch-up
    // agent-connected event should appear in the initial response
    assert.ok(
      text.includes('event: agent-connected'),
      'should include agent-connected catch-up event',
    );
  });
});
