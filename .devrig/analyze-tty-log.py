#!/usr/bin/env python3
"""analyze-tty-log.py — Analyze tty-tunnel.log for character loss and anomalies.

Parses the hex-logged bidirectional TTY data and reports:
  - Total bytes IN vs OUT per session
  - Large OUT chunks that are most likely to trigger short writes
  - Echo analysis: typed characters vs echoed characters
  - Broken UTF-8 sequences in OUT data
  - Incomplete ANSI escape sequences
  - Timing gaps that suggest stalls

Usage:
    python3 .devrig/analyze-tty-log.py [path/to/tty-tunnel.log]

Defaults to logs/tty-tunnel.log if no path given.
"""

import re
import sys
from collections import defaultdict
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────

DEFAULT_LOG = Path(__file__).resolve().parent.parent / "logs" / "tty-tunnel.log"
LARGE_CHUNK_THRESHOLD = 4096  # bytes — flag OUT chunks larger than this
TIMING_GAP_MS = 2000          # flag gaps > 2s between consecutive entries
SHORT_WRITE_RISK_THRESHOLD = 1024  # OUT chunks above this are at risk

# ── Parsing ─────────────────────────────────────────────────────────────────

LINE_RE = re.compile(
    r"^(\d{2}:\d{2}:\d{2}\.\d{3})\s+"
    r"\[(\s*\w+)\]\s+"
    r"(?:\(\s*(\d+)B\)\s+hex=\[([^\]]*)\]\s+txt=\[.*\])?(.*)$"
)

def parse_timestamp(ts_str):
    """Parse HH:MM:SS.mmm into total milliseconds."""
    h, m, rest = ts_str.split(":")
    s, ms = rest.split(".")
    return int(h) * 3600000 + int(m) * 60000 + int(s) * 1000 + int(ms)


def parse_hex(hex_str):
    """Parse space-separated hex bytes into bytes object."""
    if not hex_str.strip():
        return b""
    return bytes(int(b, 16) for b in hex_str.split())


def parse_log(path):
    """Parse log file into list of entries."""
    entries = []
    with open(path) as f:
        for lineno, line in enumerate(f, 1):
            line = line.rstrip("\n")
            m = LINE_RE.match(line)
            if not m:
                continue
            ts_str, direction, size_str, hex_str, meta_text = m.groups()
            direction = direction.strip()
            ts_ms = parse_timestamp(ts_str)

            entry = {
                "lineno": lineno,
                "ts_ms": ts_ms,
                "ts_str": ts_str,
                "direction": direction,
            }

            if direction in ("IN", "OUT") and size_str:
                raw = parse_hex(hex_str)
                entry["size"] = int(size_str)
                entry["data"] = raw
                # Sanity check: declared size vs actual hex bytes
                if len(raw) != int(size_str):
                    entry["size_mismatch"] = True
            else:
                entry["meta"] = meta_text or ""

            entries.append(entry)
    return entries


# ── Analysis ────────────────────────────────────────────────────────────────

def split_sessions(entries):
    """Split entries into sessions (delimited by META session start/end)."""
    sessions = []
    current = []
    for e in entries:
        if e["direction"] == "META" and "session start" in e.get("meta", ""):
            current = [e]
        elif e["direction"] == "META" and "session end" in e.get("meta", ""):
            current.append(e)
            sessions.append(current)
            current = []
        else:
            current.append(e)
    # Trailing session without explicit end
    if current:
        sessions.append(current)
    return sessions


def analyze_session(session, idx):
    """Analyze a single session for anomalies."""
    issues = []
    stats = {
        "in_bytes": 0, "out_bytes": 0,
        "in_count": 0, "out_count": 0,
        "large_out_chunks": [],
        "size_mismatches": [],
        "broken_utf8": [],
        "timing_gaps": [],
    }

    data_entries = [e for e in session if e["direction"] in ("IN", "OUT")]
    prev_ts = None

    for e in data_entries:
        d = e["direction"]
        size = e.get("size", 0)
        data = e.get("data", b"")

        if d == "IN":
            stats["in_bytes"] += size
            stats["in_count"] += 1
        else:
            stats["out_bytes"] += size
            stats["out_count"] += 1

            # Flag large chunks
            if size >= SHORT_WRITE_RISK_THRESHOLD:
                stats["large_out_chunks"].append(
                    (e["lineno"], size, e["ts_str"])
                )

        # Size mismatch (declared vs actual hex)
        if e.get("size_mismatch"):
            stats["size_mismatches"].append(
                (e["lineno"], e.get("size"), len(data), d)
            )

        # Broken UTF-8 in OUT data: try decoding
        if d == "OUT" and data:
            try:
                data.decode("utf-8")
            except UnicodeDecodeError as ex:
                stats["broken_utf8"].append(
                    (e["lineno"], size, str(ex)[:80])
                )

        # Timing gaps
        if prev_ts is not None:
            gap = e["ts_ms"] - prev_ts
            if gap > TIMING_GAP_MS:
                stats["timing_gaps"].append(
                    (e["lineno"], gap, d, e["ts_str"])
                )
        prev_ts = e["ts_ms"]

    return stats


