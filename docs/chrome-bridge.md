# Chrome Bridge Architecture

The Chrome bridge allows Claude Code running inside a Docker container to control a Chrome browser on the host. It chains a protocol translator inside the container with a TCP relay on the host to reach Chrome's Native Messaging Host (NMH).

## Signal chain

```
Container:
  Claude Code (--chrome flag)
    | stdio (newline-delimited MCP JSON-RPC)
    v
  chrome-native-host shim (exec node /usr/local/bin/chrome-mcp-bridge.cjs)
    | MCP server translates to NMH protocol
    v
  chrome-mcp-bridge.cjs (protocol translator)
    | Unix socket (4-byte LE length-prefixed JSON)
    v
  socat (UNIX-LISTEN:mcp.sock,fork,reuseaddr -> TCP:host.docker.internal:9229)
    | TCP
    v

Host:
  bridge-host.cjs (TCP:9229 -> Chrome NMH Unix socket)
    | Unix socket
    v
  Chrome NMH binary (/Applications/Claude.app/Contents/Helpers/chrome-native-host)
    | stdin/stdout (Chrome Native Messaging protocol)
    v
  Chrome Extension (Claude in Chrome)
    | Chrome DevTools Protocol
    v
  Chrome Browser
```

## Protocols

Two wire protocols are involved. The bridge translates between them.

### MCP JSON-RPC (container side, stdio)

- **Transport:** newline-delimited JSON on stdin/stdout
- **Format:** JSON-RPC 2.0
- **Methods:** `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`

Request:
```json
{"jsonrpc":"2.0", "method":"tools/call", "params":{"name":"navigate", "arguments":{"url":"https://example.com", "tabId":1}}, "id":3}
```

Response:
```json
{"jsonrpc":"2.0", "id":3, "result":{"content":[{"type":"text", "text":"Navigated to https://example.com"}]}}
```

### NMH wire protocol (socket side, to host)

- **Transport:** 4-byte little-endian length prefix + UTF-8 JSON payload
- **Frame:** `[uint32_le: payload_length][utf8: json_payload]`

| Direction | Type | Example |
|-----------|------|---------|
| Request | `tool_request` | `{"type":"tool_request", "method":"navigate", "params":{"url":"...", "tabId":1}}` |
| Response | result | `{"result":{"content":[...]}}` |
| Response | error | `{"error":{"message":"..."}}` |
| Notification | connected | `{"type":"mcp_connected"}` |
| Notification | disconnected | `{"type":"mcp_disconnected"}` |

## Key files

| File | Role |
|------|------|
| `scaffold/chrome-mcp-bridge.cjs` | Protocol translator (MCP to NMH). Zero dependencies, ~200 lines. Implements MCP server on stdio, translates `tools/call` to NMH `tool_request`. Exports functions for testing. |
| `src/bridge-host.cjs` | Host-side TCP-to-NMH relay. Listens on TCP (default 9229), finds the alphabetically last `.sock` in `/tmp/claude-mcp-browser-bridge-{user}/` (newest by NMH naming convention), pipes bidirectionally. |
| `scaffold/container-setup.js` | Container setup. Writes `chrome-native-host` shim (read-only 0555), starts socat relay, writes MCP server config to `settings.json`. |
| `src/launcher.js` | Starts `bridge-host.cjs`, waits for live NMH socket (up to 15s), injects `--chrome` flag, writes `mcpServers` config. |
| `src/doctor.js` | `checkChromeBridge()` tests NMH socket health in three steps: directory exists, socket accepts connections, socket responds to messages. |

## How --chrome works

Claude Code's `--chrome` flag starts an **in-process Chrome MCP server** that spawns `chrome-native-host` as a stdio subprocess. Both mechanisms work together:

