# Spec: devrig Backlog — IN/OUT Plan Split

## Goal

Organize the devrig backlog (sourced from three expert reviews dated 2026-04-06 and two prior implementation plan audits) into two implementation plans:

- **Plan IN** — work that can be developed and unit-tested entirely inside a devrig container (JS code, tests, docs)
- **Plan OUT** — work that requires Docker builds, compose changes, or host-level verification (run manually on the host Mac)

Features that span both plans get their code written in Plan IN and a verification task in Plan OUT.

## Constraints

- **Backlog-style** — comprehensive with explicit phases, not release-targeted
- **Code and technical work only** — positioning/messaging changes handled separately
- **Conservative security** — only no-risk Docker changes (init: true, tmpfs, .dockerignore)
- **Manual Docker testing** — no Docker-in-Docker; OUT plan assumes manual verification on host Mac
- **Drop npm installer branch** — the npm-based Claude Code installer is deprecated; remove it entirely

## Source Material

- `docs/reviews/2026-04-06-dx-analysis.md` — DX review
- `docs/reviews/2026-04-06-technical-analysis.md` — technical review
- `docs/reviews/2026-04-06-product-strategy.md` — product strategy review
- `docs/superpowers/plans/2026-04-03-dual-page-handshake.md` — prior plan (audited: ~95% shipped in v0.3.0)
- `docs/superpowers/plans/2026-04-03-readme-changelog-redesign.md` — prior plan (audited: ~90% shipped, Mermaid diagram removed intentionally)

## Items Reviewed and Dropped

These items from the reviews were evaluated and intentionally excluded:

| Item | Source | Reason for Dropping |
|------|--------|---------------------|
| Browser opens before Claude ready | DX review (HIGH) | The dual-page handshake (v0.3.0) already solves this — `/devrig/setup` shows live SSE status while Claude starts. Delaying the browser would remove useful feedback. |
| Dev server timeout too strict | DX review (HIGH) | Default 10s is fine for the template server (<1s startup). For heavy projects, `ready_timeout` is configurable in devrig.toml. The warning says "continuing anyway" — it doesn't block. |
| Chrome bridge health monitoring | Technical review (HIGH) | Edge case. Chrome crashes are immediately visible because Claude reports MCP unavailability. Adding socat watchdog + reconnect retry is complexity for a rare scenario. |
| Template files skipped if package.json exists | DX review (MEDIUM) | Correct behavior. Existing projects have their own dev server; overwriting with the template server.js would be destructive. |
| Multi-project port auto-assignment | DX review (MEDIUM) | Users set ports in devrig.toml per project. Running two projects simultaneously is a power-user scenario where explicit port configuration is appropriate. |
| Mermaid diagram in README | Prior plan gap | User decision: can be re-created later, not a priority. |
| Full security hardening (seccomp, cap_drop ALL, AppArmor) | Technical review (HIGH) | User decision: conservative approach only. No-risk changes (init: true, tmpfs, .dockerignore) included; aggressive hardening deferred. |

---

## Inventory

| # | Item | Priority | Plan | Source |
|---|------|----------|------|--------|
| 1 | Claude Code version pinning + explicit update | HIGH | IN+OUT | Technical review + discussion |
| 2 | `devrig doctor` pre-flight check | HIGH | IN+OUT | DX + product strategy reviews |
| 3 | `devrig exec` re-attach to container | HIGH | IN+OUT | DX review |
| 4 | Port validation — warn on fallback | HIGH | IN | DX review |
| 5 | `devrig logs` command | HIGH | IN+OUT | DX + product strategy reviews |
| 6 | Drop npm install branch | MEDIUM | IN+OUT | Discussion (npm installer deprecated) |
| 7 | Port conflict messaging consistency | MEDIUM | IN | DX review |
| 8 | `devrig update` scaffold files | MEDIUM | IN+OUT | DX + product strategy reviews |
| 9 | Document Dockerfile customization | LOW | IN | DX review |
| 10 | Document npm packages + rebuilds | LOW | IN | DX review |
| 11 | `init: true` in compose | LOW | OUT | Technical review |
| 12 | `.dockerignore` | LOW | OUT | Technical review |
| 13 | `tmpfs /tmp` in compose | LOW | OUT | Technical review |
| 14 | Pin pnpm version in Dockerfile | LOW | OUT | Technical review |
| 15 | Combine GH CLI into single apt block | LOW | OUT | Technical review |

