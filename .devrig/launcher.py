#!/usr/bin/env python3
"""launcher.py — Config-driven orchestrator for Claude Code in Docker.

Called via: ./devrig claude [flags]

Reads devrig.toml and starts everything needed for a Claude Code session:
  1. Docker container (with auto-rebuild detection)
  2. Chrome bridge relay (optional — bridge-host.cjs on host)
  3. Dev server (optional — configurable command on host)
  4. Browser pointed at dev server (optional)
  5. Claude Code inside the container (direct TTY passthrough)

On exit (Ctrl+C or Claude /exit), cleans up all background processes and the container.
"""

import argparse
import atexit
import hashlib
import os
import platform
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# ── Fixed paths ──────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
BRIDGE_SCRIPT = SCRIPT_DIR / "bridge-host.cjs"
TTY_TUNNEL = SCRIPT_DIR / "tty-tunnel.py"
CONFIG_FILE = "devrig.toml"
BUILD_LABEL = "devrig.build.hash"

# ── Runtime state (populated by main → init_variant) ────────────────────────

_cfg: dict = {}
_variant: str = "native"
_compose_file: str = ""
_service: str = ""
_image: str = ""
_dockerfile: str = ""

_bridge_proc: subprocess.Popen | None = None
_dev_server_proc: subprocess.Popen | None = None
_cleanup_done = False


# ── Helpers ──────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    """Print a launcher-prefixed message."""
    print(f"[launcher] {msg}")


