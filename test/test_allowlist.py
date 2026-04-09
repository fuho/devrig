"""Tests for scaffold/mitmproxy/allowlist.py (domain blocklist addon)."""

import json
import os
import sys
import tempfile
import threading
import types
from pathlib import Path

# Suppress API server during tests
os.environ["DEVRIG_API"] = "0"

# Add scaffold/mitmproxy to sys.path so we can import allowlist
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scaffold" / "mitmproxy"))

import uuid

from allowlist import (
    _is_blocked,
    _is_passthrough,
    _addon,
    Rule,
    TrafficEntry,
    RulesAddon,
    _load_rules,
    _save_rules,
    DEFAULT_RULES,
    RULES_PATH,
)


def mock_flow(host, method="GET", url=None, content=None, headers=None,
              scheme=None, port=None, kill=None):
    """Create a mock flow with a stable id, like mitmproxy's HTTPFlow."""
    if url is None:
        url = f"https://{host}/"
    if headers is None:
        headers = {}
    flow = types.SimpleNamespace(
        id=uuid.uuid4().hex,
        request=types.SimpleNamespace(
            pretty_host=host, method=method, url=url,
            content=content, headers=headers,
            scheme=scheme, port=port,
        ),
        kill=kill or (lambda: None),
    )
    return flow


# ---------------------------------------------------------------------------
# _is_blocked
# ---------------------------------------------------------------------------


class TestIsBlocked:
    def test_exact_match(self):
        assert _is_blocked("datadoghq.com") is True

    def test_subdomain_match(self):
        assert _is_blocked("http-intake.logs.us5.datadoghq.com") is True

    def test_non_blocked(self):
        assert _is_blocked("example.com") is False

    def test_case_insensitive(self):
        assert _is_blocked("DataDogHQ.COM") is True

    def test_partial_non_match(self):
        assert _is_blocked("notdatadoghq.com") is False

    def test_empty_string(self):
        assert _is_blocked("") is False


# ---------------------------------------------------------------------------
# _is_passthrough
# ---------------------------------------------------------------------------


class TestIsPassthrough:
    def test_exact_match(self):
        assert _is_passthrough("claudeusercontent.com") is True

    def test_subdomain_match(self):
        assert _is_passthrough("bridge.claudeusercontent.com") is True

    def test_non_passthrough(self):
        assert _is_passthrough("example.com") is False

    def test_case_insensitive(self):
        assert _is_passthrough("ClaudeUserContent.COM") is True

    def test_partial_non_match(self):
        assert _is_passthrough("notclaudeusercontent.com") is False


# ---------------------------------------------------------------------------
# tls_clienthello
# ---------------------------------------------------------------------------


class TestTlsClienthello:
    def test_passthrough_domain_sets_ignore(self):
        data = types.SimpleNamespace(
            context=types.SimpleNamespace(
                server=types.SimpleNamespace(address=("bridge.claudeusercontent.com", 443))
            ),
            ignore_connection=False,
        )
        _addon.tls_clienthello(data)
        assert data.ignore_connection is True

    def test_normal_domain_not_ignored(self):
        data = types.SimpleNamespace(
            context=types.SimpleNamespace(
                server=types.SimpleNamespace(address=("api.anthropic.com", 443))
            ),
            ignore_connection=False,
        )
        _addon.tls_clienthello(data)
        assert data.ignore_connection is False

    def test_no_address_does_not_crash(self):
        data = types.SimpleNamespace(
            context=types.SimpleNamespace(
                server=types.SimpleNamespace(address=None)
            ),
            ignore_connection=False,
        )
        # Should not raise — address is None
        _addon.tls_clienthello(data)
        assert data.ignore_connection is False


# ---------------------------------------------------------------------------
# request
# ---------------------------------------------------------------------------


class TestRequest:
    def test_blocked_domain_killed(self):
        killed = []
        flow = mock_flow("http-intake.logs.us5.datadoghq.com", method="POST",
                         url="https://http-intake.logs.us5.datadoghq.com/v1/input",
                         kill=lambda: killed.append(True))
        _addon.request(flow)
        assert len(killed) == 1

    def test_allowed_domain_not_killed(self):
        killed = []
        flow = mock_flow("api.anthropic.com",
                         url="https://api.anthropic.com/v1/messages",
                         kill=lambda: killed.append(True))
        _addon.request(flow)
        assert len(killed) == 0


# ---------------------------------------------------------------------------
# Rule dataclass
# ---------------------------------------------------------------------------


