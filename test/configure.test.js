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
      // Answers in order:
      //   project name, environment, dev server Y, command, port, timeout,
      //   chrome Y, port, git name, git email, copy template N
      const answers = [
        'test-project',
        '',
        'y',
        'npm run dev',
        '3000',
        '10',
        'y',
        '9229',
        'Test User',
        'test@example.com',
        'n',
      ];

      await runConfigure(tmpDir, answers);

      // Verify devrig.toml was written
      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      assert.ok(toml.includes('project = "test-project"'));
      assert.ok(!toml.includes('tool ='));  // tool question removed, hardcoded to claude
      assert.ok(toml.includes('[dev_server]'));
      assert.ok(toml.includes('[chrome_bridge]'));

      // Verify .env was written
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
      // Write existing .env with a sentinel-based managed block
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

      // Answers: project name, environment, dev server N, chrome N, git name, git email, copy template N
      const answers = ['updated-proj', '', 'n', 'n', 'New User', 'new@example.com', 'n'];

      await runConfigure(tmpDir, answers);

      const env = readFileSync(join(tmpDir, '.env'), 'utf8');
      assert.ok(env.includes('EXISTING_VAR=hello'));
      assert.ok(env.includes('GIT_AUTHOR_NAME=New User'));
      // Should NOT contain old values
      assert.ok(!env.includes('GIT_AUTHOR_NAME=Old'));
      // Should have exactly one start and one end sentinel
      assert.equal((env.match(/# devrig:start/g) || []).length, 1, 'one start sentinel');
      assert.equal((env.match(/# devrig:end/g) || []).length, 1, 'one end sentinel');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('warns when port falls back to default', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      // Feed invalid port "banana" for dev server
      const answers = [
        'test-project',
        '',
        'y',
        'npm run dev',
        'banana',
        '10',
        'y',
        '9229',
        'Test User',
        'test@example.com',
        'n',
      ];

      const { stderr } = await runConfigure(tmpDir, answers);
      assert.ok(
        stderr.includes('Invalid port') || stderr.includes('invalid port'),
        'should warn about invalid port in stderr',
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sanitizes project name and validates ports', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devrig-cfg-'));

    try {
      // Feed bad project name (uppercase, spaces) and invalid port
      const answers = [
        'My Cool Project!',
        '',
        'y',
        'npm run dev',
        'not-a-number',
        '10',
        'y',
        '99999',
        'Test User',
        'test@example.com',
        'n',
      ];

      await runConfigure(tmpDir, answers);

      const toml = readFileSync(join(tmpDir, 'devrig.toml'), 'utf8');
      // Project name should be sanitized to lowercase with hyphens
      assert.ok(toml.includes('project = "my-cool-project"'), 'project name sanitized');
      // Invalid port should fall back to default 3000
      assert.ok(toml.includes('port = 3000'), 'invalid dev port falls back to 3000');
      // Port 99999 is out of range, should fall back to 9229
      assert.ok(toml.includes('port = 9229'), 'out-of-range chrome port falls back to 9229');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