---

## Plan IN — Inside devrig

Work that is pure JS, tests, and documentation. Can be developed and unit-tested entirely inside a devrig container.

### Phase 1: Quick Wins

**4. Port validation — warn on fallback**

`src/configure.js` has a `parsePort(value, fallback)` function that silently returns the fallback when the user enters an invalid port. If a user types "abc" for a port, they get 3000 with no feedback.

Fix: when `parsePort` uses the fallback because the input was invalid, log a warning: `"Invalid port '{value}' — using {fallback}"`. Keep the fallback behavior (don't crash), just inform the user.

Files: `src/configure.js`
Tests: add test case for invalid port input in `test/configure.test.js` (or create if it doesn't exist)

**6. Drop npm install branch**

The npm-based Claude Code installer (`npm install -g @anthropic-ai/claude-code`) is deprecated. Remove all npm variant support:

- Delete `scaffold/Dockerfile.npm`
- Delete `scaffold/compose.npm.yml`
- Remove `--npm` flag from `parseArgs` in `src/launcher.js`
- Remove `npm` variant handling in `src/docker.js` (`initVariant`)
- Remove `installClaudeCodeNpm()` from `scaffold/container-setup.js`
- Remove `CLAUDE_INSTALL_METHOD` env var handling (always native)
- Update README CLI table (remove `--npm` flag row)
- Update any tests that reference the npm variant

This simplifies the codebase before building version pinning on top of it.

Files: `scaffold/Dockerfile.npm`, `scaffold/compose.npm.yml`, `src/launcher.js`, `src/docker.js`, `scaffold/container-setup.js`, `README.md`
Tests: update/remove npm-related test cases

### Phase 2: New Commands

**5. `devrig logs`**

New command that tails devrig logs from a running or recent session.

Behavior:
- No flags: shows dev server logs then container logs sequentially (interleaving by timestamp is complex and fragile)
- `--dev-server`: only dev server logs (from `.devrig/logs/dev-server.log`)
- `--container`: only container logs (shells out to `docker logs <container-name>`)
- `--follow` / `-f`: stream live (tail -f for file logs, `docker logs -f` for container)
- If no session is active, shows logs from the most recent session

Implementation:
- Add `logs` case to `bin/devrig.js` command switch
- New `src/logs.js` module with the log reading/streaming logic
- Read container name from session.json or derive from config
- For container logs, build the `docker logs` command string but shell out to run it

Unit-testable parts: log file reading, argument parsing, container name derivation.
Stub: `docker logs` invocation (verified in Plan OUT).

Files: `bin/devrig.js`, new `src/logs.js`
Tests: `test/logs.test.js`

**3. `devrig exec`**

New command that re-attaches to a running devrig container without restarting the full session.

Behavior:
- Reads session.json to find the running container name
- Verifies the container is actually running (shells out to `docker inspect`)
- Execs into it with an interactive shell: `docker exec -it <container> bash`
- If no session is active, prints helpful error with suggestion to run `devrig start`
- If session.json exists but container is stopped, suggests `devrig start`

Implementation:
- Add `exec` case to `bin/devrig.js` command switch
- New `src/exec.js` module (small — mostly session validation + spawning docker exec)
- Reuse session reading logic from `src/session.js`

Unit-testable parts: session validation, command construction.
Stub: `docker exec` invocation (verified in Plan OUT).

Files: `bin/devrig.js`, new `src/exec.js`
Tests: `test/exec.test.js`

**2. `devrig doctor`**

New command that runs pre-flight checks and reports pass/fail/warning for each.

Checks (each is a pure function returning `{ status: 'pass'|'fail'|'warn', message: string }`):
1. Node.js version >= 18.3
2. Docker daemon running (`docker info`)
3. Docker Compose available (`docker compose version`)
4. Chrome browser installed (platform-aware path check)
5. Dev server port available (net.createServer probe)
6. Chrome bridge port available (net.createServer probe)
7. `.devrig/` directory exists and has expected files
8. devrig.toml is valid (parseable, required fields present)
9. `.devrig-version` matches installed devrig version (staleness)

Implementation:
- Add `doctor` case to `bin/devrig.js`
- New `src/doctor.js` module exporting individual check functions + a `runAll()` orchestrator
- Each check is independently callable and testable
- Output: formatted table of check results with colors (green/yellow/red)

Unit-testable parts: all check functions (mock the shell-out ones with predictable inputs).
Stub: Docker/Chrome checks that need host access (verified in Plan OUT).

Files: `bin/devrig.js`, new `src/doctor.js`
Tests: `test/doctor.test.js`

### Phase 3: Version Pinning

**1. Claude Code version pinning + explicit update**

Add version control for Claude Code installations inside the container.

Config change — `devrig.toml` gains a version field:
```toml
[claude]
version = "latest"        # default written by devrig init. Also accepts "stable" or a specific version like "2.1.89"
# ready_timeout = 120
```

Additionally, the container should set `DISABLE_AUTOUPDATER=1` in Claude Code's settings.json to prevent background auto-updates from overriding the pinned version. Updates should only happen on `--rebuild`.

`devrig init` / `devrig config`: write `version = "latest"` as the default. No network call, no querying installed versions (Claude isn't installed on the host).

`scaffold/container-setup.js` changes:
- Read `CLAUDE_VERSION` env var (passed from compose, sourced from TOML)
- If `"latest"`: install via native installer (current behavior), but do NOT run `claude update` on every start. Only install if `claude` binary is missing.
- If specific version (e.g., `"2.1.89"`): install that exact version via `curl -fsSL https://claude.ai/install.sh | bash -s 2.1.89`
- If `"stable"`: install the stable channel via `bash -s stable` (typically ~1 week behind latest)
- After install, write the resolved version to a marker file (`.claude-version`) so subsequent starts skip installation entirely.
- On `--rebuild`: image is rebuilt, which re-runs the install from scratch.

`src/config.js` changes:
- Parse `[claude] version` field from TOML
- Pass it through to compose environment as `CLAUDE_VERSION`

`src/docker.js` / compose.yml changes:
- Add `CLAUDE_VERSION` to the container environment variables

Future (not in this plan): `devrig pin claude` command that reads the installed version from the container and writes it back to devrig.toml.

Files: `src/config.js`, `src/configure.js`, `scaffold/container-setup.js`, `scaffold/compose.yml`, `scaffold/Dockerfile`
Tests: `test/config.test.js` (TOML parsing), `test/container-setup.test.js` (install logic)

### Phase 4: Medium Items

**7. Port conflict messaging consistency**

The DX review notes inconsistent behavior:
- Bridge: `die()` with "port may be in use" (hard failure)
- Dev server: `log()` with WARNING and continues (soft failure)

Both behaviors are actually correct for their context (bridge failure = Chrome MCP broken = session degraded; dev server failure = inconvenient but Claude can still work). The fix is better messaging, not changed behavior:

- Bridge failure: add suggestion "Try: lsof -i :{port} to see what's using it"
- Dev server warning: clarify "Dev server not reachable yet — Claude can still work but won't see your app in the browser"

Files: `src/launcher.js`
Tests: none needed (message changes only)

**8. `devrig update`**

New command that updates scaffold files from the installed devrig version without re-running the full init wizard.

Behavior:
- Compares each file in the user's `.devrig/` against the corresponding file in devrig's `scaffold/` directory
- Shows a diff summary for changed files
- Prompts for confirmation before overwriting each file
- Skips `.devrig/home/` (user data) and `.devrig/session.json` (runtime state)
- Updates `.devrig-version` marker after successful update
- `--force` flag to skip confirmation prompts

Implementation:
- Add `update` case to `bin/devrig.js`
- New `src/update.js` module
- Reuse scaffold file list from `src/init.js`
- Use Node's built-in diff or simple content comparison

Files: `bin/devrig.js`, new `src/update.js`
Tests: `test/update.test.js`

### Phase 5: Documentation

**9. Document Dockerfile customization**

Add a section to README explaining how to customize the Dockerfile:
- Edit `.devrig/Dockerfile` directly
- Customizations survive `devrig start` and `--rebuild` (image rebuilds from your local Dockerfile)
- Customizations are lost if you run `devrig init` again (prompted before overwrite)
- Recommend docker-compose override files for compose-level changes

**10. Document npm packages + rebuilds**

Add a note to README explaining:
- `node_modules` is a named Docker volume — persists across container restarts
- `--rebuild` rebuilds the image but the node_modules volume persists
- `devrig clean` removes the volume (fresh install on next start)
- For large projects, first start may be slow due to `npm install` inside the container

Files: `README.md`

---

## Plan OUT — On Host

Work that requires Docker builds, compose changes, or host-level verification. Run manually on the host Mac.

### Phase 1: Docker Cleanup

**6. Drop npm branch (verify)**

After Plan IN removes the npm code:
- Verify `devrig start` works without `Dockerfile.npm` and `compose.npm.yml`
- Verify `--npm` flag is gone from help output
- Test a fresh `devrig init` + `devrig start` cycle

**12. `.dockerignore`**

Build context is `.devrig/` (per `compose.yml` line 7: `context: .devrig`). Create `.devrig/.dockerignore` (included in scaffold):
```
home/
logs/
session.json
*.log
```
Verify: `docker build` context size decreases (check build output).

**15. Combine GH CLI into single apt block**

In `scaffold/Dockerfile`, the GitHub CLI installation uses a separate `apt-get install` invocation. Combine into the main apt block to save one cache layer (5-10s per rebuild).

Verify: image builds successfully, `gh --version` works inside container.

**14. Pin pnpm version**

Change `npm install -g pnpm` to `npm install -g pnpm@9` (or whatever the current stable major is) in `scaffold/Dockerfile`.

Verify: image builds, `pnpm --version` returns the pinned version.

### Phase 2: Docker Improvements

**11. `init: true` in compose**

Add `init: true` to the service definition in `scaffold/compose.yml`. This enables tini as PID 1 for proper zombie process reaping. Zero risk, minimal overhead.

Verify: container starts, `ps aux` inside container shows tini as PID 1.

**13. `tmpfs /tmp`**

Add `tmpfs: ["/tmp"]` to the service definition in `scaffold/compose.yml`. Faster temp file operations, auto-cleaned on container stop.

Verify: container starts, `mount | grep /tmp` shows tmpfs.

**1. Version pinning (verify)**

After Plan IN implements the JS side:
- Test `version = "latest"` in devrig.toml → container installs latest Claude Code
- Test `version = "2.1.89"` (or a known version) → container installs exactly that version
- Test `version = "stable"` → container installs stable channel
- Test that subsequent `devrig start` (without `--rebuild`) skips installation
- Test that `--rebuild` re-evaluates the version field
- Verify `CLAUDE_VERSION` env var reaches the container

### Phase 3: Verify IN Plan Features

**5. `devrig logs` (verify)**
- Run `devrig start`, then `devrig logs` from another terminal
- Verify dev server logs stream correctly
- Verify `--container` flag shows Docker container output
- Verify `--follow` streams live

**3. `devrig exec` (verify)**
- Run `devrig start`, Ctrl-C out of the Claude session
- Run `devrig exec` — verify it re-attaches to the running container
- Verify it errors helpfully when no session is active

**2. `devrig doctor` (verify)**
- Run `devrig doctor` with Docker running → all checks pass
- Stop Docker, run `devrig doctor` → Docker check fails with clear message
- Run in a project without `.devrig/` → appropriate warnings

**8. `devrig update` (verify)**
- Modify a scaffold file in a test project's `.devrig/`
- Run `devrig update` → shows diff, prompts, updates
- Verify `.devrig-version` is updated

---

## Dependency Flow

```
IN Phase 1 (port validation, drop npm)
    → OUT Phase 1 (verify npm removal, Dockerfile cleanup)

IN Phase 2 (new commands: logs, exec, doctor)
    → OUT Phase 3 (verify all commands with real Docker)

IN Phase 3 (version pinning JS)
    → OUT Phase 2 (verify pinning with real builds)

IN Phase 4 (messaging, update command) — independent
IN Phase 5 (docs) — independent
OUT Phase 1 (Docker cleanup) — independent of IN Phase 2+
OUT Phase 2 (Docker improvements) — independent except version pinning verify
```

The IN plan is self-contained and testable with unit tests. The OUT plan is verification + Docker config changes. You can complete all of IN first then work through OUT, or interleave at the phase boundaries.