class TestRule:
    def test_matches_host(self):
        r = Rule(id="1", type="block", match=r"(^|\.)evil\.com$")
        assert r.matches("https://evil.com/path", "evil.com") is True

    def test_matches_subdomain(self):
        r = Rule(id="1", type="block", match=r"(^|\.)evil\.com$")
        assert r.matches("https://sub.evil.com/path", "sub.evil.com") is True

    def test_no_match(self):
        r = Rule(id="1", type="block", match=r"(^|\.)evil\.com$")
        assert r.matches("https://good.com/path", "good.com") is False

    def test_partial_no_match(self):
        r = Rule(id="1", type="block", match=r"(^|\.)evil\.com$")
        assert r.matches("https://notevil.com", "notevil.com") is False

    def test_case_insensitive(self):
        r = Rule(id="1", type="block", match=r"(^|\.)evil\.com$")
        assert r.matches("https://EVIL.COM/x", "EVIL.COM") is True

    def test_url_path_match(self):
        r = Rule(id="1", type="strip_header", match=r"/v1/input")
        assert r.matches("https://example.com/v1/input", "example.com") is True

    def test_to_dict_excludes_compiled(self):
        r = Rule(id="1", type="block", match="test")
        r.compiled()  # trigger compilation
        d = r.to_dict()
        assert "_compiled" not in d
        assert d["id"] == "1"

    def test_from_dict_roundtrip(self):
        r = Rule(id="1", type="block", match="test", header="X-Foo", value="bar")
        r2 = Rule.from_dict(r.to_dict())
        assert r2.id == r.id
        assert r2.type == r.type
        assert r2.match == r.match
        assert r2.header == r.header
        assert r2.value == r.value


# ---------------------------------------------------------------------------
# TrafficEntry
# ---------------------------------------------------------------------------


class TestTrafficEntry:
    def test_to_dict(self):
        e = TrafficEntry(id="abc", ts=123.0, method="GET", url="http://x.com", host="x.com")
        d = e.to_dict()
        assert d["id"] == "abc"
        assert d["status"] is None


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


class TestPersistence:
    def test_load_missing_file_returns_defaults(self, tmp_path, monkeypatch):
        monkeypatch.setattr("allowlist.RULES_PATH", str(tmp_path / "nonexistent.json"))
        rules = _load_rules()
        assert len(rules) == len(DEFAULT_RULES)
        assert rules[0].type == "block"

    def test_load_valid_file(self, tmp_path, monkeypatch):
        path = tmp_path / "rules.json"
        path.write_text(json.dumps([
            {"id": "x", "type": "block", "match": "test\\.com", "enabled": True}
        ]))
        monkeypatch.setattr("allowlist.RULES_PATH", str(path))
        rules = _load_rules()
        assert len(rules) == 1
        assert rules[0].id == "x"

    def test_load_corrupt_file_returns_defaults(self, tmp_path, monkeypatch):
        path = tmp_path / "rules.json"
        path.write_text("{corrupt json")
        monkeypatch.setattr("allowlist.RULES_PATH", str(path))
        rules = _load_rules()
        assert len(rules) == len(DEFAULT_RULES)

    def test_save_and_load_roundtrip(self, tmp_path, monkeypatch):
        path = tmp_path / "rules.json"
        monkeypatch.setattr("allowlist.RULES_PATH", str(path))
        rules = [Rule(id="rt", type="block", match=r"test\.com")]
        _save_rules(rules)
        loaded = _load_rules()
        assert len(loaded) == 1
        assert loaded[0].id == "rt"


# ---------------------------------------------------------------------------
# RulesAddon CRUD
# ---------------------------------------------------------------------------


class TestRulesAddonCRUD:
    def _make_addon(self):
        addon = RulesAddon()
        addon.rules = [Rule.from_dict(r.to_dict()) for r in DEFAULT_RULES]
        return addon

    def test_create_rule(self):
        addon = self._make_addon()
        rule, err = addon.create_rule({
            "type": "block",
            "match": r"evil\.com",
        })
        assert err is None
        assert rule.type == "block"
        assert len(addon.rules) == 3

    def test_create_invalid_type(self):
        addon = self._make_addon()
        rule, err = addon.create_rule({"type": "invalid", "match": "x"})
        assert rule is None
        assert "Invalid type" in err

    def test_create_invalid_regex(self):
        addon = self._make_addon()
        rule, err = addon.create_rule({"type": "block", "match": "[invalid"})
        assert rule is None
        assert "Invalid regex" in err

    def test_create_strip_header_requires_header(self):
        addon = self._make_addon()
        rule, err = addon.create_rule({"type": "strip_header", "match": "x"})
        assert rule is None
        assert "header" in err.lower()

    def test_create_add_header_requires_value(self):
        addon = self._make_addon()
        rule, err = addon.create_rule({
            "type": "add_header",
            "match": "x",
            "header": "X-Foo",
        })
        assert rule is None
        assert "value" in err.lower()

    def test_update_rule(self):
        addon = self._make_addon()
        rule_id = addon.rules[0].id
        updated, err = addon.update_rule(rule_id, {"enabled": False})
        assert err is None
        assert updated.enabled is False

    def test_update_nonexistent(self):
        addon = self._make_addon()
        _, err = addon.update_rule("nonexistent", {"enabled": False})
        assert err == "not_found"

    def test_delete_rule(self):
        addon = self._make_addon()
        rule_id = addon.rules[0].id
        assert addon.delete_rule(rule_id) is True
        assert len(addon.rules) == 1

    def test_delete_nonexistent(self):
        addon = self._make_addon()
        assert addon.delete_rule("nonexistent") is False


