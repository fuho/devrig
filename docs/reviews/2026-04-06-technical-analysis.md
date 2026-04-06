# Technical Analysis — Docker & Systems Review

_Reviewed: 2026-04-06, v0.3.0_

## 1. Docker Optimization — MEDIUM

- GitHub CLI installation uses separate apt block — wastes cache (5-10s per rebuild)
- No .dockerignore — build context may include .devrig/home (~1GB)
- `pnpm@latest` installed every build — should pin version
- `vim` and `tree` likely unused — minor bloat

**Quick win:** Combine GitHub CLI into single apt block, pin pnpm version.

## 2. Volume Strategy — HIGH

**CRITICAL: .git fully writable**
- Bind-mounted read-write. Claude can corrupt git history, delete .git, modify index.
- Options: mount .git read-only (breaks commits), overlay, or backup-on-start.

**HIGH: .devrig/home bind-mounted**
- No isolation between config, credentials, and runtime data
- Claude can tamper with its own auth, settings, logs

**MEDIUM: node_modules as named volume**
- Correct for performance, but first-run install can be very slow for large projects
- No pre-population from image layer

## 3. Network Architecture — MEDIUM

- Container has unrestricted internet access (required for npm/pip/Claude updates)
- No egress filtering — acceptable for current use case
- DNS rebinding unmitigated (low risk)

**Verdict:** Network is acceptable as-is. Claude needs internet to function.

## 4. Resource Limits — MEDIUM

Current: 8GB memory, 4 CPUs. Good defaults.

Missing:
- No swap limit (`memswap` not set) — container can exceed 8GB via swap
- No I/O limits — runaway npm install can saturate disk
- No process count limit — fork bomb possible
- No disk quota on node_modules volume

**Recommendation:** Add `memswap: 8g`, `ulimits: { nproc: 512, nofile: 4096 }`, `init: true`.

## 5. Startup Performance — CRITICAL

**Claude Code reinstalls every session (15-30s wasted)**

Timeline: build image (0-60s) → start container (2-5s) → install Claude (15-60s) → bridge setup (0.5s) → sentinel wait (5-30s) → exec (instant).

Total: 40-155s first run, 20-90s subsequent.

**Fix:** Bake Claude Code into image at build time. Only update if stale (>7 days). Saves 15-30s per start.

**Parallelization:** startContainer + setupBridge can run concurrently (saves 2-5s).

## 6. Chrome Bridge Reliability — HIGH

Failure modes:
- Chrome extension crashes → broken connection, no auto-recovery
- NMH socket disappears (Chrome exits) → bridge re-probes on next connection (OK)
- Container socat dies → silently broken, no monitoring
- No reconnection buffer — broken connections fail immediately

**Fix:** Add socat health monitoring, reconnection retry with 5s buffer.

## 7. Platform Compatibility — MEDIUM

- macOS Intel/ARM: works well
- Linux x86/ARM: works well
- Windows WSL2: works with caveats (file sync delays, line endings)
- Alpine Linux: untested (Dockerfile assumes Debian)

## 8. Scaling Limits — MEDIUM

- Small projects (<100MB): fine
- Large monorepos (>1GB node_modules, >5GB .git): degraded performance
- Massive repos (>10GB .git, 50K+ files): not practical

**Recommendation:** Pre-flight checks for repo size, suggest shallow clone for large repos.

## 9. Security Hardening — HIGH

Missing:
- No seccomp profile
- CAP_SYS_ADMIN not dropped
- Root filesystem writable
- No AppArmor/SELinux profile
- Git hooks can execute untrusted code

**Recommendation:** Add `cap_drop: ALL`, `cap_add: [NET_BIND_SERVICE, SYS_CHROOT]`, `security_opt: [no-new-privileges:true]`, sanitize git hooks before container start.

## 10. Unused Docker Features — LOW-MEDIUM

Should add:
- `init: true` — zombie reaping (minimal overhead)
- `tmpfs` for /tmp — faster, more secure
- Cap drop — defense in depth

Already using: healthcheck, labels (good).

## Quick Wins (Implement First)

1. Bake Claude Code into image (saves 15-30s per start)
2. Combine GitHub CLI into single apt block (saves 5-10s build)
3. Add `init: true` to compose (safety)
4. Add `.git` read-only protection or backup
5. Sanitize git hooks before container start
