#!/usr/bin/env node

import { launch } from '../src/launcher.js';
import { configure } from '../src/configure.js';
import { init } from '../src/init.js';
import { resolveProjectDir } from '../src/config.js';

const command = process.argv[2];
const rest = process.argv.slice(3);

function printUsage() {
  console.log(`Usage: devrig <command> [flags]

Commands:
  init      Initialize devrig in the current directory
  start     Start a coding session (alias: claude)
  config    Re-run the configuration wizard

Flags for start:
  --rebuild        Force rebuild the Docker image
  --no-chrome      Skip Chrome bridge and browser
  --no-dev-server  Skip the dev server
  --npm            Use npm Claude Code installer instead of native

Run devrig <command> --help for more info.`);
}

switch (command) {
  case 'init':
    await init(process.cwd());
    break;
  case 'start':
  case 'claude':
    await launch(rest);
    break;
  case 'config': {
    const projectDir = resolveProjectDir();
    await configure(projectDir);
    break;
  }
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    printUsage();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(1);
}
