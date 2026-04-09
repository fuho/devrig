// @ts-check
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function ask(rl, prompt, defaultVal) {
  const suffix = defaultVal ? ` [${defaultVal}]: ` : ': ';
  const answer = (await rl.question(`  ${prompt}${suffix}`)).trim();
  return answer || defaultVal || '';
}

async function askYN(rl, prompt, defaultVal = true) {
  const hint = defaultVal ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`  ${prompt} [${hint}]: `)).trim().toLowerCase();
  if (!answer) return defaultVal;
  return answer === 'y' || answer === 'yes';
}

function parsePort(value, fallback) {
  const n = parseInt(value, 10);
  if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  if (value && value !== String(fallback)) {
    console.warn(`[devrig] Invalid port '${value}' — using ${fallback}`);
  }
  return fallback;
}

function gitConfig(key) {
  try {
    return execFileSync('git', ['config', '--global', key], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Interactive configuration wizard. Generates devrig.toml and .env from user input. */
export async function configure(projectDir) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let finished = false;
  rl.on('close', () => {
    if (!finished) {
      console.log('\nAborted.');
      process.exit(1);
    }
  });

  const tomlPath = join(projectDir, 'devrig.toml');
  if (existsSync(tomlPath)) {
    const overwrite = await askYN(rl, 'devrig.toml already exists. Overwrite?', false);
    if (!overwrite) {
      finished = true;
      rl.close();
      return;
    }
  }

  console.log('\n  devrig \u2014 Configuration');
  console.log(
    '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n',
  );

  let project = await ask(rl, 'Project name', basename(projectDir));
  project = project
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!project) project = 'my-project';

  // Environment selection
  console.log('\n  shared = Claude auth & memories in ~/.devrig/shared/ (reused across projects)');
  console.log('  local  = everything isolated in this project\'s .devrig/\n');
  const useShared = await askYN(rl, 'Use shared environment?');
  const environment = useShared ? 'shared' : 'local';

  // Dev server
  const useDevServer = await askYN(rl, 'Run a dev server alongside the container?');
  let devCommand = '',
    devPort = 0,
    devTimeout = 0;
  if (useDevServer) {
    devCommand = await ask(rl, 'Dev server command', 'node server.js');
    devPort = parsePort(await ask(rl, 'Dev server port', '3000'), 3000);
    devTimeout = parseInt(await ask(rl, 'Startup timeout (s)', '10'), 10) || 10;
  }

  // Chrome bridge
  const useChrome = await askYN(rl, 'Enable Chrome browser bridge?');
  let chromePort = 0;
  if (useChrome) {
    chromePort = parsePort(await ask(rl, 'Chrome debug port', '9229'), 9229);
  }

  // Devrig dashboard port
  const devrigPort = parsePort(await ask(rl, 'Devrig dashboard port', '8083'), 8083);

  // Git info
  const gitName = await ask(rl, 'Git author name', gitConfig('user.name'));
  const gitEmail = await ask(rl, 'Git author email', gitConfig('user.email'));

  // Starter files — only offer when dev server is enabled and no existing files
  const needsTemplate = useDevServer &&
    !existsSync(join(projectDir, 'server.js')) && !existsSync(join(projectDir, 'index.html'));
  const copyTemplate = needsTemplate
    ? await askYN(rl, 'Copy devrig starter server.js + index.html?')
    : false;

  // ---------------------------------------------------------------------------
  // Summary — show what will be written and confirm
  // ---------------------------------------------------------------------------

  console.log('\n  Summary');
  console.log('  ───────\n');
  console.log(`    project        ${project}`);
  console.log(`    environment    ${environment}${environment === 'shared' ? ' (~/.devrig/shared/)' : ' (.devrig/)'}`);
  if (useDevServer) {
    console.log(`    dev server     ${devCommand} on port ${devPort}`);
  } else {
    console.log('    dev server     none');
  }
  if (useChrome) {
    console.log(`    chrome bridge  port ${chromePort}`);
  } else {
    console.log('    chrome bridge  disabled');
  }
  console.log(`    dashboard      port ${devrigPort}`);
  console.log(`    git author     ${gitName} <${gitEmail}>`);
  if (copyTemplate) {
    console.log('    template       server.js + index.html');
  }
  console.log('');
  console.log('  Will write:');
  console.log(`    ${tomlPath}`);
  console.log(`    ${join(projectDir, '.env')}`);
  if (copyTemplate) {
    console.log(`    ${join(projectDir, 'server.js')}`);
    console.log(`    ${join(projectDir, 'index.html')}`);
  }
  console.log('');

  const proceed = await askYN(rl, 'Write these files?');
  if (!proceed) {
    console.log('  Aborted.');
    finished = true;
    rl.close();
    return;
  }

  // ---------------------------------------------------------------------------
  // Write files
  // ---------------------------------------------------------------------------

  // Build TOML
  let toml = `# devrig \u2014 ${project}\n# Generated by: devrig config\n\n`;
  toml += `project = "${project}"\n`;
  toml += `environment = "${environment}"\n\n`;

  if (useDevServer) {
    toml += `[dev_server]\ncommand = "${devCommand}"\nport = ${devPort}\n`;
    if (devTimeout !== 10) toml += `ready_timeout = ${devTimeout}\n`;
    toml += '\n';
  } else {
    toml += `# [dev_server]\n# command = "node server.js"\n# port = 3000\n\n`;
  }

  if (useChrome) {
    toml += `[chrome_bridge]\nport = ${chromePort}\n\n`;
  } else {
    toml += `# [chrome_bridge]\n# port = 9229\n\n`;
  }

  toml += `[devrig]\nport = ${devrigPort}\n\n`;
  toml += `# [claude]\n# version = "latest"\n`;

  writeFileSync(tomlPath, toml);
  console.log(`\n  Wrote ${tomlPath}`);

  // .env
  const ENV_START = '# devrig:start';
  const ENV_END = '# devrig:end';
  const block = [
    ENV_START,
    'CLAUDE_PARAMS=--dangerously-skip-permissions',
    `GIT_AUTHOR_NAME=${gitName}`,
    `GIT_AUTHOR_EMAIL=${gitEmail}`,
    ENV_END,
  ].join('\n');

  const envPath = join(projectDir, '.env');
  if (existsSync(envPath)) {
    let content = readFileSync(envPath, 'utf8');
    // Remove old sentinel-based block
    const startIdx = content.indexOf(ENV_START);
    const endIdx = content.indexOf(ENV_END);
    if (startIdx !== -1 && endIdx !== -1) {
      content = (content.slice(0, startIdx) + content.slice(endIdx + ENV_END.length)).trim();
    }
    // Also strip legacy marker blocks (pre-sentinel format)
    content = content.replace(/# Added by devrig config\n(?:[A-Z_]+=.*\n)*/g, '').trim();
    writeFileSync(envPath, (content ? content + '\n\n' : '') + block + '\n');
  } else {
    writeFileSync(envPath, block + '\n');
  }
  console.log(`  Wrote ${envPath}`);

  // Starter files
  if (copyTemplate) {
    const tplDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold', 'template');
    for (const f of ['index.html', 'server.js']) {
      const src = join(tplDir, f);
      if (existsSync(src)) {
        copyFileSync(src, join(projectDir, f));
        console.log(`  Copied ${f}`);
      }
    }
  }

  finished = true;
  rl.close();
}