1. `container-setup.js` and `launcher.js` write `mcpServers["claude-in-chrome"]` config in `settings.json`, pointing to the `chrome-native-host` shim
2. The `--chrome` flag is injected into Claude's launch params
3. Claude's in-process server spawns `chrome-native-host` (our shim intercepts this)
4. Claude calls `set_permission_mode` internally (handled by Claude's in-process server, never reaches our bridge)
5. When the LLM calls a Chrome tool, it goes through our bridge to the host NMH

**Claude Code overwrites `chrome-native-host` on every launch** with its own version. We counter this by making the file read-only (`chmod 0555`) in `container-setup.js`, so our shim persists.

## Available Chrome tools (18)

| Tool | Description |
|------|-------------|
| `tabs_context_mcp` | List open tabs and states |
| `tabs_create_mcp` | Create a new tab |
| `navigate` | Navigate a tab to a URL |
| `computer` | 13 actions: left_click, right_click, double_click, triple_click, left_click_drag, key, type, scroll, scroll_to, wait, screenshot, zoom, hover |
| `find` | Find elements by natural language |
| `form_input` | Fill form fields |
| `get_page_text` | Extract page text |
| `gif_creator` | Record screen as GIF |
| `javascript_tool` | Execute JS in page context |
| `read_console_messages` | Read console output |
| `read_network_requests` | Inspect network traffic |
| `read_page` | Read accessibility tree |
| `resize_window` | Resize browser window |
| `shortcuts_list` | List keyboard shortcuts |
| `shortcuts_execute` | Execute a shortcut |
| `switch_browser` | Switch browser windows |
| `update_plan` | Present plan for user approval |
| `upload_image` | Upload image to file input |

Tool definitions are hardcoded in `chrome-mcp-bridge.cjs` for the `tools/list` response, but **all `tools/call` requests are forwarded to Chrome regardless** of tool name. New Chrome tools added by future extension updates work automatically without a bridge update.

## Update resilience

| Component | Update mechanism |
|-----------|-----------------|
| `chrome-mcp-bridge.cjs` | In `SCAFFOLD_FILES` and `buildFiles()`. `devrig update` detects changes, rebuilds on next start. |
| `bridge-host.cjs` | Lives in `src/`, **not** in `SCAFFOLD_FILES` or `buildFiles()`. Updated only via devrig npm package update (`npm install -g devrig`). |
| Protocol version | Hardcoded (`2024-11-05`). Mismatches logged as warnings, not errors. |
| Tool definitions | Hardcoded list for `tools/list`, but all `tools/call` forwarded regardless. |

## Security

- Bridge runs as unprivileged `dev` user inside container
- `chrome-native-host` is read-only (0555) to prevent Claude from overwriting
- TCP bridge binds to `127.0.0.1` only (not `0.0.0.0`)
- Verbose logging truncates content to 500 chars, never logs screenshot base64 data
- No persistent data storage beyond log files

## Troubleshooting

### "No Chrome extension connected"

The most common error. The NMH binary is running but the Chrome extension is not communicating with it.

**Causes in order of likelihood:**

1. **Chrome extension not logged in** — Open Chrome, click Claude extension, log in. This was the root cause during development.
2. **Chrome extension disabled** — Toggle off/on in `chrome://extensions`
3. **Chrome needs restart** — Cmd+Q (not just close window), reopen
4. **Claude Desktop app outdated** — Update Claude.app (ships the NMH binary)
5. **Dual NMH conflict** — Both Claude Desktop and Claude Code install NMH manifests. See [#38533](https://github.com/anthropics/claude-code/issues/38533).

### devrig doctor output

| Message | Meaning | Fix |
|---------|---------|-----|
| `Chrome NMH socket dir not found — is the Claude Chrome extension enabled?` | Extension not creating sockets | Enable extension, log in |
| `No NMH socket files — restart Chrome` | Directory exists, no .sock files | Restart Chrome |
| `NMH socket 72240.sock is stale — restart Chrome` | Connection refused | Restart Chrome |
| `NMH socket 72240.sock accepts connections but not responding — toggle Claude extension off/on in chrome://extensions` | NMH alive, Chrome not attached | Toggle extension |
| `Chrome NMH responding (72240.sock)` | All working | None |

### Log locations

| Log | Path | Notes |
|-----|------|-------|
| Container bridge | `.devrig/home/.claude/logs/chrome-bridge.log` | Written by chrome-mcp-bridge.cjs |
| Host bridge stdout | `.devrig/logs/bridge-host.log` | Written by bridge-host.cjs |
| Host bridge stderr | `.devrig/logs/bridge-host.err` | Errors from bridge-host.cjs |
| MCP protocol | `.devrig/home/.cache/claude-cli-nodejs/-workspace/mcp-logs-claude-in-chrome/*.jsonl` | Written by Claude Code's in-process MCP server |

### Verbose mode

`devrig start --verbose` sets `BRIDGE_VERBOSE=1` in the container environment, which makes `chrome-mcp-bridge.cjs` log every MCP request/response (truncated to 500 chars) and every NMH frame size.

Note: `bridge-host.cjs` on the host does not have a verbose mode. Its logging is always-on at a fixed level.

## Testing

`test/bridge.test.js` covers:

- **NMH frame encoding/parsing**: complete frames, partial frames, multi-frame buffers, unicode, round-trip, edge cases (empty buffer, short buffer)
- **Tool definitions**: count (18), required fields, name uniqueness, critical tools present
- **Subprocess integration**: MCP initialize handshake, tools/list response, tools/call error when NMH disconnected

The full chain (bridge-host.cjs, socat, NMH) is not covered by automated tests — it requires Docker + Chrome and is tested manually via `devrig start`.

## Related issues

- [#38533](https://github.com/anthropics/claude-code/issues/38533) — Chrome MCP fails when Desktop NMH coexists with Code NMH
- [#21299](https://github.com/anthropics/claude-code/issues/21299) — Chrome integration: support remote/SSH usage
- [#25506](https://github.com/anthropics/claude-code/issues/25506) — Chrome extension cannot connect in VS Code DevContainer

## References

- [MCP Tools Specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [noemica-io/open-claude-in-chrome](https://github.com/noemica-io/open-claude-in-chrome) — Open-source reimplementation used as protocol reference
- [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome)
