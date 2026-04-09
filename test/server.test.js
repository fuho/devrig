import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templateDir = join(__dirname, '..', 'scaffold', 'template');

describe('template server', () => {
  let tmp;
  let proc;
  const PORT = 19876;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-srv-'));
    cpSync(join(templateDir, 'server.js'), join(tmp, 'server.js'));
    cpSync(join(templateDir, 'index.html'), join(tmp, 'index.html'));

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

  it('returns 404 for missing files', async () => {
    const res = await fetch(`http://localhost:${PORT}/nonexistent.html`);
    assert.equal(res.status, 404);
  });
});
