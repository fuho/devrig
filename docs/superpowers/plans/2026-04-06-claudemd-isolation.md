# CLAUDE.md Host/Container Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give host Claude and container Claude separate CLAUDE.md instructions via a Docker shadow mount, and hide `.devrig/` from the container workspace.

**Architecture:** `generateClaudeMd()` produces two files (host + container) from the same user content using the existing sentinel system. `compose.yml` shadow-mounts the container version over `/workspace/CLAUDE.md:ro` and masks `/workspace/.devrig/` with a named volume. `devrig start` regenerates the container version before compose up.

**Tech Stack:** Node.js (ESM), Docker Compose YAML, node:test.

**Spec:** `docs/superpowers/specs/2026-04-06-claudemd-isolation-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/init.js` | Modify | `generateClaudeMd()` writes two files; export sentinel constants |
| `scaffold/compose.yml` | Modify | Add shadow mount + mask volume |
| `src/launcher.js` | Modify | Regenerate container CLAUDE.md before compose up |
| `src/update.js` | Modify | Regenerate container CLAUDE.md after scaffold update |
| `test/init.test.js` | Modify | Tests for two-file generation |
| `test/scaffold.test.js` | Modify | Tests for compose.yml mounts |
| `test/docker.test.js` | Modify | Container isolation integration tests |

---

## Phase 1: Two-File Generation

### Task 1: Refactor `generateClaudeMd` to produce two files

**Files:**
- Modify: `src/init.js:12-58`
- Modify: `test/init.test.js:122-164`

- [ ] **Step 1: Write failing tests for two-file generation**

Replace the entire `CLAUDE.md generation` describe block in `test/init.test.js` with:

```js
describe('CLAUDE.md generation', () => {
  let tmp;
  const cfg = { tool: 'claude', dev_server_port: 3000, bridge_enabled: true, bridge_port: 9229 };

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('creates host CLAUDE.md with host devrig block', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    const content = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('<!-- devrig:start -->'));
    assert.ok(content.includes('<!-- devrig:end -->'));
    assert.ok(content.includes('containerized AI development'));
    assert.ok(content.includes('devrig start'));
    assert.ok(content.includes('devrig doctor'));
    assert.ok(!content.includes('You are running inside a devrig Docker container'));
  });

  it('creates container CLAUDE.md with container devrig block', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    const content = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('<!-- devrig:start -->'));
    assert.ok(content.includes('You are running inside a devrig Docker container'));
    assert.ok(content.includes('http://localhost:3000'));
    assert.ok(content.includes('enabled (port 9229)'));
    assert.ok(content.includes('Git push is blocked'));
  });

  it('preserves user content in both files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    writeFileSync(join(tmp, 'CLAUDE.md'), '# My Project\n\nExisting content.\n');
    generateClaudeMd(tmp, cfg);
    const host = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    const container = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    assert.ok(host.startsWith('# My Project'));
    assert.ok(host.includes('Existing content.'));
    assert.ok(container.startsWith('# My Project'));
    assert.ok(container.includes('Existing content.'));
  });

  it('replaces devrig section on re-run', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    generateClaudeMd(tmp, {
      tool: 'claude',
      dev_server_port: 8080,
      bridge_enabled: false,
      bridge_port: 9229,
    });
    const host = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    const container = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    // Host block doesn't change with port — it's generic
    assert.equal(host.split('<!-- devrig:start -->').length - 1, 1);
    // Container block should reflect new config
    assert.ok(container.includes('http://localhost:8080'));
    assert.ok(!container.includes('http://localhost:3000'));
    assert.ok(container.includes('disabled'));
    assert.equal(container.split('<!-- devrig:start -->').length - 1, 1);
  });

  it('container version updates when host has new user content', () => {
    tmp = mkdtempSync(join(tmpdir(), 'devrig-agents-'));
    mkdirSync(join(tmp, '.devrig'), { recursive: true });
    generateClaudeMd(tmp, cfg);
    // Simulate user editing CLAUDE.md on host
    let host = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    host = '# Updated Title\n\n' + host;
    writeFileSync(join(tmp, 'CLAUDE.md'), host);
    // Re-generate
    generateClaudeMd(tmp, cfg);
    const container = readFileSync(join(tmp, '.devrig', 'CLAUDE.md'), 'utf8');
    assert.ok(container.includes('# Updated Title'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/init.test.js
```

Expected: Failures — `generateClaudeMd` doesn't create `.devrig/CLAUDE.md` yet, and host CLAUDE.md still contains container text.

- [ ] **Step 3: Implement two-file generation**

Replace the `generateClaudeMd` function in `src/init.js` (lines 15-58) with:

