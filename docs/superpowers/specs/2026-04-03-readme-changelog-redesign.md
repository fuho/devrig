# Spec: README & CHANGELOG Redesign

## Goal

Rewrite README.md to be engaging, scannable, and informative for both experienced devs and newcomers. Update CHANGELOG.md to cover 0.2.0 features. Use GitHub-flavored markdown features to their fullest.

## Target Audience

Both experienced Docker/AI-tool users (want to skim and go) and AI-curious devs new to containerized workflows (need the "why" and more hand-holding). Strategy: sharp content up top, collapsible detail sections for depth.

## Tone

Conversational — friendly, explains decisions, has personality. Not a man page, closer to how Vite or Bun present themselves. Short punchy sentences. Clear opinions about why devrig exists.

---

## README Structure

### 1. Badges

Top of file, single line:

- CI status (GitHub Actions)
- npm version (links to npmjs.com)
- License (MIT)
- Node version requirement (>=18.3)

### 2. Title + Hook

```
# devrig

Run AI coding agents in Docker so they can't break your machine.
```

Follow with 2-3 sentences: AI agents are powerful but they install packages, modify system files, and run arbitrary commands. devrig gives them a containerized playground with your project mounted, optional browser control, and git safety rails. Two commands to start, zero dependencies.

### 3. Why devrig?

Six key selling points, each as a short bolded phrase + one-sentence explanation:

- **Isolation** — AI runs in a container, your host stays clean
- **Git safety** — push is blocked, pull on master is blocked
- **Browser control** — AI can see and interact with your running app via Chrome
- **Zero config** — `npx devrig init` scaffolds everything, no Dockerfiles to write
- **Clean host** — nothing installed on your machine, no leftover processes
- **Reproducible** — share `.devrig/` with your team, everyone gets the same setup

### 4. How It Works

Mermaid diagram showing the architecture:

```
Host machine:
  devrig CLI orchestrates:
    - Docker container (project at /workspace, Claude Code inside)
    - Chrome bridge (optional, TCP relay to host browser)
    - Dev server (optional, on host)
```

The Mermaid diagram shows the flow: `devrig start` -> build image -> start container -> start bridge -> start dev server -> wait for Claude -> connect TTY.

Below the Mermaid block, a collapsible `<details>` with an ASCII art version for terminal/non-GitHub contexts.

### 5. Quick Start

```bash
npx devrig init    # scaffolds .devrig/, walks through config
npx devrig start   # builds container, starts services, connects you
```

Below: a simulated terminal output block showing what `devrig start` actually prints (build, bridge started, dev server ready, Claude Code ready, connecting). This lets people "see" the experience before trying it.

### 6. CLI Reference

**Commands table:**

| Command         | Description                                     |
| --------------- | ----------------------------------------------- |
| `devrig init`   | Scaffold `.devrig/` and run config wizard       |
| `devrig start`  | Start a coding session (alias: `devrig claude`) |
| `devrig stop`   | Stop a running session from another terminal    |
| `devrig status` | Show what's running                             |
| `devrig config` | Re-run the configuration wizard                 |

**Flags table (for `start`):**

| Flag              | Effect                              |
| ----------------- | ----------------------------------- |
| `--rebuild`       | Force rebuild the Docker image      |
| `--no-chrome`     | Skip Chrome bridge and browser      |
| `--no-dev-server` | Skip the dev server                 |
| `--npm`           | Use npm installer instead of native |

### 7. Configuration

#### devrig.toml

Show the config with inline comments. Below it, a collapsible `<details>` titled "Full configuration reference" with a table of every field, its default, and what it does.

#### .env

Show the 3 key variables with brief explanation.

#### SSH & Git Setup

Collapsible `<details>` section. Content:

- `> [!TIP]` explaining that `.devrig/home/` is mounted as `/home/dev` inside the container
- Place SSH keys at `.devrig/home/.ssh/` with a config snippet:
  ```
  Host github.com
      HostName github.com
      User git
      IdentityFile ~/.ssh/id_ed25519
      IdentitiesOnly yes
  ```
- Copy this config to `.devrig/home/.ssh/config`
- Recommend passwordless keys or explain that passphrase-protected keys won't work without ssh-agent
- `> [!WARNING]` that `.devrig/home/` is gitignored by default (keys stay safe), don't override this

#### Session Management

Brief section (3 bullets): lock file prevents parallel sessions, `devrig stop` for teardown, stale lock auto-recovery.

### 8. What's Inside the Container

Collapsible `<details>` section (keeps README scannable). Content:

Table format:

| Aspect         | Details                                  |
| -------------- | ---------------------------------------- |
| Base image     | `node:25-slim`                           |
| Included tools | git, ripgrep, gh, socat, vim, tree, pnpm |
| User           | `dev` with UID matching host             |
| Git safety     | `push` blocked, `pull` on master blocked |
| Resources      | 8 GB memory, 4 CPUs (configurable)       |
| Claude Code    | Installed automatically (native or npm)  |

### 9. Prerequisites

`> [!IMPORTANT]` alert admonition:

- Node.js >= 18.3
- Docker Desktop (or Docker Engine + Compose plugin)

### 10. Development

Commands in a table (not a code block — easier to scan):

| Command                 | What it does              |
| ----------------------- | ------------------------- |
| `npm test`              | Unit + integration tests  |
| `npm run test:coverage` | Tests with coverage       |
| `npm run lint`          | ESLint                    |
| `npm run typecheck`     | TypeScript JSDoc checking |
| `npm run check`         | Everything at once        |

Collapsible `<details>` with project structure tree.

### 11. Acknowledgments

Short paragraph with link to claude-code-remote-chrome. Could use a footnote style.

### 12. License

Single line: MIT with link to LICENSE file.

---

## CHANGELOG Updates

### Version bump to 0.2.0

Add a new section at the top:

```
## 0.2.0 — 2026-04-03

### Features
- `devrig stop` — stop a running session from another terminal
- `devrig status` — show running components and their state
- Session lock — prevents parallel sessions on the same project with PID-based lock file
- Scaffold staleness warning — alerts when `.devrig/` files are from an older version
- Error hardening — user-friendly messages for file I/O failures in `devrig init`

### Development
- ESLint 9 with flat config
- Prettier formatting
- TypeScript JSDoc type checking via `tsc --checkJs`
- Test coverage via `--experimental-test-coverage`
- GitHub Actions CI (Node 18, 20, 22)
- JSDoc on all exported functions

### Documentation
- README rewritten with architecture diagram, GitHub alerts, collapsible sections
- SSH & Git setup guide
- Expanded CLI and configuration reference
```

---

## GitHub Markdown Features Used

| Feature                  | Where                                                            |
| ------------------------ | ---------------------------------------------------------------- |
| Mermaid diagram          | Architecture in "How It Works"                                   |
| ASCII art in `<details>` | Fallback architecture diagram                                    |
| `> [!IMPORTANT]`         | Prerequisites                                                    |
| `> [!TIP]`               | SSH setup hint                                                   |
| `> [!WARNING]`           | SSH key safety                                                   |
| `<details><summary>`     | Container details, full config ref, SSH setup, project structure |
| Tables                   | CLI commands, flags, config fields, dev commands                 |
| Badges                   | CI, npm, license, Node version                                   |
| Syntax highlighting      | `bash`, `toml`, config blocks                                    |
| Relative links           | CHANGELOG.md, LICENSE                                            |

---

## Out of Scope

- No code changes (documentation only)
- No new features
- TODO.md left as-is (internal doc)
