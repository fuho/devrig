import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'devrig.js');

/**
 * Run `devrig init` in a subprocess, feeding answers one at a time
 * after each prompt appears on stdout.
 */
function runInit(cwd, answers) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, 'init'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: cwd },
    });

    let stdout = '';
    let stderr = '';
    let idx = 0;
    let promptCount = 0;

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      const newPrompts = (stdout.match(/: /g) || []).length;
      while (promptCount < newPrompts && idx < answers.length) {
        child.stdin.write(answers[idx++] + '\n');
        promptCount++;
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`init timed out.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 15000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('e2e: devrig init', () => {
  it('scaffolds a project and generates config', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-e2e-'));

    try {
      // Answers in order:
      //   project name, tool, dev server Y, command, port, timeout,
      //   chrome Y, port, git name, git email, copy template Y
      const answers = [
        'e2e-test',
        'claude',
        'y',
        'npm run dev',
        '3000',
        '10',
        'y',
        '9229',
        'E2E Tester',
        'e2e@test.com',
        'y',
      ];

      await runInit(tmpDir, answers);

      // Verify scaffold files
      assert.ok(existsSync(join(tmpDir, '.devrig', 'Dockerfile')), 'Dockerfile exists');
      assert.ok(existsSync(join(tmpDir, '.devrig', 'Dockerfile.npm')), 'Dockerfile.npm exists');
      assert.ok(existsSync(join(tmpDir, '.devrig', 'compose.yml')), 'compose.yml exists');
      assert.ok(existsSync(join(tmpDir, '.devrig', 'compose.npm.yml')), 'compose.npm.yml exists');
      assert.ok(existsSync(join(tmpDir, '.devrig', 'entrypoint.sh')), 'entrypoint.sh exists');
      assert.ok(
        existsSync(join(tmpDir, '.devrig', 'container-setup.js')),
        'container-setup.js exists',
      );

      // Verify version marker
      assert.ok(existsSync(join(tmpDir, '.devrig', '.devrig-version')), 'version marker exists');

      // Verify devrig.toml generated
      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('project = "e2e-test"'), 'project name in toml');
      assert.ok(toml.includes('tool = "claude"'), 'tool in toml');
      assert.ok(toml.includes('[dev_server]'), 'dev_server section in toml');
      assert.ok(toml.includes('port = 3000'), 'port in toml');
      assert.ok(toml.includes('[chrome_bridge]'), 'chrome_bridge section in toml');

      // Verify .env generated
      const env = readFileSync(join(tmpDir, '.env'), 'utf8');
      assert.ok(env.includes('GIT_AUTHOR_NAME=E2E Tester'), 'git name in env');
      assert.ok(env.includes('GIT_AUTHOR_EMAIL=e2e@test.com'), 'git email in env');

      // Verify .gitignore updated
      const gitignore = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
      assert.ok(gitignore.includes('.devrig/logs/'), 'logs in gitignore');
      assert.ok(gitignore.includes('.devrig/home/'), 'home in gitignore');

      // Verify template files copied (we said yes)
      assert.ok(existsSync(join(tmpDir, 'package.json')), 'template package.json copied');
      assert.ok(existsSync(join(tmpDir, 'index.html')), 'template index.html copied');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('devrig help exits cleanly', () => {
    const result = execFileSync('node', [CLI, 'help'], { encoding: 'utf8' });
    assert.ok(result.includes('Usage: devrig'));
    assert.ok(result.includes('init'));
    assert.ok(result.includes('start'));
    assert.ok(result.includes('config'));
  });
});
