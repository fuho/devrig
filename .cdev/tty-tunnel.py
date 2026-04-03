#!/usr/bin/env python3
"""tty-tunnel.py — Bidirectional PTY proxy with hex logging.

Wraps any command in a pseudo-terminal and logs every byte flowing
in both directions (IN = keystrokes from you, OUT = output from the
child process).  Designed to diagnose TTY passthrough issues with
Docker exec + TUI apps like Claude Code.

Usage:
    python3 .cdev/tty-tunnel.py docker exec -it <container> claude

Log output goes to logs/tty-tunnel.log (one line per read, with
timestamp, direction, byte count, hex dump, and printable repr).

The proxy is transparent — it sets your terminal to raw mode, relays
bytes 1:1, and restores terminal state on exit.  Window-resize
signals (SIGWINCH) are forwarded to the child PTY.
"""

import datetime
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import tty
from pathlib import Path

# ── Config ───────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
LOG_DIR = PROJECT_DIR / "logs"
LOG_FILE = LOG_DIR / "tty-tunnel.log"
READ_SIZE_IN = 1024   # stdin reads (keystrokes, small)
READ_SIZE_OUT = 16384  # child output reads (escape sequences, larger)


# ── Logging ──────────────────────────────────────────────────────────────────

_log_fh = None


def log_open():
    global _log_fh
    LOG_DIR.mkdir(exist_ok=True)
    _log_fh = open(LOG_FILE, "a")  # noqa: SIM115
    log_meta("=== session start ===")
    log_meta(f"cmd: {sys.argv[1:]}")
    log_meta(f"TERM={os.environ.get('TERM', '<unset>')}")
    try:
        cols, rows = os.get_terminal_size()
        log_meta(f"terminal size: {cols}x{rows}")
    except OSError:
        log_meta("terminal size: <unknown>")


def log_close():
    if _log_fh:
        log_meta("=== session end ===")
        _log_fh.close()


def log_meta(msg: str):
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    _log_fh.write(f"{ts} [META] {msg}\n")
    _log_fh.flush()


def log_data(direction: str, data: bytes):
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    # Show hex in groups of 2 bytes for readability
    hex_str = " ".join(f"{b:02x}" for b in data)
    # Printable representation (replace control chars with dots)
    printable = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
    _log_fh.write(
        f"{ts} [{direction:>3}] ({len(data):5d}B) "
        f"hex=[{hex_str}] "
        f"txt=[{printable}]\n"
    )
    _log_fh.flush()


# ── Terminal helpers ─────────────────────────────────────────────────────────

def get_winsize(fd):
    """Get terminal window size as (rows, cols)."""
    try:
        packed = fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\x00" * 8)
        rows, cols = struct.unpack("HHHH", packed)[:2]
        return rows, cols
    except OSError:
        return 24, 80


def set_winsize(fd, rows, cols):
    """Set terminal window size on a PTY fd."""
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


# ── I/O helpers ─────────────────────────────────────────────────────────────

def _write_all(fd, data):
    """Write all bytes to fd, retrying on short writes."""
    mv = memoryview(data)
    while mv:
        n = os.write(fd, mv)
        mv = mv[n:]


# ── Main loop ────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: tty-tunnel.py <command> [args...]")
        print("Example: tty-tunnel.py docker exec -it CONTAINER claude")
        sys.exit(1)

    cmd = sys.argv[1:]
    log_open()

    # Save original terminal attributes so we can restore on exit
    stdin_fd = sys.stdin.fileno()
    old_attrs = termios.tcgetattr(stdin_fd)

    # Fork with a PTY for the child
    child_pid, child_fd = pty.fork()

    if child_pid == 0:
        # ── Child: exec the target command ──
        os.execvp(cmd[0], cmd)
        # Only reached if execvp fails
        sys.stderr.write(f"tty-tunnel: exec failed: {cmd[0]}\n")
        os._exit(127)

    # ── Parent: relay loop ──

    # Sync initial window size from host terminal → child PTY
    rows, cols = get_winsize(stdin_fd)
    set_winsize(child_fd, rows, cols)
    log_meta(f"initial winsize synced: {cols}x{rows}")

    # Forward SIGWINCH (terminal resize) to the child PTY
    def on_winch(signum, frame):
        r, c = get_winsize(stdin_fd)
        set_winsize(child_fd, r, c)
        # Also signal the child process group
        try:
            os.kill(child_pid, signal.SIGWINCH)
        except OSError:
            pass
        log_meta(f"SIGWINCH forwarded: {c}x{r}")

    signal.signal(signal.SIGWINCH, on_winch)

    # Put host terminal in raw mode (no echo, no line buffering)
    try:
        tty.setraw(stdin_fd)
        log_meta("host terminal set to raw mode")

        while True:
            try:
                rlist, _, _ = select.select([stdin_fd, child_fd], [], [], 0.25)
            except (select.error, InterruptedError):
                continue  # SIGWINCH can interrupt select()

            # Keystrokes from user → child
            if stdin_fd in rlist:
                try:
                    data = os.read(stdin_fd, READ_SIZE_IN)
                except OSError:
                    log_meta("stdin read error — exiting")
                    break
                if not data:
                    log_meta("stdin EOF — exiting")
                    break
                log_data("IN", data)
                try:
                    _write_all(child_fd, data)
                except OSError:
                    log_meta("child write error — child gone?")
                    break

            # Output from child → user's terminal
            if child_fd in rlist:
                try:
                    data = os.read(child_fd, READ_SIZE_OUT)
                except OSError:
                    log_meta("child read error (EOF or process exited)")
                    break
                if not data:
                    log_meta("child EOF — exiting")
                    break
                log_data("OUT", data)
                try:
                    _write_all(sys.stdout.fileno(), data)
                except OSError:
                    log_meta("stdout write error — terminal gone?")
                    break

    finally:
        # Restore terminal to cooked mode no matter what
        termios.tcsetattr(stdin_fd, termios.TCSAFLUSH, old_attrs)
        log_meta("host terminal restored")

        # Reap the child
        try:
            pid, status = os.waitpid(child_pid, os.WNOHANG)
            if pid == 0:
                # Still running — send SIGHUP and wait
                os.kill(child_pid, signal.SIGHUP)
                os.waitpid(child_pid, 0)
                log_meta("child reaped after SIGHUP")
            else:
                exit_code = os.waitstatus_to_exitcode(status)
                log_meta(f"child exited with code {exit_code}")
        except ChildProcessError:
            log_meta("child already reaped")

        log_close()


if __name__ == "__main__":
    main()
