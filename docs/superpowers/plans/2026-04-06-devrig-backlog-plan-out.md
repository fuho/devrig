# devrig Backlog — Plan OUT (On Host)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker cleanup, compose improvements, and host-level verification of features built in Plan IN. All work requires Docker builds or host access.

**Architecture:** Docker/compose config changes plus manual verification tasks. Each task is small and independently testable by running `devrig start` or `docker build`.

**Tech Stack:** Dockerfile, Docker Compose YAML, shell commands for verification.

**Spec:** `docs/superpowers/specs/2026-04-06-devrig-backlog-split-design.md`

**Depends on:** Plan IN must be completed first (or at least the relevant phases — see dependency notes per task).

---

## Phase 1: Docker Cleanup

### Task 1: Verify npm branch removal

**Depends on:** Plan IN Tasks 2-4 (npm branch removal) completed.

**Files:**

- None (verification only)

- [ ] **Step 1: Verify no npm files exist**

```bash
ls scaffold/Dockerfile.npm scaffold/compose.npm.yml 2>&1
```

Expected: `No such file or directory` for both.

- [ ] **Step 2: Verify devrig start works**

```bash
cd /tmp && mkdir test-devrig-out && cd test-devrig-out && git init
npx /path/to/devrig init
# Answer prompts: test-project, claude, y, npm run dev, 3000, 10, n, Test, test@test.com, y
npx /path/to/devrig start
```

Expected: Container builds and starts without errors. No references to npm variant in output.

- [ ] **Step 3: Verify --npm flag is gone**

```bash
npx /path/to/devrig start --help
```

Expected: Help output does NOT mention `--npm`.

- [ ] **Step 4: Clean up test project**

```bash
npx /path/to/devrig stop
cd /tmp && rm -rf test-devrig-out
```

---

### Task 2: Add .dockerignore

**Files:**

- Create: `scaffold/.dockerignore`

- [ ] **Step 1: Create the .dockerignore file**

Create `scaffold/.dockerignore`:

```
home/
logs/
session.json
*.log
.devrig-version
template/
```

- [ ] **Step 2: Verify it gets copied during init**

```bash
cd /tmp && mkdir test-dockerignore && cd test-dockerignore && git init
npx /path/to/devrig init
ls -la .devrig/.dockerignore
```

Expected: File exists in `.devrig/`.

- [ ] **Step 3: Verify build context is smaller**

```bash
npx /path/to/devrig start --rebuild 2>&1 | head -20
```

Expected: Build succeeds. No errors about missing files. Build context should be smaller (visible in Docker build output if using BuildKit).

- [ ] **Step 4: Clean up**

```bash
npx /path/to/devrig stop
cd /tmp && rm -rf test-dockerignore
```

- [ ] **Step 5: Commit**

```bash
git add scaffold/.dockerignore
git commit -m "chore: add .dockerignore to reduce build context"
```

---

### Task 3: Combine GitHub CLI into single apt block

**Files:**

- Modify: `scaffold/Dockerfile`

- [ ] **Step 1: Restructure the Dockerfile apt commands**

Replace lines 6-16 of `scaffold/Dockerfile` (the two separate apt blocks):

```dockerfile
# Add GitHub CLI apt repo
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list

RUN apt-get update && \
    apt-get install -y git socat ripgrep curl jq ca-certificates vim tree gh && \
    rm -rf /var/lib/apt/lists/*
```

This adds the GH CLI repo first (no apt-get update needed for that), then does a single `apt-get update && install` for everything.

- [ ] **Step 2: Verify image builds**

```bash
cd /path/to/test-project
npx /path/to/devrig start --rebuild
```

Expected: Image builds successfully.

- [ ] **Step 3: Verify gh is available**

Inside the container:

```bash
gh --version
```

Expected: Prints GitHub CLI version.

- [ ] **Step 4: Commit**

```bash
git add scaffold/Dockerfile
git commit -m "perf: combine GitHub CLI into single apt block (saves one cache layer)"
```

---

### Task 4: Pin pnpm version

**Files:**

- Modify: `scaffold/Dockerfile:74`

- [ ] **Step 1: Pin pnpm to major version 9**