# ---------------------------------------------------------------------------
# Traffic buffer & domain counts
# ---------------------------------------------------------------------------


class TestTrafficBuffer:
    def test_record_request_adds_entry(self):
        addon = RulesAddon()
        addon.rules = []
        flow = mock_flow("example.com")
        addon.request(flow)
        assert len(addon._traffic) == 1
        assert addon._traffic[0].host == "example.com"

    def test_domain_count_increments(self):
        addon = RulesAddon()
        addon.rules = []
        for _ in range(3):
            flow = mock_flow("example.com")
            addon.request(flow)
        assert addon._domain_counts.get("example.com") == 3

    def test_traffic_maxlen(self):
        addon = RulesAddon()
        addon.rules = []
        for i in range(600):
            flow = mock_flow(f"host{i}.com", url=f"https://host{i}.com/")
            addon.request(flow)
        assert len(addon._traffic) == 500


# ---------------------------------------------------------------------------
# Header manipulation
# ---------------------------------------------------------------------------


class TestHeaderManipulation:
    def test_strip_header(self):
        addon = RulesAddon()
        addon.rules = [
            Rule(id="s1", type="strip_header", match=r"example\.com",
                 header="X-Secret"),
        ]
        headers = {"X-Secret": "value", "Accept": "text/html"}
        flow = mock_flow("example.com", headers=headers)
        addon.request(flow)
        assert "X-Secret" not in headers
        assert "Accept" in headers

    def test_strip_missing_header_no_crash(self):
        addon = RulesAddon()
        addon.rules = [
            Rule(id="s2", type="strip_header", match=r"example\.com",
                 header="X-Missing"),
        ]
        headers = {"Accept": "text/html"}
        flow = mock_flow("example.com", headers=headers)
        addon.request(flow)  # should not raise
        assert "Accept" in headers

    def test_add_header(self):
        addon = RulesAddon()
        addon.rules = [
            Rule(id="a1", type="add_header", match=r"api\.example\.com",
                 header="Authorization", value="Bearer token123"),
        ]
        headers = {}
        flow = mock_flow("api.example.com", url="https://api.example.com/v2/data",
                         headers=headers)
        addon.request(flow)
        assert headers["Authorization"] == "Bearer token123"


# ---------------------------------------------------------------------------
# Error / close hooks (flow_map cleanup)
# ---------------------------------------------------------------------------


class TestErrorAndClose:
    def test_error_cleans_flow_map(self):
        addon = RulesAddon()
        addon.rules = []
        flow = mock_flow("example.com")
        addon.request(flow)
        assert flow.id in addon._flow_map
        addon.error(flow)
        assert flow.id not in addon._flow_map

    def test_error_sets_status_zero(self):
        addon = RulesAddon()
        addon.rules = []
        flow = mock_flow("example.com")
        addon.request(flow)
        entry = addon._traffic[-1]
        assert entry.status is None
        addon.error(flow)
        assert entry.status == 0

    def test_error_on_unknown_flow_no_crash(self):
        addon = RulesAddon()
        flow = mock_flow("example.com")
        addon.error(flow)  # should not raise

    def test_close_cleans_flow_map(self):
        addon = RulesAddon()
        addon.rules = []
        flow = mock_flow("example.com")
        addon.request(flow)
        assert flow.id in addon._flow_map
        addon.close(flow)
        assert flow.id not in addon._flow_map

    def test_close_after_response_no_crash(self):
        """close() on a flow already removed by response() should not raise."""
        addon = RulesAddon()
        addon.rules = []
        flow = mock_flow("example.com")
        addon.request(flow)
        addon._flow_map.pop(flow.id, None)  # simulate response() cleanup
        addon.close(flow)  # should not raise


# ---------------------------------------------------------------------------
# Thread safety
# ---------------------------------------------------------------------------


class TestThreadSafety:
    def test_concurrent_rule_mutations(self):
        addon = RulesAddon()
        addon.rules = [Rule.from_dict(r.to_dict()) for r in DEFAULT_RULES]
        errors = []

        def add_and_remove():
            try:
                rule, err = addon.create_rule({"type": "block", "match": "test"})
                if err:
                    errors.append(err)
                    return
                addon.delete_rule(rule.id)
            except Exception as e:
                errors.append(str(e))

        threads = [threading.Thread(target=add_and_remove) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0
