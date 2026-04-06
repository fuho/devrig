# Spec: Host/Container CLAUDE.md Isolation

## Problem

devrig bind-mounts the entire project root (`.:/workspace`) into the container. This means host Claude and container Claude both read the same `CLAUDE.md`. Container-specific instructions ("you are running inside a Docker container", "git push is blocked") confuse host Claude. Both can run simultaneously, so modifying the shared file at runtime is not an option.

A secondary issue: the `.devrig/` directory is visible inside the container at `/workspace/.devrig/`, exposing `home/.claude/` (logs, settings, session data), scaffold files, and runtime artifacts. Container Claude can stumble into these during exploration, consuming context window for no value.

## Constraints

- Host Claude and container Claude can run simultaneously — no shared mutable state
- User content in `CLAUDE.md` (outside devrig sentinels) must be visible to both
- Container Claude must not see `.devrig/` contents via the workspace mount
- No new user-facing conventions (no `.claudeignore`, no manual file management)
- `CLAUDE.local.md` is user-managed and out of scope — devrig does not touch it

## Design

### Two versions of CLAUDE.md

`generateClaudeMd()` produces two files from the same user content:

- **`CLAUDE.md`** (project root) — user content + host devrig block
- **`.devrig/CLAUDE.md`** — user content + container devrig block

Both use the existing `<!-- devrig:start -->` / `<!-- devrig:end -->` sentinel system. User content outside the sentinels is identical in both files. Only the devrig block differs.

### Host devrig block

```
<!-- devrig:start -->
## devrig

This project uses devrig for containerized AI development.

Available commands:
- `devrig start` — launch a container session
- `devrig stop` — stop the running session
- `devrig doctor` — check system prerequisites
- `devrig logs` — view container and dev server logs
- `devrig exec` — open a shell in the running container
- `devrig update` — update scaffold files to latest version

Do not modify files in `.devrig/` directly — use `devrig update` to sync scaffold changes.
<!-- devrig:end -->
```

### Container devrig block

The existing container block (workspace path, dev server URL, Chrome bridge status, git push warning, MCP tool check). No changes to its content.

### Shadow mount

`compose.yml` mounts the container version over the host version:

```yaml
volumes:
  - .:/workspace
  - ./.devrig/CLAUDE.md:/workspace/CLAUDE.md:ro
  - devrig-mask:/workspace/.devrig
```

- `.devrig/CLAUDE.md` is mounted read-only over `/workspace/CLAUDE.md` — container Claude sees the container version
- `devrig-mask` is a named volume that hides `/workspace/.devrig/` entirely inside the container
- Host `CLAUDE.md` is untouched and visible to host Claude

### Named volume for masking

A named volume (not anonymous) masks `.devrig/` to avoid orphan volume accumulation:

```yaml
volumes:
  node_modules:
    labels:
      devrig.project: ${DEVRIG_PROJECT:-my-project}
  devrig-mask:
```

`docker compose down -v` cleans it up along with `node_modules`.

### Regeneration on start

`devrig start` regenerates `.devrig/CLAUDE.md` before running `docker compose up`. This ensures the container version reflects any user edits to `CLAUDE.md` since the last `init` or `start`. The operation is cheap (read file, splice sentinels, write file).

### Visibility matrix

| Path | Host Claude | Container Claude |
|------|------------|-----------------|
| `CLAUDE.md` | Host version (real file) | Container version (shadow mount, read-only) |
| `CLAUDE.local.md` | Yes | Yes (bind mount passthrough, not managed by devrig) |
| `.devrig/` | Full access | Hidden (masked by named volume) |
| `/home/dev/.claude/` | N/A | Yes (via `.devrig/home` volume mount) |
| Project source | Yes | Yes |

## Changes Required

### `src/init.js`

- `generateClaudeMd(projectDir, cfg)` writes two files:
  - `CLAUDE.md` at project root with host devrig block
  - `.devrig/CLAUDE.md` with container devrig block
- Reads existing `CLAUDE.md` to preserve user content outside sentinels
- Both files get the same user content, different devrig blocks

### `scaffold/compose.yml`

- Add `./.devrig/CLAUDE.md:/workspace/CLAUDE.md:ro` to volumes
- Add `devrig-mask:/workspace/.devrig` to volumes
- Add `devrig-mask:` to top-level volumes

### `src/launcher.js`

- Before `docker compose up`, call `generateContainerClaudeMd()` (or reuse `generateClaudeMd` with a target parameter) to regenerate `.devrig/CLAUDE.md`

### `src/update.js`

- When updating scaffold files, regenerate `.devrig/CLAUDE.md` as well

### Tests

- Unit test: `generateClaudeMd` produces two files with correct blocks
- Unit test: user content preserved in both versions
- Unit test: re-generation updates container version when host version changes
- Scaffold test: `compose.yml` contains shadow mount and mask volume
- E2E: `devrig init` creates both files
- Docker integration: container cannot see `/workspace/.devrig/` contents
- Docker integration: container reads container version of `CLAUDE.md`

## Out of Scope

- `CLAUDE.local.md` management — user-owned, devrig does not touch it
- Multiple CLAUDE.md files in subdirectories — standard Claude Code behavior, unaffected
- Modifying container CLAUDE.md at runtime — read-only mount prevents this by design