In `scaffold/Dockerfile`, replace line 74:

```dockerfile
RUN npm install -g pnpm@9
```

- [ ] **Step 2: Verify image builds and pnpm works**

```bash
npx /path/to/devrig start --rebuild
```

Inside the container:

```bash
pnpm --version
```

Expected: Version starts with `9.`.

- [ ] **Step 3: Commit**

```bash
git add scaffold/Dockerfile
git commit -m "chore: pin pnpm to major version 9"
```

---

## Phase 2: Docker Improvements

### Task 5: Add `init: true` to compose

**Files:**

- Modify: `scaffold/compose.yml`

- [ ] **Step 1: Add init to service definition**

In `scaffold/compose.yml`, add `init: true` after the `tty: true` line:

```yaml
    tty: true
    init: true
```

- [ ] **Step 2: Verify container starts with tini**

```bash
npx /path/to/devrig start --rebuild
```

Inside the container:

```bash
ps aux | head -5
```

Expected: PID 1 should be `tini` or `/sbin/tini`.

- [ ] **Step 3: Commit**

```bash
git add scaffold/compose.yml
git commit -m "chore: add init: true for proper zombie process reaping"
```

---

### Task 6: Add tmpfs for /tmp

**Files:**

- Modify: `scaffold/compose.yml`

- [ ] **Step 1: Add tmpfs to service definition**

In `scaffold/compose.yml`, add after the `init: true` line:

```yaml
    tmpfs:
      - /tmp
```

- [ ] **Step 2: Verify /tmp is tmpfs**

```bash
npx /path/to/devrig start --rebuild
```

Inside the container:

```bash
mount | grep /tmp
```

Expected: Output shows `/tmp` mounted as `tmpfs`.

- [ ] **Step 3: Commit**

```bash
git add scaffold/compose.yml
git commit -m "chore: add tmpfs /tmp for faster temp operations"
```

---

### Task 7: Verify Claude Code version pinning

**Depends on:** Plan IN Tasks 8-11 (version pinning) completed.

**Files:**

- None (verification only)

- [ ] **Step 1: Test version = "latest"**

Create a test project with `devrig init`. Verify `devrig.toml` contains:

```toml
[claude]
version = "latest"
```

Run `devrig start --rebuild`. Verify:
- Container builds and starts
- Claude Code installs successfully
- Output shows `claude already installed` on subsequent starts (not re-installing)

- [ ] **Step 2: Test version = "stable"**

Edit `devrig.toml`:

```toml
[claude]
version = "stable"
```

Run `devrig start --rebuild`. Verify:
- Claude Code installs the stable channel
- Output includes `(channel: stable)` or similar

- [ ] **Step 3: Test pinned version**

Edit `devrig.toml`:

```toml
[claude]
version = "2.1.89"
```

Run `devrig start --rebuild`. Verify:
- Claude Code installs version 2.1.89 specifically
- `claude --version` inside container shows the pinned version

- [ ] **Step 4: Test skip on subsequent starts**

Run `devrig stop` then `devrig start` (without `--rebuild`). Verify:
- Claude Code is NOT re-installed (output shows "already installed")
- Startup is faster (no install step)

- [ ] **Step 5: Test --rebuild forces re-install**

Run `devrig start --rebuild`. Verify:
- Image rebuilds from scratch
- Claude Code installs fresh

- [ ] **Step 6: Verify auto-updater is disabled**

Inside the container:

```bash
cat ~/.claude/settings.json
```

Expected: Contains `"DISABLE_AUTOUPDATER": "1"` in the `env` key.

---

## Phase 3: Verify IN Plan Features

### Task 8: Verify `devrig logs`

**Depends on:** Plan IN Task 5 completed.

**Files:**

- None (verification only)

- [ ] **Step 1: Start a session**

```bash
npx /path/to/devrig start
```

- [ ] **Step 2: Test devrig logs from another terminal**

In a second terminal:

```bash
npx /path/to/devrig logs
```

Expected: Shows dev server logs and container logs sequentially.

- [ ] **Step 3: Test --container flag**

```bash
npx /path/to/devrig logs --container
```

Expected: Shows only container/Docker logs.

