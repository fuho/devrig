// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BUILD_LABEL = 'devrig.build.hash';

/**
 * Returns an array of strings for a docker compose command.
 */
export function composeCmd(ctx, ...args) {
  return [
    'docker',
    'compose',
    '--project-directory',
    '.',
    '--project-name',
    ctx.project,
    '-f',
    ctx.composeFile,
    ...args,
  ];
}

/**
 * Returns an array of file paths that affect the Docker build.
 */
export function buildFiles(ctx) {
  return [
    `${ctx.devrigDir}/${ctx.dockerfile}`,
    `${ctx.devrigDir}/entrypoint.sh`,
    `${ctx.devrigDir}/container-setup.js`,
    `${ctx.devrigDir}/chrome-mcp-bridge.cjs`,
    ctx.composeFile,
  ];
}

/**
 * Computes SHA-256 of all build files concatenated.
 */
export function buildHash(ctx) {
  const hash = createHash('sha256');
  for (const f of buildFiles(ctx)) {
    hash.update(readFileSync(f));
  }
  return hash.digest('hex');
}

/**
 * Compares buildHash against the label baked into the Docker image.
 * Returns true if the image needs to be rebuilt.
 */
export function needsRebuild(ctx) {
  let imageHash;
  try {
    const result = execFileSync(
      'docker',
      ['inspect', ctx.image, '--format', `{{index .Config.Labels "${BUILD_LABEL}"}}`],
      { encoding: 'utf-8' },
    );
    imageHash = result.trim();
  } catch {
    imageHash = 'none';
  }
  return buildHash(ctx) !== imageHash;
}

/**
 * Starts the container using docker compose up -d.
 */
export function startContainer(ctx) {
  const cmd = composeCmd(ctx, 'up', '-d', ctx.service);
  execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
}

/**
 * Returns a ctx-like object for Docker operations.
 */
export function initVariant(cfg) {
  const project = cfg.project;
  const devrigDir = '.devrig';

  return {
    project,
    composeFile: `${devrigDir}/compose.yml`,
    service: 'dev',
    image: `${project}-dev:latest`,
    dockerfile: 'Dockerfile',
    devrigDir,
  };
}
