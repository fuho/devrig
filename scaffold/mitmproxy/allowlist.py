"""
Rules-engine blocklist addon for mitmproxy with embedded HTTP API.

Default: all traffic is allowed. Rules define block, passthrough,
strip_header, and add_header actions matched by regex against the
request URL or host.

Usage:
  mitmweb --mode transparent -s /addons/allowlist.py

API (port 8082):
  GET  /rules            — list all rules
  POST /rules            — create a rule
  PUT  /rules/{id}       — update a rule
  DELETE /rules/{id}     — delete a rule
  GET  /domains          — domain hit counts
  GET  /traffic/recent   — recent traffic entries
  GET  /traffic          — SSE stream of live traffic
"""

import json
import logging
import os
import queue
import re
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional
from urllib.parse import urlparse, parse_qs

API_PORT = 8082
RULES_PATH = os.environ.get("DEVRIG_RULES_PATH", "/data/rules.json")
TRAFFIC_MAXLEN = 500

logger = logging.getLogger("allowlist")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class Rule:
    id: str
    type: str            # "block" | "passthrough" | "strip_header" | "add_header"
    match: str           # regex pattern
    enabled: bool = True
    header: Optional[str] = None
    value: Optional[str] = None
    _compiled: object = field(default=None, repr=False, compare=False)

    def compiled(self) -> re.Pattern:
        if self._compiled is None:
            self._compiled = re.compile(self.match, re.IGNORECASE)
        return self._compiled

    def matches(self, url: str, host: str) -> bool:
        pat = self.compiled()
        return bool(pat.search(url) or pat.search(host))

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("_compiled", None)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Rule":
        d = {k: v for k, v in d.items() if k != "_compiled"}
        return cls(**d)


@dataclass
class TrafficEntry:
    id: str
    ts: float
    method: str
    url: str
    host: str
    status: Optional[int] = None
    size: Optional[int] = None
    rule_id: Optional[str] = None
    rule_type: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Default rules & persistence
# ---------------------------------------------------------------------------

DEFAULT_RULES = [
    Rule(id="default-block-datadog", type="block",
         match=r"(^|\.)datadoghq\.com$"),
    Rule(id="default-pass-claude", type="passthrough",
         match=r"(^|\.)claudeusercontent\.com$"),
]

_ALLOWED_TYPES = {"block", "passthrough", "strip_header", "add_header"}


def _load_rules() -> list:
    try:
        with open(RULES_PATH, "r") as f:
            data = json.load(f)
        return [Rule.from_dict(d) for d in data]
    except (FileNotFoundError, json.JSONDecodeError, TypeError, KeyError):
        return [Rule.from_dict(r.to_dict()) for r in DEFAULT_RULES]


def _save_rules(rules: list) -> None:
    try:
        os.makedirs(os.path.dirname(RULES_PATH) or ".", exist_ok=True)
        with open(RULES_PATH, "w") as f:
            json.dump([r.to_dict() for r in rules], f, indent=2)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# RulesAddon
# ---------------------------------------------------------------------------

