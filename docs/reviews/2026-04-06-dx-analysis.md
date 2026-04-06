# DX Analysis — Developer Experience Review

_Reviewed: 2026-04-06, v0.3.0_

## 1. First-Time Experience

### Pain Points

**CRITICAL: Port validation silent failures**
- configure.js silently falls back to defaults if user enters invalid port
- User thinks they set port 5000 but gets 3000

**HIGH: First-launch Chrome MCP confusion**
- CLAUDE.md says "check if Chrome MCP available... if no, exit and restart"
- User doesn't know what Chrome MCP looks like, thinks setup failed

**MEDIUM: Template files only copied if no package.json**
- User with existing package.json misses scaffold server.js

## 2. Daily Workflow

**CRITICAL: Port conflicts inconsistent**
- Bridge: dies with "port may be in use" (loud failure)
- Dev server: logs WARNING and continues (silent failure)
- Inconsistent behavior confuses users

**HIGH: Browser opens before Claude ready**
- Browser opens when dev server responds
- Claude may not be ready for another 30-60s
- User sees blank setup page

**HIGH: Dev server timeout too strict**
- Default 10s often too short for large projects
- Warning says "continuing anyway" but Claude can't reach server yet

## 3. Missing Commands

**CRITICAL:**
- `devrig logs` — no way to see container output
- `devrig update` — no way to update scaffold files

**HIGH:**
- `devrig doctor` — no health check command
- `devrig exec` — no way to re-enter container without full restart

**MEDIUM:**
- No pause/resume (stop kills everything)
- No per-session env var overrides
- No Docker resource limits editor

## 4. Project Lifecycle

- Dockerfile customizations lost on re-init (no merge, just overwrite prompt)
- npm packages installed in container don't persist across rebuilds (undocumented)
- No guidance on how Claude accesses project-specific env vars (API keys, etc.)

## 5. Multi-Project Usage

- Works well: separate session.json per project
- Port conflicts if multiple projects use same ports (no auto-assignment)
- `devrig clean --all` handles orphaned resources well

## 6. Team Usage

- `.devrig/` in git works: deterministic scaffold
- Risk: `.devrig-version` staleness not validated, only warned
- Risk: Dockerfile customizations lost if someone re-runs init
- Risk: .env could leak secrets if not in .gitignore

## Top 5 Recommendations

1. Fix port conflict detection — make dev server fail loudly, suggest next available port
2. Add `devrig logs` command
3. Improve first-launch Chrome MCP UX
4. Add `devrig doctor` health check
5. Make Dockerfile customizations persist across re-init
