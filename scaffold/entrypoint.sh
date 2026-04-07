#!/bin/bash
set -e

# The container starts as root (compose.yml user: "root") so we can fix
# ownership of the bind-mounted /home/dev tree.  On Linux native Docker
# (no UID remapping), the host creates files with its own UID; chown
# corrects them so the dev user can write freely.  On macOS this is a
# harmless no-op.

LOG_DIR="/home/dev/.claude/logs"
LOG_FILE="${LOG_DIR}/entrypoint.log"

mkdir -p "$LOG_DIR"
chown -R dev:dev /home/dev

# Redirect stdout/stderr to log file (keep fds for final exec)
exec 3>&1 4>&2
exec >>"$LOG_FILE" 2>&1

# Clear stale sentinel so the host launcher doesn't see a leftover from a
# previous run and skip waiting for setup to finish.
rm -f "${LOG_DIR}/.setup-ready"

# All setup logic runs as the dev user, not root.
gosu dev node /usr/local/bin/container-setup.js

# Restore original stdout/stderr and exec the command as dev.
exec 1>&3 2>&4 3>&- 4>&-
exec gosu dev "$@"
