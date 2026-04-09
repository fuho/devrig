# Network Proxy Architecture

## Overview

Devrig routes all container outbound traffic through a transparent mitmproxy sidecar. This provides traffic inspection, domain blocking, and full HTTPS visibility — while keeping Claude Code functional.

## Architecture

```
Container (dev)                    Host
┌──────────────┐                  ┌──────────────┐
│  Claude Code │                  │  Chrome      │
│  (port 443) ─┼─ network_mode ──┤  Extension   │
│              │  service:mitm    │              │
└──────┬───────┘                  └──────────────┘
       │ iptables REDIRECT                │
       ▼                                  │ NMH socket
┌──────────────┐                  ┌──────────────┐
│  mitmproxy   │                  │  bridge-host │
│  (port 8080) │                  │  (port 9229) │
│  Web UI:8081 │                  │  0.0.0.0 ¹   │
│  API:8082    │                  │              │
└──────┬───────┘                  └──────────────┘
       │
       ▼ internet

¹ bridge-host.cjs defaults to 127.0.0.1; launcher sets BRIDGE_HOST=0.0.0.0
```

## Key Learnings

### Docker DNS NAT Rules

Docker's internal DNS resolver at `127.0.0.11` uses iptables NAT rules to redirect queries to an embedded resolver on a high port. **Flushing the nat OUTPUT chain destroys these rules**, breaking DNS resolution.

Fix: save Docker DNS rules before flush, restore after:

```bash
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)
iptables -t nat -F OUTPUT
echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat || true
```

### host.docker.internal IP Range

OrbStack (macOS) resolves `host.docker.internal` to `0.250.250.254`, which is outside standard private IP ranges (10/8, 172.16/12, 192.168/16). The firewall must explicitly resolve and allow this IP:

```bash
HOST_DOCKER_IP=$(getent hosts host.docker.internal | awk '{print $1}')
iptables -A OUTPUT -d "$HOST_DOCKER_IP" -j ACCEPT
```

### network_mode: service:mitmproxy

When the dev container shares mitmproxy's network namespace:

- Dev container's ports are accessible through the mitmproxy service
- `extra_hosts` must go on the mitmproxy service (Docker rejects it on the shared container)
- The bridge host must listen on `0.0.0.0`, not `127.0.0.1`

### /home/dev Bind Mount

The compose mounts `${DEVRIG_ENV_DIR}/home:/home/dev` which **replaces everything** the Dockerfile puts in `/home/dev`. This affects:

- Claude Code binary (native installer puts it in `~/.local/bin/`)
- zsh config (powerlevel10k puts it in `~/.zshrc`, `~/.p10k.zsh`)

Fix for Claude: install to `/home/dev/.local/`, then copy to `/opt/claude/` and symlink to `/usr/local/bin/`:

```dockerfile
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root
RUN cp -rL /home/dev/.local/share/claude /opt/claude && \
    ln -sf /opt/claude/versions/* /usr/local/bin/claude && \
    chown -R dev:dev /opt/claude /usr/local/bin/claude
USER dev
```

### WebSocket Passthrough

Claude Code v2.1.96 uses `bridge.claudeusercontent.com` as a WebSocket relay for Chrome MCP (instead of the local NMH socket chain). mitmproxy's TLS interception breaks WebSocket connections.

Fix: skip TLS interception for specific domains using `tls_clienthello` hook:

```python
def tls_clienthello(data):
    if _is_passthrough(data.context.server.address[0]):
        data.ignore_connection = True
```

### Blocklist vs Allowlist

An allowlist is impractical for Claude Code — it needs many domains (API, auth, bridge, telemetry, package registries, Chrome relay) and the list changes with each version. A blocklist (default-allow, block specific domains) is more maintainable and doesn't break when Claude adds new services.

The blocklist has evolved into a full rules engine (see [Live Rules Configuration](#live-rules-configuration)) — the term "blocklist" is now shorthand for the default-allow policy with specific block rules.

### mitmproxy 12.x Authentication

mitmproxy 12.x requires web UI authentication by default. If no password is set, a random token is generated on startup (printed to stderr). Set a known password:

```
--set web_password=devrig
```

### Build-time vs Runtime Claude Install

The native installer creates:

- `~/.local/bin/claude` — symlink
- `~/.local/share/claude/versions/<ver>` — 221MB binary

Moving just the symlink doesn't work (target is under the bind mount). Must copy the entire `~/.local/share/claude/` tree to a path outside `/home/dev`.

### Live Rules Configuration

The traffic control dashboard at `/devrig/traffic` provides runtime rule management via an HTTP API on port 8082. Rules are stored as regex patterns and support four actions:

| Type | Action |
|------|--------|
| `block` | Reject the request (`flow.kill()`) |
| `passthrough` | Skip TLS interception (for WebSocket connections etc.) |
| `strip_header` | Remove a header matching the pattern from requests |
| `add_header` | Inject a header into requests matching the URL pattern |

Rules are persisted to `/data/rules.json` inside the mitmproxy container (bind-mounted from `{envDir}/rules/`). The API runs as a daemon thread inside the mitmproxy addon — no separate process needed. Changes take effect immediately on the next request.

#### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/rules` | List all rules |
| `POST` | `/rules` | Create a rule (`{type, match, header?, value?}`) |
| `PUT` | `/rules/{id}` | Update a rule (e.g. `{enabled: false}`) |
| `DELETE` | `/rules/{id}` | Delete a rule |
| `GET` | `/traffic` | SSE stream of live traffic events |
| `GET` | `/traffic/recent` | Last N traffic entries (`?n=50`) |
| `GET` | `/domains` | Domain hit counts (`{host: count}`) |

#### Rule Matching

Rules use regex patterns (`re.IGNORECASE`) matched against the full URL first, then the hostname. First matching enabled rule wins. Default rules use anchored patterns like `(^|\.)datadoghq\.com$` to match exact domains and subdomains without false positives on partial matches.

#### Dashboard

The dashboard at `/devrig/traffic` provides:
- **Live traffic stream** via SSE with pause/resume, domain filtering, and color-coded rows (green=allowed, red=blocked, amber=modified)
- **Domain discovery** — auto-refreshing list of all domains seen, sorted by request count
- **Rules panel** — view, enable/disable, and delete rules
- **Add rule form** — type selector, regex input with client-side validation and match preview, conditional header/value fields

### chrome-native-host Permissions

The shim at `/home/dev/.claude/chrome/chrome-native-host` must be writable (0755). Claude Code's `--chrome` flag updates this file on startup. Making it read-only (0555) causes Claude Code to silently fail to establish the MCP connection.