def die(msg: str) -> None:
    """Print an error and exit."""
    print(f"[launcher] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# ── Config ───────────────────────────────────────────────────────────────────

def load_config() -> dict:
    """Load devrig.toml and return a normalized config dict."""
    config_path = PROJECT_DIR / CONFIG_FILE
    if not config_path.is_file():
        die(f"Config not found: {config_path}\n"
            f"  Create {CONFIG_FILE} in your project root. See README for format.")

    try:
        import tomllib
    except ModuleNotFoundError:
        try:
            import tomli as tomllib  # type: ignore[no-redef]
        except ModuleNotFoundError:
            die("Python 3.11+ required for TOML config (or: pip install tomli)")

    with open(config_path, "rb") as f:
        raw = tomllib.load(f)

    project = raw.get("project", "claude-project")
    dev = raw.get("dev_server", {})
    bridge = raw.get("chrome_bridge", {})
    claude_cfg = raw.get("claude", {})

    return {
        "project": project,
        "service": raw.get("service", "dev"),
        "bridge_enabled": "chrome_bridge" in raw,
        "bridge_port": bridge.get("port", 9229),
        "dev_server_cmd": dev.get("command"),
        "dev_server_port": dev.get("port", 3000),
        "dev_server_timeout": dev.get("ready_timeout", 10),
        "claude_timeout": claude_cfg.get("ready_timeout", 120),
    }


def init_variant(cfg: dict, variant: str) -> None:
    """Set module-level variant globals from config + variant choice."""
    global _cfg, _variant, _compose_file, _service, _image, _dockerfile
    _cfg = cfg
    _variant = variant
    _service = cfg["service"]
    project = cfg["project"]

    if variant == "native":
        _compose_file = ".devrig/compose.yml"
        _image = f"{project}-dev:latest"
        _dockerfile = "Dockerfile"
    else:
        _compose_file = ".devrig/compose.npm.yml"
        _image = f"{project}-dev-npm:latest"
        _dockerfile = "Dockerfile.npm"


# ── Build ────────────────────────────────────────────────────────────────────

def _compose_cmd(*args: str) -> list[str]:
    """Build a docker compose command with the correct project directory and name."""
    return [
        "docker", "compose",
        "--project-directory", ".",
        "--project-name", _cfg["project"],
        "-f", _compose_file,
        *args,
    ]


def build_files() -> list[Path]:
    """Return the list of files that affect the Docker image build."""
    return [
        SCRIPT_DIR / _dockerfile,
        SCRIPT_DIR / "entrypoint.sh",
        SCRIPT_DIR / "container-setup.py",
        PROJECT_DIR / _compose_file,
    ]


def build_hash() -> str:
    """Compute SHA-256 of all build-relevant files concatenated."""
    h = hashlib.sha256()
    for path in build_files():
        h.update(path.read_bytes())
    return h.hexdigest()


def needs_rebuild() -> bool:
    """Compare current file hash against the label baked into the Docker image."""
    try:
        result = subprocess.run(
            ["docker", "inspect", _image,
             "--format", f'{{{{index .Config.Labels "{BUILD_LABEL}"}}}}'],
            capture_output=True, text=True, check=True,
        )
        image_hash = result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        image_hash = "none"
    return build_hash() != image_hash


# ── Environment ──────────────────────────────────────────────────────────────

def load_dotenv() -> None:
    """Parse .env file if it exists. Simple key=value parser."""
    env_path = PROJECT_DIR / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        os.environ[key] = value


def preflight_checks(*, has_dev_server: bool, skip_dev_server: bool) -> None:
    """Verify required tools are available and Docker daemon is running."""
    if not shutil.which("docker"):
        die("docker not found in PATH")
    if not shutil.which("node"):
        die("node not found in PATH")

    result = subprocess.run(["docker", "info"], capture_output=True, text=True)
    if result.returncode != 0:
        die("Docker daemon is not running")

    if has_dev_server and not skip_dev_server:
        dev_bin = shlex.split(_cfg["dev_server_cmd"])[0]
        if not shutil.which(dev_bin):
            die(f"{dev_bin} not found in PATH (needed for dev server)")

    if not (PROJECT_DIR / ".env").is_file():
        log("WARNING: .env not found — copy .env.example and fill in your values")


# ── Services ─────────────────────────────────────────────────────────────────

def start_container() -> None:
    """Start the Docker container via docker compose."""
    log("Starting container...")
    subprocess.run(_compose_cmd("up", "-d", _service), check=True)


def start_bridge() -> subprocess.Popen:
    """Spawn bridge-host.cjs as a background process."""
    global _bridge_proc
    port = _cfg["bridge_port"]
    log(f"Starting Chrome bridge on port {port}...")
    logs_dir = SCRIPT_DIR / "logs"
    logs_dir.mkdir(exist_ok=True)
    log("Bridge logs: .devrig/logs/bridge-host.log")

    env = os.environ.copy()
    env["BRIDGE_LOG_DIR"] = str(logs_dir)
    env["BRIDGE_PORT"] = str(port)

    stderr_log = open(logs_dir / "bridge-host.err", "w")  # noqa: SIM115
    proc = subprocess.Popen(
        ["node", str(BRIDGE_SCRIPT)],
        stdin=subprocess.DEVNULL,
        env=env,
        stderr=stderr_log,
    )

    time.sleep(1)
    if proc.poll() is not None:
        # Show stderr to help diagnose the failure
        stderr_log.flush()
        try:
            err = (logs_dir / "bridge-host.err").read_text().strip()
        except OSError:
            err = ""
        msg = f"bridge-host failed to start (port {port} may be in use)"
        if err:
            msg += f"\n  stderr: {err}"
        die(msg)

    _bridge_proc = proc
    return proc


def start_dev_server() -> subprocess.Popen | None:
    """Spawn the dev server as a background process and wait for it to be ready."""
    global _dev_server_proc
    cmd_str = _cfg["dev_server_cmd"]
    port = _cfg["dev_server_port"]
    timeout = _cfg["dev_server_timeout"]

    log(f"Starting dev server: {cmd_str}")
    logs_dir = SCRIPT_DIR / "logs"
    logs_dir.mkdir(exist_ok=True)
    log("Dev server logs: .devrig/logs/dev-server.log")

    log_file = open(logs_dir / "dev-server.log", "w")  # noqa: SIM115
    cmd = shlex.split(cmd_str)
    env = os.environ.copy()
    env["PORT"] = str(port)
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=log_file,
        stderr=log_file,
        env=env,
    )
    _dev_server_proc = proc

    # Poll for readiness
    url = f"http://localhost:{port}"
    for _ in range(1, timeout + 1):
        if proc.poll() is not None:
            die("Dev server exited unexpectedly")
        try:
            urllib.request.urlopen(url, timeout=1)
            log(f"Dev server ready at {url}")
            break
        except Exception:
            time.sleep(1)
    else:
        log(f"WARNING: Dev server did not respond within {timeout}s — continuing anyway")

    return proc