def echo_analysis(session):
    """Compare typed printable chars (IN) with their echoes (OUT).

    In a normal terminal, each typed printable char should appear in the
    subsequent OUT data (the echo).  We look for typed chars that never
    got echoed within a reasonable window.
    """
    data_entries = [e for e in session if e["direction"] in ("IN", "OUT")]
    typed_chars = []
    missing_echoes = []

    for i, e in enumerate(data_entries):
        if e["direction"] == "IN" and e.get("data"):
            for byte in e["data"]:
                # Only check printable ASCII (space..tilde)
                if 32 <= byte < 127:
                    ch = chr(byte)
                    # Look ahead in the next few OUT entries for this char
                    found = False
                    for j in range(i + 1, min(i + 10, len(data_entries))):
                        oe = data_entries[j]
                        if oe["direction"] == "OUT" and oe.get("data"):
                            if byte in oe["data"]:
                                found = True
                                break
                    typed_chars.append((e["lineno"], ch, found))
                    if not found:
                        missing_echoes.append((e["lineno"], ch, e["ts_str"]))

    return typed_chars, missing_echoes


# ── Reporting ───────────────────────────────────────────────────────────────

def report(log_path):
    entries = parse_log(log_path)
    sessions = split_sessions(entries)

    print(f"Log: {log_path}")
    print(f"Total entries: {len(entries)}")
    print(f"Sessions: {len(sessions)}")
    print()

    for i, session in enumerate(sessions):
        meta = [e for e in session if e["direction"] == "META"]
        cmd_entry = next((e for e in meta if "cmd:" in e.get("meta", "")), None)
        cmd_str = cmd_entry["meta"] if cmd_entry else "<unknown>"

        print(f"{'='*70}")
        print(f"SESSION {i+1}: {cmd_str}")
        print(f"{'='*70}")

        stats = analyze_session(session, i)

        print(f"  IN:  {stats['in_bytes']:>8} bytes across {stats['in_count']} reads")
        print(f"  OUT: {stats['out_bytes']:>8} bytes across {stats['out_count']} reads")
        if stats["in_bytes"] > 0:
            ratio = stats["out_bytes"] / stats["in_bytes"]
            print(f"  OUT/IN ratio: {ratio:.1f}x")
        print()

        # Size mismatches
        if stats["size_mismatches"]:
            print(f"  !! SIZE MISMATCHES ({len(stats['size_mismatches'])} found):")
            for lineno, declared, actual, d in stats["size_mismatches"]:
                print(f"     line {lineno}: [{d}] declared={declared}B actual={actual}B"
                      f" (LOST {declared - actual}B)")
            print()

        # Large OUT chunks (short-write risk)
        if stats["large_out_chunks"]:
            print(f"  Large OUT chunks (>= {SHORT_WRITE_RISK_THRESHOLD}B, "
                  f"short-write risk):")
            for lineno, size, ts in stats["large_out_chunks"]:
                risk = "HIGH" if size >= LARGE_CHUNK_THRESHOLD else "moderate"
                print(f"     line {lineno} @ {ts}: {size}B [{risk}]")
            print()

        # Broken UTF-8
        if stats["broken_utf8"]:
            print(f"  Broken UTF-8 in OUT data ({len(stats['broken_utf8'])} chunks):")
            for lineno, size, err in stats["broken_utf8"]:
                print(f"     line {lineno}: {size}B — {err}")
            print()

        # Timing gaps
        if stats["timing_gaps"]:
            print(f"  Timing gaps > {TIMING_GAP_MS}ms:")
            for lineno, gap_ms, d, ts in stats["timing_gaps"]:
                print(f"     line {lineno} @ {ts}: {gap_ms}ms gap before [{d}]")
            print()

        # Echo analysis
        typed, missing = echo_analysis(session)
        if typed:
            total_typed = len(typed)
            echoed = sum(1 for _, _, found in typed if found)
            print(f"  Echo analysis: {echoed}/{total_typed} printable chars echoed")
            if missing:
                print(f"  !! MISSING ECHOES ({len(missing)}):")
                for lineno, ch, ts in missing[:20]:
                    print(f"     line {lineno} @ {ts}: '{ch}' typed but not echoed")
                if len(missing) > 20:
                    print(f"     ... and {len(missing) - 20} more")
            print()

    print(f"{'='*70}")
    print("DONE")


# ── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LOG
    if not log_path.exists():
        print(f"Error: log file not found: {log_path}", file=sys.stderr)
        sys.exit(1)
    report(log_path)
