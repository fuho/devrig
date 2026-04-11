import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run configure() in a subprocess, feeding answers one at a time
 * after each prompt appears on stdout.
 * configure.js has an rl.on('close') handler that calls process.exit(1),
 * which fires when rl.close() is called at the end of a successful run,
 * so we ignore the exit code and verify output files instead.
 */
function runConfigure(tmpDir, answers) {
  return new Promise((resolve, reject) => {
    const script = join(__dirname, '..', 'src', 'configure.js').replaceAll('\\', '/');
    const escapedDir = tmpDir.replaceAll('\\', '/').replaceAll("'", "\\'");
    const wrapper = `import { configure } from '${script}'; await configure('${escapedDir}');`;

    const child = spawn('node', ['--input-type=module', '-e', wrapper], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let idx = 0;
    let promptCount = 0;

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      // Count prompts (lines ending with ]: or : ) and send answers
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
      reject(new Error(`configure timed out. stdout: ${stdout}, stderr: ${stderr}`));
    }, 10000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('configure', () => {
  it('generates devrig.toml and .env from piped input', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      // Answers: project, shared env Y/N, devrig port, git name, git email, confirm Y
      const answers = ['test-project', '', '', 'Test User', 'test@example.com', 'y'];

      await runConfigure(tmpDir, answers);

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('project = "test-project"'));
      assert.ok(toml.includes('environment = "shared"'));
      assert.ok(toml.includes('[chrome_bridge]'), 'chrome bridge always enabled');
      assert.ok(toml.includes('[devrig]'));
      assert.ok(toml.includes('# [dev_server]'), 'dev server commented out');

      const env = readFileSync(join(tmpDir, '.env'), 'utf8');
      assert.ok(env.includes('GIT_AUTHOR_NAME=Test User'));
      assert.ok(env.includes('GIT_AUTHOR_EMAIL=test@example.com'));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updates existing .env without duplicating managed block', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      const existingEnv = [
        'EXISTING_VAR=hello',
        '# devrig:start',
        'CLAUDE_PARAMS=--dangerously-skip-permissions',
        'GIT_AUTHOR_NAME=Old',
        'GIT_AUTHOR_EMAIL=old@old.com',
        '# devrig:end',
        '',
      ].join('\n');
      writeFileSync(join(tmpDir, '.env'), existingEnv);

      // Answers: project, shared env Y/N, devrig port, git name, git email, confirm Y
      const answers = ['updated-proj', '', '', 'New User', 'new@example.com', 'y'];

      await runConfigure(tmpDir, answers);

      const env = readFileSync(join(tmpDir, '.env'), 'utf8');
      assert.ok(env.includes('EXISTING_VAR=hello'));
      assert.ok(env.includes('GIT_AUTHOR_NAME=New User'));
      assert.ok(!env.includes('GIT_AUTHOR_NAME=Old'));
      assert.equal((env.match(/# devrig:start/g) || []).length, 1, 'one start sentinel');
      assert.equal((env.match(/# devrig:end/g) || []).length, 1, 'one end sentinel');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sanitizes project name', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      // Answers: bad project name, shared env, devrig port, git name, email, confirm Y
      const answers = ['My Cool Project!', '', '', 'Test User', 'test@example.com', 'y'];

      await runConfigure(tmpDir, answers);

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('project = "my-cool-project"'), 'project name sanitized');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts custom devrig port', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      const answers = ['test-proj', '', '9090', 'Test User', 'test@example.com', 'y'];

      await runConfigure(tmpDir, answers);

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('port = 9090'), 'custom devrig port in toml');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects Vite and writes live [dev_server] block', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'vite-app',
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^5.0.0' },
        }),
      );

      // Answers: project, shared env, ENABLE detected dev server, devrig port, git name, git email, confirm
      const answers = ['vite-proj', '', 'y', '', 'Test User', 'test@example.com', 'y'];

      const { stdout } = await runConfigure(tmpDir, answers);
      assert.ok(stdout.includes('Found Vite'), 'detection banner shown');

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(/^\[dev_server\]$/m.test(toml), '[dev_server] section uncommented');
      assert.ok(toml.includes('command = "npm run dev"'));
      assert.ok(toml.includes('port = 5173'), 'Vite default port');
      assert.ok(!toml.includes('# [dev_server]'), 'no commented stub');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects Angular (regression guard for grouped regex)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'ng-app',
          scripts: { dev: 'ng serve', build: 'ng build' },
          dependencies: { '@angular/core': '^17.0.0' },
        }),
      );

      const answers = ['ng-proj', '', 'y', '', 'Test User', 'test@example.com', 'y'];

      const { stdout } = await runConfigure(tmpDir, answers);
      assert.ok(stdout.includes('Found Angular'), 'Angular detected');

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('port = 4200'), 'Angular default port');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects Django from manage.py', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      writeFileSync(join(tmpDir, 'manage.py'), '');

      const answers = ['dj-proj', '', 'y', '', 'Test User', 'test@example.com', 'y'];

      const { stdout } = await runConfigure(tmpDir, answers);
      assert.ok(stdout.includes('Found Django'), 'Django detected');

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('command = "python manage.py runserver 0:8000"'));
      assert.ok(toml.includes('port = 8000'));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps commented stub when user declines detection', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^5.0.0' },
        }),
      );

      // Same shape but user answers 'n' to detection
      const answers = ['vite-proj', '', 'n', '', 'Test User', 'test@example.com', 'y'];

      await runConfigure(tmpDir, answers);

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('# [dev_server]'), 'stub stays commented');
      assert.ok(!/^\[dev_server\]$/m.test(toml), 'no live section');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips Node detection when package.json is malformed', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      writeFileSync(join(tmpDir, 'package.json'), '{not valid json');

      // No detection prompt should appear — same answers as the baseline test
      const answers = ['bad-pkg', '', '', 'Test User', 'test@example.com', 'y'];

      const { stdout } = await runConfigure(tmpDir, answers);
      assert.ok(!stdout.includes('Found '), 'no detection banner');
      assert.ok(!stdout.includes('Enable it?'), 'no detection prompt');

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('# [dev_server]'), 'falls back to commented stub');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
