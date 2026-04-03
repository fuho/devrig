#!/usr/bin/env python3
"""Docker container entrypoint setup: claude-code install/update + Chrome bridge."""

import glob
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

logging.basicConfig(format="[setup] %(asctime)s %(message)s", datefmt="%H:%M:%S", level=logging.INFO)
log = logging.getLogger()

NPM_PKG = "@anthropic-ai/claude-code"
NATIVE_INSTALLER_URL = "https://claude.ai/install.sh"


def _claude_version() -> str:
    return subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.strip()


def install_claude_code_npm():
    """Install/update Claude Code via npm."""
    prefix = os.environ["NPM_CONFIG_PREFIX"]
    pkg_dir = Path(prefix, "lib/node_modules/@anthropic-ai/claude-code")
    temp_glob = str(Path(prefix, "lib/node_modules/@anthropic-ai/.claude-code-*"))

    def cleanup_stale():
        if pkg_dir.exists():
            log.info("Removing stale install: %s", pkg_dir)
            shutil.rmtree(pkg_dir)
        for d in glob.glob(temp_glob):
            log.info("Removing temp dir: %s", d)
            shutil.rmtree(d)

    if shutil.which("claude"):
        log.info("claude found: %s", _claude_version())
        subprocess.run(["npm", "update", "-g", NPM_PKG], capture_output=True)
        log.info("claude after update: %s", _claude_version())
        return

    log.info("claude not found — installing %s", NPM_PKG)
    cleanup_stale()
    try:
        subprocess.run(["npm", "install", "-g", NPM_PKG], check=True)
    except subprocess.CalledProcessError:
        log.warning("First install attempt failed — cleaning cache and retrying")
        subprocess.run(["npm", "cache", "clean", "--force"], capture_output=True)
        cleanup_stale()
        subprocess.run(["npm", "install", "-g", NPM_PKG], check=True)

    log.info("Installed: %s", _claude_version())


def install_claude_code_native():
    """Install/update Claude Code via native installer."""
    if shutil.which("claude"):
        log.info("claude found: %s", _claude_version())
        log.info("Checking for updates...")
        subprocess.run(["claude", "update"], capture_output=True)
        log.info("claude after update: %s", _claude_version())
        return

    log.info("claude not found — installing via native installer")
    subprocess.run(
        ["bash", "-c", f"curl -fsSL {NATIVE_INSTALLER_URL} | bash"],
        check=True,
    )
    log.info("Installed: %s", _claude_version())


def install_claude_code():
    method = os.environ.get("CLAUDE_INSTALL_METHOD", "npm")
    if method == "native":
        install_claude_code_native()
    else:
        install_claude_code_npm()


def setup_chrome_bridge():
    bridge_port = os.environ.get("BRIDGE_PORT", "9229")
    user = os.environ["USER"]
    home = os.environ["HOME"]

    sock_dir = Path(f"/tmp/claude-mcp-browser-bridge-{user}")
    sock_dir.mkdir(parents=True, exist_ok=True)
    sock_path = sock_dir / "mcp.sock"

    chrome_dir = Path(home, ".claude/chrome")
    chrome_dir.mkdir(parents=True, exist_ok=True)

    host_script = chrome_dir / "chrome-native-host"
    host_script.write_text(
        f'#!/bin/bash\nexec node -e "process.stdin.pipe(require(\'net\').connect(\'{sock_path}\')).pipe(process.stdout)"\n'
    )
    host_script.chmod(0o755)

    subprocess.Popen(
        ["socat", f"UNIX-LISTEN:{sock_path},fork,reuseaddr", f"TCP:host.docker.internal:{bridge_port}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    log.info("Chrome bridge: %s → host.docker.internal:%s", sock_path, bridge_port)


if __name__ == "__main__":
    install_claude_code()
    setup_chrome_bridge()

    # Signal the host launcher that setup is complete.
    sentinel = Path(os.environ.get("HOME", "/home/dev")) / ".claude" / "logs" / ".setup-ready"
    sentinel.write_text(f"ready {time.time()}\n")
    log.info("Setup complete — sentinel written")
