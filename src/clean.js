// @ts-check
/**
 * clean.js — Remove Docker artifacts for the current project or all devrig projects.
 */

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { log, verbose } from './log.js';
import { loadConfig, resolveProjectDir } from './config.js';
import { initVariant } from './docker.js';
import { readSession, isSessionAlive } from './session.js';

const LABEL = 'devrig.project';

/**
 * Queries Docker for resources with the devrig.project label.
 * @param {string} [project] - Filter to a specific project name. Omit for all.
 * @returns {{ type: string, name: string, detail: string }[]}
 */
function discoverByLabel(project) {
  const filter = project ? `label=${LABEL}=${project}` : `label=${LABEL}`;
  verbose('discovering resources' + (project ? ` for "${project}"` : ' (all)'));
  const found = [];

  // Containers (including stopped)
  try {
    const out = execFileSync(
      'docker',
      ['ps', '-a', '--filter', filter, '--format', '{{.Names}}\t{{.Status}}'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const line of out.split('\n').filter(Boolean)) {
      const [name, ...status] = line.split('\t');
      found.push({ type: 'Container', name, detail: status.join('\t') });
    }
  } catch {
    /* ignore */
  }

  // Images
  try {
    const out = execFileSync(
      'docker',
      ['images', '--filter', filter, '--format', '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const line of out.split('\n').filter(Boolean)) {
      const [tag, id, size] = line.split('\t');
      // Use image ID for dangling images (<none>:<none>), tag otherwise
      const name = tag === '<none>:<none>' ? id : tag;
      found.push({ type: 'Image', name, detail: size || '' });
    }
  } catch {
    /* ignore */
  }

  // Volumes
  try {
    const out = execFileSync(
      'docker',
      ['volume', 'ls', '--filter', filter, '--format', '{{.Name}}'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const v of out.split('\n').filter(Boolean)) {
      found.push({ type: 'Volume', name: v, detail: '' });
    }
  } catch {
    /* ignore */
  }

  // Networks
  try {
    const out = execFileSync(
      'docker',
      ['network', 'ls', '--filter', filter, '--format', '{{.Name}}', '--no-trunc'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const n of out.split('\n').filter(Boolean)) {
      found.push({ type: 'Network', name: n, detail: '' });
    }
  } catch {
    /* ignore */
  }

  return found;
}

/**
 * Removes a list of discovered Docker resources.
 * @param {{ type: string, name: string }[]} items
 */
function removeResources(items) {
  for (const item of items) {
    try {
      switch (item.type) {
        case 'Container':
          execFileSync('docker', ['rm', '-f', item.name], { stdio: 'ignore' });
          break;
        case 'Image':
          execFileSync('docker', ['rmi', '-f', item.name], { stdio: 'ignore' });
          break;
        case 'Volume':
          execFileSync('docker', ['volume', 'rm', '-f', item.name], { stdio: 'ignore' });
          break;
        case 'Network':
          execFileSync('docker', ['network', 'rm', item.name], { stdio: 'ignore' });
          break;
      }
    } catch {
      /* ignore — resource may already be gone */
    }
  }
}

/**
 * Lists all distinct devrig project names from Docker labels.
 * @returns {string[]}
 */
function listProjects() {
  const projects = new Set();
  // Query containers for label values
  try {
    const out = execFileSync(
      'docker',
      ['ps', '-a', '--filter', `label=${LABEL}`, '--format', `{{index .Labels "${LABEL}"}}`],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const p of out.split('\n').filter(Boolean)) projects.add(p);
  } catch {
    /* ignore */
  }
  // Query volumes
  try {
    const out = execFileSync(
      'docker',
      ['volume', 'ls', '--filter', `label=${LABEL}`, '--format', `{{index .Labels "${LABEL}"}}`],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const p of out.split('\n').filter(Boolean)) projects.add(p);
  } catch {
    /* ignore */
  }
  // Query images
  try {
    const out = execFileSync(
      'docker',
      ['images', '--filter', `label=${LABEL}`, '--format', `{{index .Labels "${LABEL}"}}`],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const p of out.split('\n').filter(Boolean)) projects.add(p);
  } catch {
    /* ignore */
  }
  return [...projects].sort();
}

/**
 * Finds and kills orphaned devrig processes (PPID 1).
 */
function killOrphans() {
  try {
    const out = execFileSync('sh', ['-c', 'ps ax -o pid,ppid,command'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let killed = 0;
    for (const line of out.split('\n')) {
      if (line.includes('bridge-host.cjs') || line.includes('container-setup.js')) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0], 10);
        const ppid = parts[1];
        if (ppid === '1' && pid !== process.pid) {
          try {
            process.kill(pid, 'SIGTERM');
            log(`Killed orphaned process PID ${pid}`);
            killed++;
          } catch {
            /* already dead */
          }
        }
      }
    }
    if (killed === 0) log('No orphaned devrig processes found.');
  } catch {
    log('Could not check for orphaned processes.');
  }
}

/**
 * Discovers and removes Docker artifacts.
 * Supports -a/--all, --project <name>, -l/--list, --orphans, -y/--yes.
 * @param {string[]} argv
 */
export async function clean(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      yes:     { type: 'boolean', short: 'y', default: false },
      all:     { type: 'boolean', short: 'a', default: false },
      list:    { type: 'boolean', short: 'l', default: false },
      orphans: { type: 'boolean', default: false },
      project: { type: 'string' },
    },
    strict: true,
  });
  const skipConfirm = values.yes;
  const cleanAll = values.all;
  const listOnly = values.list;
  const orphansOnly = values.orphans;

  // --orphans: kill orphaned devrig processes
  if (orphansOnly) {
    killOrphans();
    return;
  }

  // --list: show all known devrig projects
  if (listOnly) {
    const projects = listProjects();
    if (projects.length === 0) {
      log('No devrig projects found.');
    } else {
      log(`Found ${projects.length} devrig project(s):`);
      for (const p of projects) console.log(`  ${p}`);
    }
    return;
  }

  // --project <name>: target a specific project by name
  const explicitProject = values.project ?? null;

  let found;
  let label;

  if (cleanAll) {
    // Find ALL devrig resources across all projects
    found = discoverByLabel();
    label = 'all devrig projects';
  } else if (explicitProject) {
    // Find resources for a named project (no need to be in its directory)
    found = discoverByLabel(explicitProject);
    label = `"${explicitProject}"`;
  } else {
    // Find resources for the current project
    const projectDir = resolveProjectDir();
    const cfg = loadConfig(projectDir);

    const session = readSession(projectDir);
    if (session && isSessionAlive(session)) {
      log(`A session is running (PID ${session.pid}). Stop it first with "devrig stop".`);
      process.exit(1);
    }

    // Try label-based discovery first, fall back to compose-based
    found = discoverByLabel(cfg.project);

    // Also check by image name for pre-label resources
    const ctx = initVariant(cfg);
    const imageNames = new Set(found.map((f) => f.name));
    if (!imageNames.has(ctx.image)) {
      try {
        const info = execFileSync(
          'docker',
          ['image', 'inspect', ctx.image, '--format', '{{.Size}}'],
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
        ).trim();
        const sizeMB = (parseInt(info, 10) / 1024 / 1024).toFixed(0);
        found.push({ type: 'Image', name: ctx.image, detail: `${sizeMB} MB` });
      } catch {
        /* doesn't exist */
      }
    }

    label = `"${cfg.project}"`;
  }

  if (found.length === 0) {
    log(`No Docker resources found for ${label}.`);
    return;
  }

  log(`Found ${found.length} Docker resource(s) for ${label}:`);
  console.log('');
  for (const item of found) {
    const detail = item.detail ? ` (${item.detail})` : '';
    console.log(`  ${item.type.padEnd(10)} ${item.name}${detail}`);
  }
  console.log('');

  if (!skipConfirm) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('  Remove all of the above? [y/N]: ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Cancelled.');
      return;
    }
  }

  removeResources(found);
  if (cleanAll) killOrphans();
  log('Cleaned up.');
}
