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
      const answers = [
        'test-project',
        '',
        '',
        'Test User',
        'test@example.com',
        'y',
      ];

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
      const answers = [
        'My Cool Project!',
        '',
        '',
        'Test User',
        'test@example.com',
        'y',
      ];

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
      const answers = [
        'test-proj',
        '',
        '9090',
        'Test User',
        'test@example.com',
        'y',
      ];

      await runConfigure(tmpDir, answers);

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('port = 9090'), 'custom devrig port in toml');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