class RulesAddon:
    def __init__(self):
        self._lock = threading.Lock()
        self._sse_lock = threading.Lock()
        self.rules: list = _load_rules()
        self._traffic: deque = deque(maxlen=TRAFFIC_MAXLEN)
        self._domain_counts: dict = {}
        self._sse_clients: list = []   # list of queue.Queue
        self._flow_map: dict = {}      # id(flow) -> TrafficEntry

    # -- Rule queries -------------------------------------------------------

    def _find_matching_rule(self, url: str, host: str) -> Optional[Rule]:
        with self._lock:
            for rule in self.rules:
                if rule.enabled and rule.matches(url, host):
                    return rule
        return None

    def is_blocked(self, host: str) -> bool:
        host = host.lower()
        with self._lock:
            for rule in self.rules:
                if rule.enabled and rule.type == "block" and rule.compiled().search(host):
                    return True
        return False

    def is_passthrough(self, host: str) -> bool:
        host = host.lower()
        with self._lock:
            for rule in self.rules:
                if rule.enabled and rule.type == "passthrough" and rule.compiled().search(host):
                    return True
        return False

    # -- CRUD ---------------------------------------------------------------

    def get_rules(self) -> list:
        with self._lock:
            return [r.to_dict() for r in self.rules]

    def create_rule(self, data: dict):
        rtype = data.get("type")
        match = data.get("match", "")
        header = data.get("header")
        value = data.get("value")
        enabled = data.get("enabled", True)

        if rtype not in _ALLOWED_TYPES:
            return None, f"Invalid type: {rtype}"
        try:
            re.compile(match)
        except re.error as e:
            return None, f"Invalid regex: {e}"
        if rtype in ("strip_header", "add_header") and not header:
            return None, "header is required for header rule types"
        if rtype == "add_header" and value is None:
            return None, "value is required for add_header rules"

        rule = Rule(
            id=uuid.uuid4().hex,
            type=rtype,
            match=match,
            enabled=enabled,
            header=header,
            value=value,
        )
        with self._lock:
            self.rules.append(rule)
            _save_rules(self.rules)
        return rule, None

    def update_rule(self, rule_id: str, data: dict):
        with self._lock:
            target = None
            for r in self.rules:
                if r.id == rule_id:
                    target = r
                    break
            if target is None:
                return None, "not_found"

            new_match = data.get("match", target.match)
            try:
                re.compile(new_match)
            except re.error as e:
                return None, f"Invalid regex: {e}"

            new_type = data.get("type", target.type)
            if new_type not in _ALLOWED_TYPES:
                return None, f"Invalid type: {new_type}"

            target.match = new_match
            target._compiled = None
            target.type = new_type
            target.enabled = data.get("enabled", target.enabled)
            target.header = data.get("header", target.header)
            target.value = data.get("value", target.value)

            if target.type in ("strip_header", "add_header") and not target.header:
                return None, "header is required for header rule types"
            if target.type == "add_header" and target.value is None:
                return None, "value is required for add_header rules"

            _save_rules(self.rules)
            return target, None

    def delete_rule(self, rule_id: str) -> bool:
        with self._lock:
            for i, r in enumerate(self.rules):
                if r.id == rule_id:
                    self.rules.pop(i)
                    _save_rules(self.rules)
                    return True
        return False

    # -- mitmproxy hooks ----------------------------------------------------

    def tls_clienthello(self, data):
        if data.context.server.address and self.is_passthrough(data.context.server.address[0]):
            data.ignore_connection = True
            logger.info("PASSTHROUGH: %s", data.context.server.address[0])

    def request(self, flow):
        host = flow.request.pretty_host
        url = flow.request.url
        method = flow.request.method

        rule = self._find_matching_rule(url, host)

        entry = self._record_request(flow, rule)

        # Increment domain count
        with self._lock:
            self._domain_counts[host] = self._domain_counts.get(host, 0) + 1

        if rule is not None:
            if rule.type == "block":
                logger.warning("BLOCKED: %s %s", method, url)
                flow.kill()
            elif rule.type == "strip_header" and rule.header:
                flow.request.headers.pop(rule.header, None)
            elif rule.type == "add_header" and rule.header:
                flow.request.headers[rule.header] = rule.value or ""

        self._broadcast_sse(entry)

    def response(self, flow):
        self._update_response(flow)

    # -- Traffic recording --------------------------------------------------

    def _record_request(self, flow, rule: Optional[Rule] = None) -> TrafficEntry:
        entry = TrafficEntry(
            id=uuid.uuid4().hex,
            ts=time.time(),
            method=flow.request.method,
            url=flow.request.url,
            host=flow.request.pretty_host,
            rule_id=rule.id if rule else None,
            rule_type=rule.type if rule else None,
        )
        self._traffic.append(entry)
        self._flow_map[id(flow)] = entry
        return entry

    def _update_response(self, flow):
        entry = self._flow_map.pop(id(flow), None)
        if entry is None:
            return
        try:
            entry.status = flow.response.status_code
        except AttributeError:
            pass
        try:
            content = flow.response.content
            entry.size = len(content) if content is not None else None
        except AttributeError:
            pass
        self._broadcast_sse(entry)

    def _broadcast_sse(self, entry: TrafficEntry):
        with self._sse_lock:
            dead = []
            for q in self._sse_clients:
                try:
                    q.put_nowait(entry)
                except queue.Full:
                    pass
                except Exception:
                    dead.append(q)
            for q in dead:
                try:
                    self._sse_clients.remove(q)
                except ValueError:
                    pass