```js
/**
 * Generates or updates devrig sections in both host and container CLAUDE.md files.
 * Host CLAUDE.md gets generic devrig instructions.
 * Container .devrig/CLAUDE.md gets container-specific instructions (workspace, ports, etc).
 * User content outside the devrig sentinels is preserved in both.
 * @param {string} projectDir
 * @param {{ tool: string, dev_server_port: number, bridge_enabled: boolean, bridge_port: number }} cfg
 */
export function generateClaudeMd(projectDir, cfg) {
  const claudeMdPath = join(projectDir, 'CLAUDE.md');
  const containerClaudeMdPath = join(projectDir, '.devrig', 'CLAUDE.md');

  const hostBlock = [
    DEVRIG_START,
    '## devrig',
    '',
    'This project uses devrig for containerized AI development.',
    '',
    'Available commands:',
    '- `devrig start` — launch a container session',
    '- `devrig stop` — stop the running session',
    '- `devrig doctor` — check system prerequisites',
    '- `devrig logs` — view container and dev server logs',
    '- `devrig exec` — open a shell in the running container',
    '- `devrig update` — update scaffold files to latest version',
    '',
    'Do not modify files in `.devrig/` directly — use `devrig update` to sync scaffold changes.',
    DEVRIG_END,
  ].join('\n');

  const containerBlock = [
    DEVRIG_START,
    '## devrig',
    '',
    'You are running inside a devrig Docker container.',
    '',
    `- **Workspace:** /workspace`,
    `- **Dev server:** http://localhost:${cfg.dev_server_port}`,
    `- **Chrome bridge:** ${cfg.bridge_enabled ? `enabled (port ${cfg.bridge_port})` : 'disabled'}`,
    '',
    'On first message, check if you have the "Claude in Chrome" MCP tool available.',
    'If YES: use it to navigate to the dev server URL below and confirm the connection.',
    `If NO: tell the user to type /exit and run "devrig start" again — Chrome MCP activates on the second launch.`,
    '',
    `Dev server URL: http://localhost:${cfg.dev_server_port}?agent=${cfg.tool}`,
    'Do NOT use WebFetch or Fetch for this URL — they cannot reach localhost.',
    '',
    'Git push is blocked inside this container. Make commits freely — the user will',
    'review and push from the host.',
    DEVRIG_END,
  ].join('\n');

  // Read existing user content from host CLAUDE.md
  let userContent = '';
  if (existsSync(claudeMdPath)) {
    const existing = readFileSync(claudeMdPath, 'utf8');
    const startIdx = existing.indexOf(DEVRIG_START);
    const endIdx = existing.indexOf(DEVRIG_END);
    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + DEVRIG_END.length);
      userContent = before + after;
    } else {
      userContent = existing;
    }
  }

  // Write host CLAUDE.md
  const hostContent = userContent
    ? spliceBlock(userContent, hostBlock)
    : hostBlock + '\n';
  writeFileSync(claudeMdPath, hostContent);

  // Write container CLAUDE.md
  const containerContent = userContent
    ? spliceBlock(userContent, containerBlock)
    : containerBlock + '\n';
  writeFileSync(containerClaudeMdPath, containerContent);

  log('Generated CLAUDE.md (host + container)');
}

/**
 * Splices a devrig block into user content. If the content already has sentinels,
 * replaces the block. Otherwise appends it.
 * @param {string} userContent
 * @param {string} block
 * @returns {string}
 */
