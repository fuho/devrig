#!/usr/bin/env node
// @ts-check

import { launch } from '../src/launcher.js';
import { configure } from '../src/configure.js';
import { init } from '../src/init.js';
import { clean } from '../src/clean.js';
import { resolveProjectDir, getPackageVersion } from '../src/config.js';
import { stopSession, showStatus } from '../src/session.js';
import { logs } from '../src/logs.js';
import { exec } from '../src/exec.js';
import { runAll as runDoctor } from '../src/doctor.js';
import { update } from '../src/update.js';
import { envCommand } from '../src/env.js';
import { setVerbose, die } from '../src/log.js';

// Catch parseArgs errors (unknown flags, missing values) and show clean messages
process.on('uncaughtException', (err) => {
  const code = /** @type {any} */ (err).code;
  if (
    code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ||
    code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' ||
    code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'
  ) {
    die(err.message);
  }
  throw err;
});

const command = process.argv[2];
const rest = process.argv.slice(3);

// Parse global flags, forward the rest to subcommands
const GLOBAL_FLAGS = new Set(['--verbose']);
const subArgs = rest.filter((a) => !GLOBAL_FLAGS.has(a));
if (rest.includes('--verbose')) {
  setVerbose(true);
  process.env.BRIDGE_VERBOSE = '1';
}

const wantsHelp = subArgs.includes('--help') || subArgs.includes('-h');

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
With --project, targets a specific project by name without needing to be in its directory.
With --all, finds ALL devrig resources across all projects using Docker labels.
With --list, shows all known devrig project names.

Does NOT touch .devrig/, devrig.toml, .env, or any project files.
Refuses to run (without --all/--project) if a session is active — use devrig stop first.

Flags:
  --project <name>   Clean resources for a specific project by name
  -a, --all          Find and remove devrig resources across ALL projects
  -l, --list         List all known devrig project names
  --orphans          Kill orphaned devrig processes (bridge, setup)
  -y, --yes          Skip the confirmation prompt

Examples:
  devrig clean                     Clean current project's Docker resources
  devrig clean --project my-app    Clean a specific project's resources
  devrig clean --list              Show all devrig projects
  devrig clean --orphans           Kill orphaned devrig processes
  devrig clean --all               Find all devrig resources system-wide
  devrig clean --all -y            Remove everything without asking

See also: devrig stop`,

  logs: `Show logs from a devrig session.

By default, shows both dev server and container logs sequentially.

Flags:
  --dev-server  Show only dev server logs
  --container   Show only container logs
  --network     Show network traffic info and mitmproxy log locations
  --follow, -f  Stream logs live

Examples:
  devrig logs                  Show all logs
  devrig logs --container -f   Stream container logs live
  devrig logs --network        Show network traffic info

See also: devrig status`,

  exec: `Re-attach to a running devrig container.

Opens an interactive bash shell inside the running container without
restarting the session. Useful when your terminal disconnects or you
accidentally Ctrl-C'd out of Claude Code.

If no session is active, suggests running devrig start.

Example:
  devrig exec

See also: devrig start, devrig stop`,

  doctor: `Run pre-flight health checks for devrig.

Checks Node.js version, Docker daemon, Docker Compose, Chrome browser,
.devrig/ directory, devrig.toml validity, version staleness, and port
availability.

Example:
  devrig doctor

See also: devrig init, devrig start`,

  update: `Update scaffold files from the installed devrig version.

Compares each file in .devrig/ against the current devrig package and
shows which files differ. Prompts before overwriting. Skips user data
(.devrig/home/) and runtime state (.devrig/session.json).

Flags:
  --force  Skip confirmation prompt

Example:
  devrig update

See also: devrig init, devrig doctor`,

  env: `Manage shared environment.

The shared environment keeps Claude Code auth, memories, and settings
at ~/.devrig/shared/, shared across all projects.

Commands:
  inspect     Show shared environment details
  reset       Re-copy scaffold files, preserve auth/memories

Examples:
  devrig env inspect
  devrig env reset

See also: devrig init`,
};

function printSubcommandHelp(cmd) {
  if (!(cmd in subcommandHelp)) return false;
  const text = subcommandHelp[cmd];
  const hasFlags = /^Flags:/m.test(text);
  console.log(`Usage: devrig ${cmd}${hasFlags ? ' [flags]' : ''}\n`);
  console.log(text);
  return true;
}

function printUsage() {
  console.log(`Usage: devrig <command> [flags]

Commands:
  init      Initialize devrig in the current directory
  start     Start a coding session
  stop      Stop a running devrig session
  status    Show status of the current session
  config    Re-run the configuration wizard
  clean     Remove Docker artifacts (current project, --project, or --all)
  logs      Show logs from a devrig session
  exec      Re-attach to a running container
  doctor    Run pre-flight health checks
  update    Update scaffold files to current version
  env       Manage shared environment

Global flags:
  --verbose  Show detailed diagnostic output

Run devrig <command> --help for more info.`);
}

if (wantsHelp && command && printSubcommandHelp(command)) {
  process.exit(0);
}

switch (command) {
  case 'init':
    await init(process.cwd());
    break;
  case 'start':
    await launch(subArgs);
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
    await clean(subArgs);
    break;
  case 'logs':
    await logs(subArgs);
    break;
  case 'exec':
    await exec();
    break;
  case 'doctor': {
    const projectDir = resolveProjectDir();
    await runDoctor(projectDir);
    break;
  }
  case 'update':
    await update(subArgs);
    break;
  case 'env':
    await envCommand(subArgs);
    break;
  case '--version':
  case '-v':
    console.log(getPackageVersion());
    break;
  case 'help':
    if (printSubcommandHelp(subArgs[0])) process.exit(0);
  // fall through
  case '--help':
  case '-h':
  case undefined:
    console.log(`devrig ${getPackageVersion()}\n`);
    printUsage();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(1);
}