def open_browser(url: str) -> None:
    """Open a URL in Chrome (required for the Claude in Chrome extension)."""
    system = platform.system()
    if system == "Darwin":
        # Prefer stable, fall back to Canary/Dev/Chromium
        for app in ("Google Chrome", "Google Chrome Canary", "Google Chrome Dev", "Chromium"):
            if (Path("/Applications") / f"{app}.app").exists():
                subprocess.Popen(["open", "-a", app, url])
                return
        log(f"Chrome not found — open {url} in Chrome manually")
    elif system == "Linux":
        for chrome in ("google-chrome", "google-chrome-stable", "google-chrome-unstable",
                        "google-chrome-canary", "chromium-browser", "chromium"):
            if shutil.which(chrome):
                subprocess.Popen([chrome, url],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
        log(f"Chrome not found — open {url} in Chrome manually")
    else:
        log(f"Open {url} in Chrome")


# ── Readiness ────────────────────────────────────────────────────────────────

def _print_new_log_lines(log_path: Path, last_pos: int) -> int:
    """Print new lines from the entrypoint log since *last_pos*."""
    if not log_path.is_file():
        return last_pos
    try:
        with open(log_path) as f:
            f.seek(last_pos)
            new_content = f.read()
            if new_content:
                for line in new_content.splitlines():
                    line = line.rstrip()
                    if line:
                        print(f"  [container] {line}")
            return f.tell()
    except OSError:
        return last_pos


def wait_for_claude(timeout: int | None = None) -> None:
    """Block until the container entrypoint has finished setting up Claude Code.

    Polls for a sentinel file written by container-setup.py on the bind-mounted
    .devrig/home/.claude/logs/ directory.  While waiting, tails the entrypoint log so the
    user can see installation progress.
    """
    if timeout is None:
        timeout = _cfg.get("claude_timeout", 120)
    sentinel = SCRIPT_DIR / "home" / ".claude" / "logs" / ".setup-ready"
    entrypoint_log = SCRIPT_DIR / "home" / ".claude" / "logs" / "entrypoint.log"

    log("Waiting for Claude Code to be ready in container...")

    # Start reading from current end of log to skip old content.
    last_pos = 0
    if entrypoint_log.is_file():
        last_pos = entrypoint_log.stat().st_size

    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if sentinel.is_file():
            last_pos = _print_new_log_lines(entrypoint_log, last_pos)
            log("Claude Code is ready.")
            return
        last_pos = _print_new_log_lines(entrypoint_log, last_pos)
        time.sleep(0.5)

    die(f"Claude Code not ready after {timeout}s — "
        "check .devrig/home/.claude/logs/entrypoint.log")


# ── Cleanup ──────────────────────────────────────────────────────────────────

def cleanup() -> None:
    """Shut down bridge, dev server, and the Docker container."""
    global _cleanup_done
    if _cleanup_done:
        return
    _cleanup_done = True

    print("")
    log("Shutting down...")

    if _bridge_proc is not None:
        try:
            if _bridge_proc.poll() is None:
                log(f"Stopping Chrome bridge (PID {_bridge_proc.pid})")
                _bridge_proc.terminate()
        except Exception:
            pass

    if _dev_server_proc is not None:
        try:
            if _dev_server_proc.poll() is None:
                log(f"Stopping dev server (PID {_dev_server_proc.pid})")
                _dev_server_proc.terminate()
        except Exception:
            pass

    # Wait for background processes to exit
    for proc in (_bridge_proc, _dev_server_proc):
        if proc is not None:
            try:
                proc.wait(timeout=5)
            except Exception:
                pass

    log("Stopping Docker container...")
    try:
        subprocess.run(_compose_cmd("down"), capture_output=True, timeout=30)
    except Exception:
        pass

    log("Done.")


def _signal_handler(signum: int, _frame) -> None:
    """Handle SIGINT/SIGTERM by cleaning up and exiting."""
    cleanup()
    sys.exit(128 + signum)


# ── TTY exec ─────────────────────────────────────────────────────────────────

def exec_claude(*, tunnel: bool = False) -> None:
    """Fork and exec docker exec for direct TTY passthrough.

    Uses `docker exec` directly (not `docker compose exec`) to eliminate the
    compose Go relay binary from the keystroke path.  The child replaces itself
    with docker via execvp, giving it unmediated access to the host terminal —
    no Python process buffering keystrokes in between.  The parent waits
    silently, then runs cleanup when the child exits.

    When tunnel=True, routes through tty-tunnel.py which logs every byte
    flowing in both directions to .devrig/logs/tty-tunnel.log for diagnostics.
    """
    claude_params_raw = os.environ.get("CLAUDE_PARAMS", "")
    claude_params = shlex.split(claude_params_raw) if claude_params_raw else []

    log("Connecting to Claude Code in container...")
    log(f"CLAUDE_PARAMS: {claude_params_raw or '<none>'}")
    if tunnel:
        log("TTY tunnel ENABLED — logging to .devrig/logs/tty-tunnel.log")
    print("", flush=True)

    # Use docker exec directly (not docker compose exec) — eliminates the
    # compose Go relay binary from the keystroke path for lower TTY latency.
    container_id = subprocess.run(
        _compose_cmd("ps", "-q", _service),
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if not container_id:
        die(f"Container {_service} is not running — start it with: "
            f"docker compose -f {_compose_file} up -d")

    docker_cmd = ["docker", "exec", "-it", container_id, "claude", *claude_params]

    if tunnel:
        cmd = [sys.executable, str(TTY_TUNNEL), *docker_cmd]
    else:
        cmd = docker_cmd

    # Flush all buffered output before fork — prevents buffer duplication
    # (the child inherits the parent's memory, including unflushed buffers).
    sys.stdout.flush()
    sys.stderr.flush()

    # We handle cleanup manually in the parent — remove the atexit hook.
    atexit.unregister(cleanup)

    child = os.fork()
    if child == 0:
        # ── Child: become docker exec (or tty-tunnel wrapping it) ──
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        os.execvp(cmd[0], cmd)
        sys.exit(127)  # only reached if execvp fails

    # ── Parent: wait quietly, then clean up ──
    # Ignore SIGINT so Ctrl+C reaches only the foreground docker process.
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    # Forward SIGTERM to the child so `kill <launcher-pid>` still works.
    def _forward_sigterm(*_):
        try:
            os.kill(child, signal.SIGTERM)
        except OSError:
            pass
    signal.signal(signal.SIGTERM, _forward_sigterm)

    _, status = os.waitpid(child, 0)
    cleanup()
    sys.exit(os.waitstatus_to_exitcode(status))


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    cfg = load_config()
    has_dev_server = cfg["dev_server_cmd"] is not None

    parser = argparse.ArgumentParser(
        description="Start a Claude Code session inside Docker.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Environment (.env):\n"
            "  CLAUDE_PARAMS   Flags passed to claude "
            "(e.g. --dangerously-skip-permissions --chrome)\n\n"
            "Notes:\n"
            "  - Rebuild also updates Claude Code to the latest version.\n"
            "  - Use --npm to use the npm installer instead of native.\n"
            + ("  - The Chrome extension (Claude in Chrome) must be installed "
               "in your browser.\n" if cfg["bridge_enabled"] else "")
        ),
    )
    parser.add_argument("--npm", action="store_true",
                        help="Use the npm Claude Code installer instead of native")
    parser.add_argument("--rebuild", action="store_true",
                        help="Rebuild the Docker image before starting")
    parser.add_argument("--no-chrome", action="store_true",
                        help="Skip Chrome bridge and browser launch")
    if has_dev_server:
        parser.add_argument("--no-dev-server", action="store_true",
                            help="Skip starting the dev server")
    parser.add_argument("--tunnel", action="store_true",
                        help="Route TTY through tty-tunnel.py "
                        "(logs all bytes to .devrig/logs/tty-tunnel.log)")
    args = parser.parse_args()

    skip_dev_server = getattr(args, "no_dev_server", False)

    # Initialize variant globals from config
    init_variant(cfg, "npm" if args.npm else "native")

    # Load environment variables from .env
    load_dotenv()
    os.environ["DEVRIG_PROJECT"] = cfg["project"]
    os.chdir(PROJECT_DIR)

    # Preflight
    preflight_checks(has_dev_server=has_dev_server, skip_dev_server=skip_dev_server)

    # Register cleanup
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)
    atexit.register(cleanup)

    # Step 1: Check / build Docker image (auto-rebuild if config changed)
    if args.rebuild or needs_rebuild():
        reason = "--rebuild" if args.rebuild else "build config changed"
        log(f"Building Docker image ({reason})...")
        subprocess.run(
            _compose_cmd("build", "--build-arg", f"BUILD_HASH={build_hash()}"),
            check=True,
        )
        log("Build complete.")

    # Step 2: Start Docker container
    start_container()

    # Step 3: Start Chrome bridge + browser (if configured and not skipped)
    skip_chrome = args.no_chrome
    if cfg["bridge_enabled"] and not skip_chrome:
        start_bridge()

    # Step 4: Start dev server (if configured)
    if has_dev_server and not skip_dev_server:
        start_dev_server()

    # Step 5: Open browser
    if not skip_chrome:
        if has_dev_server and not skip_dev_server:
            log("Opening browser...")
            open_browser(f"http://localhost:{cfg['dev_server_port']}")
        elif has_dev_server:
            log("Skipping browser (dev server not started)")

    # Step 6: Wait for container setup to finish (Claude Code install + bridge)
    wait_for_claude()

    # Step 7: Exec into container with Claude
    exec_claude(tunnel=args.tunnel)

    # When the user exits Claude, atexit fires cleanup.


if __name__ == "__main__":
    main()
