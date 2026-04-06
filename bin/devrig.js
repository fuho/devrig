#!/usr/bin/env node
// @ts-check

import { launch } from '../src/launcher.js';
import { configure } from '../src/configure.js';
import { init } from '../src/init.js';
import { clean } from '../src/clean.js';
import { resolveProjectDir } from '../src/config.js';
import { stopSession, showStatus } from '../src/session.js';

const command = process.argv[2];
const rest = process.argv.slice(3);
const wantsHelp = rest.includes('--help') || rest.includes('-h');

const subcommandHelp = {
  init: `Scaffold a .devrig/ directory and run the interactive configuration wizard.

Creates:
  .devrig/           Docker infrastructure (Dockerfile, compose, entrypoint)
  devrig.toml        Project configuration
  .env               Environment variables (git author, Claude params)
  .gitignore         Updated with devrig entries

Run this from your project root. If .devrig/ already exists, you'll be asked
before overwriting. At the end, a summary of created files is printed.

Example:
  cd my-project
  devrig init

See also: devrig start, devrig config`,

  start: `Build the Docker container, start services, and connect to Claude Code.

Flags:
  --rebuild        Force rebuild the Docker image
  --no-chrome      Skip Chrome bridge and browser
  --no-dev-server  Skip the dev server

Requires devrig.toml in the current directory (or a parent). Run devrig init
first if you haven't already. Claude Code runs with --dangerously-skip-permissions
inside the container for an uninterrupted workflow.

Examples:
  devrig start                  Start with all features
  devrig start --no-chrome      Start without Chrome bridge

See also: devrig stop, devrig status, devrig clean`,

  stop: `Stop a running devrig session for the current project.

Tears down the Docker container, Chrome bridge, and dev server. Run this from
the project directory (or any subdirectory) — it finds the session via the lock
file at .devrig/session.json.

Safe to run from a different terminal while a session is active.

Example:
  devrig stop

See also: devrig start, devrig status`,

  status: `Show the status of the current project's devrig session.

Displays whether the container, Chrome bridge, and dev server are running,
along with the session PID and start time. If the session PID is dead but
the lock file remains, suggests running devrig stop to clean up.

Example:
  devrig status

See also: devrig start, devrig stop`,

  config: `Re-run the interactive configuration wizard for the current project.

Regenerates devrig.toml and updates .env. Your existing .env entries outside
the managed block are preserved. Useful after changing dev server setup,
switching Chrome bridge on/off, or updating git author info.

Requires an existing devrig.toml or .devrig/ directory.

Example:
  devrig config

See also: devrig init`,

  clean: `Remove Docker images, volumes, containers, and networks created by devrig.

By default, cleans resources for the current project (requires devrig.toml).
With --all, finds ALL devrig resources across all projects using Docker labels —
no project directory needed. Useful when you've already deleted your project files.

Does NOT touch .devrig/, devrig.toml, .env, or any project files.
Refuses to run (without --all) if a session is active — use devrig stop first.

Flags:
  --all            Find and remove devrig resources across ALL projects
  -y, --yes        Skip the confirmation prompt

Examples:
  devrig clean          Clean current project's Docker resources
  devrig clean --all    Find all devrig resources system-wide
  devrig clean --all -y Remove everything without asking

See also: devrig stop`,
};

function printUsage() {
  console.log(`Usage: devrig <command> [flags]

Commands:
  init      Initialize devrig in the current directory
  start     Start a coding session (alias: claude)
  stop      Stop a running devrig session
  status    Show status of the current session
  config    Re-run the configuration wizard
  clean     Remove Docker artifacts for this project

Run devrig <command> --help for more info.`);
}

if (wantsHelp && command && command in subcommandHelp) {
  console.log(
    `Usage: devrig ${command}${command === 'start' || command === 'clean' ? ' [flags]' : ''}\n`,
  );
  console.log(subcommandHelp[command]);
  process.exit(0);
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
  case 'stop': {
    const projectDir = resolveProjectDir();
    stopSession(projectDir);
    break;
  }
  case 'status': {
    const projectDir = resolveProjectDir();
    showStatus(projectDir);
    break;
  }
  case 'clean':
    await clean(rest);
    break;
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