function spliceBlock(userContent, block) {
  const startIdx = userContent.indexOf(DEVRIG_START);
  const endIdx = userContent.indexOf(DEVRIG_END);
  if (startIdx !== -1 && endIdx !== -1) {
    return userContent.slice(0, startIdx) + block + userContent.slice(endIdx + DEVRIG_END.length);
  }
  const sep = userContent.endsWith('\n') ? '\n' : '\n\n';
  return userContent + sep + block + '\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/init.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All 77+ tests pass. Some existing e2e tests that call `generateClaudeMd` may need the `.devrig` directory to exist — if they fail, check whether the test creates `.devrig/` before calling `generateClaudeMd`. Fix any failures.

- [ ] **Step 6: Commit**

```bash
git add src/init.js test/init.test.js
git commit -m "feat: generate separate host and container CLAUDE.md files"
```

---

## Phase 2: Compose Changes

### Task 2: Add shadow mount and mask volume to compose.yml

**Files:**
- Modify: `scaffold/compose.yml`
- Modify: `test/scaffold.test.js`

- [ ] **Step 1: Write failing tests**

Add to the `compose.yml` describe block in `test/scaffold.test.js`:

```js
    it('shadow-mounts container CLAUDE.md over host version', () => {
      assert.ok(compose.includes('./.devrig/CLAUDE.md:/workspace/CLAUDE.md:ro'));
    });

    it('masks .devrig/ with named volume', () => {
      assert.ok(compose.includes('devrig-mask:/workspace/.devrig'));
    });

    it('defines devrig-mask volume', () => {
      // Check top-level volumes section has devrig-mask
      const volumesSection = compose.slice(compose.lastIndexOf('volumes:'));
      assert.ok(volumesSection.includes('devrig-mask:'));
    });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/scaffold.test.js
```

Expected: 3 new tests fail.

- [ ] **Step 3: Update compose.yml**

In `scaffold/compose.yml`, add the two new volume entries to the service volumes list (after the existing `./.devrig/home:/home/dev` line):

```yaml
      - ./.devrig/CLAUDE.md:/workspace/CLAUDE.md:ro
      - devrig-mask:/workspace/.devrig
```

And add `devrig-mask:` to the top-level volumes section:

```yaml
volumes:
  node_modules:
    labels:
      devrig.project: ${DEVRIG_PROJECT:-my-project}
  devrig-mask:
```

The full volumes section of the service should now be:

```yaml
    volumes:
      - .:/workspace
      - node_modules:/workspace/node_modules
      - ./.devrig/home:/home/dev
      - ./.devrig/CLAUDE.md:/workspace/CLAUDE.md:ro
      - devrig-mask:/workspace/.devrig
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/scaffold.test.js
```

Expected: All scaffold tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add scaffold/compose.yml test/scaffold.test.js
git commit -m "feat: shadow-mount container CLAUDE.md and mask .devrig/ in compose"
```

---

## Phase 3: Regeneration on Start and Update

### Task 3: Regenerate container CLAUDE.md in `devrig start`

**Files:**
- Modify: `src/launcher.js:80-86`

- [ ] **Step 1: Add import**

At the top of `src/launcher.js`, add `generateClaudeMd` to the import from `./init.js`:

```js
import { generateClaudeMd } from './init.js';
```

This is a new import line — `launcher.js` does not currently import from `init.js`.

- [ ] **Step 2: Add regeneration call**

In `src/launcher.js`, after the scaffold staleness check (line 85: `checkScaffoldStaleness(projectDir);`) and before the CLI flag parsing (line 88: `const { values: args } = parseArgs({`), add:

```js
  // -- Step 2c: Regenerate container CLAUDE.md before compose up ---------------
  try {
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not regenerate container CLAUDE.md');
  }
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npm test
```

Expected: All tests pass. This change only runs at launch time and is wrapped in try/catch.

- [ ] **Step 4: Commit**

```bash
git add src/launcher.js
git commit -m "feat: regenerate container CLAUDE.md on devrig start"
```

---

### Task 4: Regenerate container CLAUDE.md in `devrig update`

**Files:**
- Modify: `src/update.js:1-5,100-112`

- [ ] **Step 1: Add import**

At the top of `src/update.js`, add to the existing import from `./config.js`:

```js
import { resolveProjectDir, getPackageVersion, loadConfig } from './config.js';
```

(Add `loadConfig` to the existing destructure.)

And add a new import:

```js
import { generateClaudeMd } from './init.js';
```

- [ ] **Step 2: Add regeneration after scaffold update**

In `src/update.js`, after the version marker write (line 110: `writeFileSync(join(devrigDir, '.devrig-version'), getPackageVersion() + '\n');`) and before `log('Version marker updated.');`, add:

```js
  // Regenerate container CLAUDE.md with updated scaffold
  try {
    const cfg = loadConfig(projectDir);
    generateClaudeMd(projectDir, cfg);
  } catch {
    log('WARNING: Could not regenerate container CLAUDE.md');
  }
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/update.js
git commit -m "feat: regenerate container CLAUDE.md on devrig update"
```

---

## Phase 4: Docker Integration Tests

### Task 5: Test container isolation

**Files:**
- Modify: `test/docker.test.js`

- [ ] **Step 1: Add isolation test to compose runtime verification**

In `test/docker.test.js`, inside the `compose runtime verification` describe block, after the existing tmpfs test, add:

```js
  it('.devrig/ is hidden from container workspace', () => {
    // The devrig-mask volume should hide .devrig/ contents
    const output = composeExec('ls', '/workspace/.devrig/');
    // Should be empty or only contain the volume's initial empty state
    assert.ok(!output.includes('Dockerfile'), '.devrig/Dockerfile should not be visible');
    assert.ok(!output.includes('entrypoint.sh'), '.devrig/entrypoint.sh should not be visible');
    assert.ok(!output.includes('home'), '.devrig/home should not be visible');
  });

  it('container sees container version of CLAUDE.md', () => {
    const output = composeExec('cat', '/workspace/CLAUDE.md');
    assert.ok(output.includes('You are running inside a devrig Docker container'),
      'container should see container CLAUDE.md');
    assert.ok(!output.includes('containerized AI development'),
      'container should not see host CLAUDE.md content');
  });
```

Note: These tests depend on `.devrig/CLAUDE.md` existing in the test project. Update the `before` hook in `compose runtime verification` to generate it:

After `cpSync(scaffoldDir, devrigDir, { recursive: true });`, add:

```js
    // Generate container CLAUDE.md for shadow mount test
    writeFileSync(join(devrigDir, 'CLAUDE.md'), [
      '<!-- devrig:start -->',
      '## devrig',
      '',
      'You are running inside a devrig Docker container.',
      '',
      '- **Workspace:** /workspace',
      '- **Dev server:** http://localhost:3000',
      '- **Chrome bridge:** disabled',
      '',
      'Git push is blocked inside this container. Make commits freely — the user will',
      'review and push from the host.',
      '<!-- devrig:end -->',
    ].join('\n') + '\n');
```

Also create a host CLAUDE.md in the project root for the shadow mount to work:

```js
    // Create host CLAUDE.md (will be shadowed by container version)
    writeFileSync(join(tmpDir, 'CLAUDE.md'), [
      '<!-- devrig:start -->',
      '## devrig',
      '',
      'This project uses devrig for containerized AI development.',
      '<!-- devrig:end -->',
    ].join('\n') + '\n');
```

Add `writeFileSync` to the existing `import` at the top of `test/docker.test.js` if not already present.

- [ ] **Step 2: Run Docker integration tests**

```bash
node --test test/docker.test.js
```

Expected: All tests pass including the two new ones. If the `.devrig/` mask test fails because the directory shows contents, check that `devrig-mask` volume is defined in `scaffold/compose.yml`.

- [ ] **Step 3: Commit**

```bash
git add test/docker.test.js
git commit -m "test: add container CLAUDE.md isolation and .devrig/ masking tests"
```

---

## Phase 5: Update Init Summary and E2E

### Task 6: Update init summary output

**Files:**
- Modify: `src/init.js:142-152`

- [ ] **Step 1: Update the summary text**

In `src/init.js`, replace the summary line for CLAUDE.md:

```js
  console.log('  CLAUDE.md          Instructions for Claude Code (auto-loaded on session start)');
```

with:

```js
  console.log('  CLAUDE.md          Instructions for host Claude Code');
  console.log('  .devrig/CLAUDE.md  Instructions for container Claude Code (shadow-mounted)');
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/init.js
git commit -m "chore: update init summary to mention both CLAUDE.md files"
```

---

### Task 7: Update E2E test for two-file generation

**Files:**
- Modify: `test/e2e.test.js`

- [ ] **Step 1: Add assertion to existing e2e init test**

In `test/e2e.test.js`, inside the `scaffolds a project and generates config` test, after the existing CLAUDE.md assertions, add:

```js
      // Verify container CLAUDE.md generated
      assert.ok(existsSync(join(tmpDir, '.devrig', 'CLAUDE.md')), 'container CLAUDE.md exists');
      const containerClaudeMd = readFileSync(join(tmpDir, '.devrig', 'CLAUDE.md'), 'utf8');
      assert.ok(containerClaudeMd.includes('You are running inside'),
        'container CLAUDE.md has container instructions');
```

Also verify the host CLAUDE.md has host content:

```js
      // Verify host CLAUDE.md has host instructions
      const hostClaudeMd = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf8');
      assert.ok(hostClaudeMd.includes('containerized AI development'),
        'host CLAUDE.md has host instructions');
      assert.ok(!hostClaudeMd.includes('You are running inside'),
        'host CLAUDE.md should not have container instructions');
```

- [ ] **Step 2: Run e2e tests**

```bash
node --test test/e2e.test.js
```

Expected: All tests pass.

- [ ] **Step 3: Run full test suite**

```bash
npm test && npm run test:docker
```

Expected: Everything green.

- [ ] **Step 4: Commit**

```bash
git add test/e2e.test.js
git commit -m "test: verify e2e init produces both host and container CLAUDE.md"
```

---

## Final Verification

After all tasks, verify:

1. `npm test` — all unit/integration tests pass
2. `npm run test:docker` — all Docker tests pass including isolation checks
3. `git log --oneline` — 7 clean commits for this feature
4. The host `CLAUDE.md` has generic devrig instructions (no container-specific text)
5. `.devrig/CLAUDE.md` has container-specific instructions
6. `scaffold/compose.yml` has shadow mount and mask volume
7. `devrig start` regenerates `.devrig/CLAUDE.md` before compose up
8. `devrig update` regenerates `.devrig/CLAUDE.md` after scaffold sync
