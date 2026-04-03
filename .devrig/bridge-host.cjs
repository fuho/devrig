#!/usr/bin/env node
/**
 * Chrome Bridge Host — TCP-to-Unix-socket relay for Docker ↔ Chrome integration.
 *
 * Claude Code's --chrome flag communicates with the Chrome extension via a
 * Native Messaging Host (NMH) Unix socket on the host OS. When Claude Code
 * runs inside a Docker container, it cannot reach that socket directly.
 *
 * This script runs on the HOST and bridges the gap:
 *
 *   Container (socat: Unix→TCP) → this server (TCP:9229) → Chrome NMH socket
 *
 * Each incoming TCP connection is paired 1:1 with a fresh NMH socket connection.
 * Data flows bidirectionally via Node.js stream piping.
 *
 * Environment variables:
 *   BRIDGE_USER  — override username for socket directory lookup
 *   BRIDGE_PORT  — TCP listen port (default: 9229)
 *   BRIDGE_HOST  — TCP bind address (default: 0.0.0.0)
 *
 * Counterpart: .devrig/entrypoint.sh + .devrig/container-setup.py (runs inside
 * the container, starts socat to relay from a local Unix socket to this server).
 *
 * Based on: https://github.com/vaclavpavek/claude-code-remote-chrome
 */
"use strict";

const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Chrome's NMH extension creates .sock files here; the directory name includes
// the username so multiple users on the same machine don't collide.
const SOCK_DIR = `/tmp/claude-mcp-browser-bridge-${process.env.BRIDGE_USER || os.userInfo().username}`;
const TCP_PORT = parseInt(process.env.BRIDGE_PORT || "9229", 10);
const TCP_HOST = process.env.BRIDGE_HOST || "0.0.0.0";

// ── Logging to file with size-based rotation ────────────────────────────────
const LOG_FILE = process.env.BRIDGE_LOG_DIR
  ? path.join(process.env.BRIDGE_LOG_DIR, "bridge-host.log")
  : path.join(os.tmpdir(), "bridge-host.log");
const LOG_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const LOG_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > LOG_MAX_BYTES) {
      fs.truncateSync(LOG_FILE, 0);
      fs.appendFileSync(LOG_FILE, `[bridge-host] Log rotated (was ${(stat.size / 1024 / 1024).toFixed(1)} MB)\n`);
    }
  } catch { /* file doesn't exist yet */ }
}

function log(msg) {
  const line = `[bridge-host] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* best-effort */ }
}

// Check log size at startup and every hour.
rotateIfNeeded();
setInterval(rotateIfNeeded, LOG_CHECK_INTERVAL).unref();

// Probe whether a Unix socket is alive by attempting a quick connect.
// Returns a Promise<boolean>.
function isSocketAlive(sockPath) {
  return new Promise((resolve) => {
    const conn = net.createConnection(sockPath, () => {
      conn.destroy();
      resolve(true);
    });
    conn.on("error", () => resolve(false));
    conn.setTimeout(500, () => {
      conn.destroy();
      resolve(false);
    });
  });
}

// Remove stale socket files that no longer have a listening process.
async function pruneStale() {
  let files;
  try {
    files = fs.readdirSync(SOCK_DIR).filter((f) => f.endsWith(".sock"));
  } catch {
    return;
  }
  for (const f of files) {
    const p = path.join(SOCK_DIR, f);
    if (!(await isSocketAlive(p))) {
      log(`Removing stale socket: ${p}`);
      try { fs.unlinkSync(p); } catch { /* already gone */ }
    }
  }
}

// The NMH extension may create multiple socket files over time. Sort
// alphabetically and pick the last one (most recent by naming convention).
function findSock() {
  try {
    const files = fs.readdirSync(SOCK_DIR).filter((f) => f.endsWith(".sock"));
    if (files.length === 0) return null;
    files.sort();
    return path.join(SOCK_DIR, files[files.length - 1]);
  } catch {
    return null;
  }
}

const server = net.createServer((tcpConn) => {
  const addr = `${tcpConn.remoteAddress}:${tcpConn.remotePort}`;
  const sockPath = findSock();

  if (!sockPath) {
    log(`TCP client ${addr} connected but no NMH socket in ${SOCK_DIR}`);
    tcpConn.destroy();
    return;
  }

  log(`TCP client ${addr} -> NMH ${sockPath}`);

  const nmh = net.createConnection(sockPath, () => {
    log(`Connected to NMH socket`);
  });

  // Bidirectional relay: TCP ↔ NMH socket.
  // Symmetric error/close handlers ensure both ends tear down together.
  tcpConn.pipe(nmh);
  nmh.pipe(tcpConn);

  tcpConn.on("error", (e) => {
    log(`TCP error: ${e.message}`);
    nmh.destroy();
  });
  nmh.on("error", (e) => {
    log(`NMH error: ${e.message}`);
    tcpConn.destroy();
  });
  tcpConn.on("close", () => {
    log(`TCP client ${addr} disconnected`);
    nmh.destroy();
  });
  nmh.on("close", () => {
    log(`NMH disconnected`);
    tcpConn.destroy();
  });
});

// Prune stale sockets before accepting connections.
pruneStale().then(() => {
  server.listen(TCP_PORT, TCP_HOST, () => {
    log(`Listening on ${TCP_HOST}:${TCP_PORT}`);
    log(`NMH socket dir: ${SOCK_DIR}`);
    const sock = findSock();
    if (sock) log(`Found NMH socket: ${sock}`);
    else log(`No NMH socket yet, will check on each connection`);
  });
});