# ---------------------------------------------------------------------------
# HTTP API Handler
# ---------------------------------------------------------------------------

class APIHandler(BaseHTTPRequestHandler):
    addon: RulesAddon  # set before server starts

    def log_message(self, format, *args):
        logger.debug(format, *args)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg, status=400):
        self._send_json({"error": msg}, status=status)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            return json.loads(raw), None
        except (json.JSONDecodeError, ValueError) as e:
            return None, str(e)

    # -- Methods ------------------------------------------------------------

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        qs = parse_qs(parsed.query)

        if path == "/rules":
            self._send_json(self.addon.get_rules())

        elif path == "/domains":
            with self.addon._lock:
                data = dict(self.addon._domain_counts)
            self._send_json(data)

        elif path == "/traffic/recent":
            n = 50
            try:
                n = min(int(qs.get("n", [50])[0]), 500)
            except (ValueError, IndexError):
                pass
            entries = list(self.addon._traffic)[-n:]
            self._send_json([e.to_dict() for e in entries])

        elif path == "/traffic":
            self._handle_sse()

        else:
            self._send_error("not found", 404)

    def _handle_sse(self):
        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        q = queue.Queue(maxsize=100)
        with self.addon._sse_lock:
            self.addon._sse_clients.append(q)
        try:
            while True:
                try:
                    entry = q.get(timeout=15)
                    line = f"data: {json.dumps(entry.to_dict())}\n\n"
                    self.wfile.write(line.encode())
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with self.addon._sse_lock:
                try:
                    self.addon._sse_clients.remove(q)
                except ValueError:
                    pass

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/rules":
            body, err = self._read_json_body()
            if err:
                self._send_error(err)
                return
            rule, err = self.addon.create_rule(body)
            if err:
                self._send_error(err)
                return
            self._send_json(rule.to_dict(), 201)
        else:
            self._send_error("not found", 404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        parts = path.split("/")

        if len(parts) == 3 and parts[1] == "rules" and parts[2]:
            rule_id = parts[2]
            body, err = self._read_json_body()
            if err:
                self._send_error(err)
                return
            rule, err = self.addon.update_rule(rule_id, body)
            if err:
                if err == "not_found":
                    self._send_error("rule not found", 404)
                else:
                    self._send_error(err)
                return
            self._send_json(rule.to_dict())
        else:
            self._send_error("not found", 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        parts = path.split("/")

        if len(parts) == 3 and parts[1] == "rules" and parts[2]:
            rule_id = parts[2]
            if self.addon.delete_rule(rule_id):
                self.send_response(204)
                self._cors_headers()
                self.end_headers()
            else:
                self._send_error("rule not found", 404)
        else:
            self._send_error("not found", 404)


# ---------------------------------------------------------------------------
# Server startup
# ---------------------------------------------------------------------------

def _start_api_server(addon: RulesAddon):
    APIHandler.addon = addon
    try:
        server = HTTPServer(("0.0.0.0", API_PORT), APIHandler)
    except OSError as e:
        logger.warning("Could not start API server on :%d: %s", API_PORT, e)
        return
    server.allow_reuse_address = True
    t = threading.Thread(target=server.serve_forever, name="api-server",
                         daemon=True)
    t.start()
    logger.info("Rules API listening on :%d", API_PORT)


# ---------------------------------------------------------------------------
# Module-level wiring
# ---------------------------------------------------------------------------

_addon = RulesAddon()

if os.environ.get("DEVRIG_API", "1") != "0":
    _start_api_server(_addon)


# Backward-compatible shims
def _is_blocked(host):
    return _addon.is_blocked(host)


def _is_passthrough(host):
    return _addon.is_passthrough(host)


def tls_clienthello(data):
    return _addon.tls_clienthello(data)


def request(flow):
    return _addon.request(flow)


def response(flow):
    return _addon.response(flow)


addons = [_addon]