- [ ] **Step 4: Test --dev-server flag**

```bash
npx /path/to/devrig logs --dev-server
```

Expected: Shows only dev server log file contents.

- [ ] **Step 5: Test --follow flag**

```bash
npx /path/to/devrig logs --container -f
```

Expected: Streams live. Ctrl-C to stop.

- [ ] **Step 6: Stop session**

```bash
npx /path/to/devrig stop
```

---

### Task 9: Verify `devrig exec`

**Depends on:** Plan IN Task 6 completed.

**Files:**

- None (verification only)

- [ ] **Step 1: Start a session and exit Claude**

```bash
npx /path/to/devrig start
# Inside Claude, type /exit to leave Claude but keep container running
```

Note: After `/exit`, devrig normally cleans up. For this test, use Ctrl-C during the Claude session to detach without full cleanup, OR run from another terminal.

- [ ] **Step 2: Test devrig exec**

In another terminal (while session is active):

```bash
npx /path/to/devrig exec
```

Expected: Opens an interactive bash shell inside the running container. You should see the `/workspace` directory with your project files.

- [ ] **Step 3: Test error when no session**

Stop the session first:

```bash
npx /path/to/devrig stop
npx /path/to/devrig exec
```

Expected: Error message suggesting to run `devrig start`.

---

### Task 10: Verify `devrig doctor`

**Depends on:** Plan IN Task 7 completed.

**Files:**

- None (verification only)

- [ ] **Step 1: Run doctor with everything working**

```bash
cd /path/to/test-project
npx /path/to/devrig doctor
```

Expected: All checks pass (green OK for each). Output shows:
- Node.js version
- Docker daemon running
- Docker Compose version
- Chrome found (or WARN if not installed)
- .devrig/ OK
- devrig.toml OK
- Version match
- Ports available

- [ ] **Step 2: Run doctor without .devrig/**

```bash
cd /tmp && mkdir test-doctor && cd test-doctor
npx /path/to/devrig doctor
```

Expected: Fails gracefully — shows FAIL for `.devrig/` and `devrig.toml`, passes for system checks.

Note: This may `die()` if `resolveProjectDir()` fails. If so, that's expected behavior.

- [ ] **Step 3: Test with Docker stopped**

Stop Docker Desktop/OrbStack, then run:

```bash
npx /path/to/devrig doctor
```

Expected: Docker check shows FAIL with "Docker daemon not running". Other checks still run.

- [ ] **Step 4: Clean up**

```bash
rm -rf /tmp/test-doctor
```

---

### Task 11: Verify `devrig update`

**Depends on:** Plan IN Task 13 completed.

**Files:**

- None (verification only)

- [ ] **Step 1: Create a test project**

```bash
cd /tmp && mkdir test-update && cd test-update && git init
npx /path/to/devrig init
```

- [ ] **Step 2: Modify a scaffold file**

```bash
echo "# modified" >> .devrig/entrypoint.sh
```

- [ ] **Step 3: Run devrig update**

```bash
npx /path/to/devrig update
```

Expected: Shows `entrypoint.sh` as changed, prompts for confirmation. After confirming, file is restored to the original scaffold version.

- [ ] **Step 4: Verify version marker updated**

```bash
cat .devrig/.devrig-version
```

Expected: Shows current devrig version.

- [ ] **Step 5: Run update again — should show no changes**

```bash
npx /path/to/devrig update
```

Expected: "All scaffold files are up to date."

- [ ] **Step 6: Clean up**

```bash
cd /tmp && rm -rf test-update
```

---

## Final Verification

After all tasks are complete:

1. Full `devrig init` → `devrig start` → Claude session → `/exit` cycle works
2. `devrig doctor` shows all green on a properly configured project
3. `devrig logs` shows real logs from a running session
4. `devrig exec` re-attaches to a running container
5. `devrig update` detects and updates changed scaffold files
6. Claude Code version pinning works with "latest", "stable", and specific versions
7. Container has `init: true` (tini as PID 1) and tmpfs /tmp
8. Docker build uses `.dockerignore` and single apt block
9. No npm variant references remain anywhere
10. `npm run check` passes in the devrig repo
