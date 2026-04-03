// @ts-check
/**
 * clean.js — Remove Docker artifacts for the current project.
 */

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { log } from './log.js';
import { loadConfig, resolveProjectDir } from './config.js';
import { composeCmd, initVariant } from './docker.js';
import { readSession, isSessionAlive } from './session.js';

/** Discovers and removes Docker images, volumes, and networks for this project. */
export async function clean(argv) {
  const projectDir = resolveProjectDir();
  const cfg = loadConfig(projectDir);
  const skipConfirm = argv.includes('-y') || argv.includes('--yes');

  // Check for running session
  const session = readSession(projectDir);
  if (session && isSessionAlive(session)) {
    log(`A session is running (PID ${session.pid}). Stop it first with "devrig stop".`);
    process.exit(1);
  }

  const ctx = initVariant(cfg, 'native');
  const ctxNpm = initVariant(cfg, 'npm');

  // Discover artifacts
  const found = [];

  // Images
  for (const image of [ctx.image, ctxNpm.image]) {
    try {
      const info = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Size}}'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      const sizeMB = (parseInt(info, 10) / 1024 / 1024).toFixed(0);
      found.push({ type: 'Image', name: image, detail: `${sizeMB} MB` });
    } catch {
      /* image doesn't exist */
    }
  }

  // Volumes
  try {
    const volumes = execFileSync(
      'docker',
      ['volume', 'ls', '--filter', `name=${cfg.project}`, '--format', '{{.Name}}'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const v of volumes.split('\n').filter(Boolean)) {
      found.push({ type: 'Volume', name: v, detail: '' });
    }
  } catch {
    /* ignore */
  }

  // Networks
  try {
    const networks = execFileSync(
      'docker',
      ['network', 'ls', '--filter', `name=${cfg.project}`, '--format', '{{.Name}}', '--no-trunc'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const n of networks.split('\n').filter(Boolean)) {
      if (n !== 'bridge' && n !== 'host' && n !== 'none') {
        found.push({ type: 'Network', name: n, detail: '' });
      }
    }
  } catch {
    /* ignore */
  }

  if (found.length === 0) {
    log(`No Docker resources found for "${cfg.project}".`);
    return;
  }

  // Print what was found
  log(`Found ${found.length} Docker resource(s) for "${cfg.project}":`);
  console.log('');
  for (const item of found) {
    const detail = item.detail ? ` (${item.detail})` : '';
    console.log(`  ${item.type.padEnd(8)} ${item.name}${detail}`);
  }
  console.log('');

  // Confirm
  if (!skipConfirm) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('  Remove all of the above? [y/N]: ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Cancelled.');
      return;
    }
  }

  // Remove via compose down (handles containers, volumes, networks, images)
  for (const variant of [ctx, ctxNpm]) {
    try {
      const cmd = composeCmd(variant, 'down', '-v', '--rmi', 'local');
      execFileSync(cmd[0], cmd.slice(1), { stdio: 'ignore', timeout: 30000 });
    } catch {
      /* ignore — variant may not have been used */
    }
  }

  // Remove any remaining images directly (in case compose didn't catch them)
  for (const image of [ctx.image, ctxNpm.image]) {
    try {
      execFileSync('docker', ['rmi', image], { stdio: 'ignore' });
    } catch {
      /* already removed or doesn't exist */
    }
  }

  log('Cleaned up.');
}
