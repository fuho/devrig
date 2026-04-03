#!/bin/bash
set -e

LOG_DIR="/home/dev/.claude/logs"
LOG_FILE="${LOG_DIR}/entrypoint.log"
mkdir -p "$LOG_DIR"

# Redirect stdout/stderr to log file (keep fds for final exec)
exec 3>&1 4>&2
exec >>"$LOG_FILE" 2>&1

# Clear stale sentinel so the host launcher doesn't see a leftover from a
# previous run and skip waiting for setup to finish.
rm -f "$LOG_DIR/.setup-ready"

# All setup logic lives in Python
python3 /usr/local/bin/container-setup.py

# Restore original stdout/stderr and exec the command
exec 1>&3 2>&4 3>&- 4>&-
exec "$@"
