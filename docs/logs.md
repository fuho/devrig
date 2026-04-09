# Logs

Devrig creates several log files across the host and container. All logs are plain text unless noted.

## Log Locations

| Log               | Path                                           | Creator                       | Contents                                      |
| ----------------- | ---------------------------------------------- | ----------------------------- | --------------------------------------------- |
| Dev server        | `.devrig/logs/dev-server.log`                  | `src/launcher.js`             | Dev server stdout/stderr                      |
| Bridge errors     | `.devrig/logs/bridge-host.err`                 | `src/launcher.js`             | Chrome bridge stderr                          |
| Container startup | `{envDir}/home/.claude/logs/entrypoint.log`    | `scaffold/entrypoint.sh`      | Container setup output                        |
| Setup sentinel    | `{envDir}/home/.claude/logs/.setup-ready`      | `scaffold/container-setup.js` | Empty file signaling setup complete           |
| Devrig server     | `{envDir}/home/.claude/logs/devrig-server.log` | `scaffold/container-setup.js` | Devrig dashboard server output                |
| Traffic captures  | `{envDir}/mitmproxy/logs/*.mitm`               | mitmproxy sidecar             | Binary HTTP/S capture files (hourly rotation) |

`{envDir}` is the resolved environment directory — `~/.devrig/shared/` for the shared environment, or `.devrig/` for `environment = "local"`.

## Viewing Logs

```bash
devrig logs                  # Dev server + container logs
devrig logs --dev-server     # Dev server only
devrig logs --container      # Container logs only (via docker logs)
devrig logs --network        # mitmproxy log locations and recent captures
devrig logs -f               # Follow container logs (like tail -f)
```

## Traffic Captures

mitmproxy writes `.mitm` capture files with hourly rotation (e.g. `traffic-2026-04-08_14.mitm`). These are stored as a bind mount at `{envDir}/mitmproxy/logs/` and persist across container restarts and `devrig stop`/`devrig start` cycles.

Analyze captures offline:

```bash
mitmproxy -r traffic-2026-04-08_14.mitm        # Interactive TUI
mitmdump -r traffic-2026-04-08_14.mitm          # Dump to stdout
mitmdump -r <file> --set hardump=output.har     # Convert to HAR
```

The mitmproxy web UI at `http://localhost:8081` (password: `devrig`) shows live traffic during a session.

## Cleanup Lifecycle

| Action                        | Host logs (`.devrig/logs/`) | Container logs (`{envDir}/home/`) | Traffic captures (`{envDir}/mitmproxy/logs/`) |
| ----------------------------- | --------------------------- | --------------------------------- | --------------------------------------------- |
| `devrig stop`                 | Preserved                   | Preserved                         | Preserved                                     |
| `devrig start`                | Overwritten                 | Appended                          | New hourly files created                      |
| `devrig clean`                | Untouched                   | Untouched                         | Untouched                                     |
| `devrig env reset`            | Untouched                   | Untouched (home/ preserved)       | Untouched (preserved)                         |
| Manual `rm -rf .devrig/logs/` | Deleted                     | Untouched                         | Untouched                                     |
