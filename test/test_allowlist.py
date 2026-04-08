"""Tests for scaffold/mitmproxy/allowlist.py (domain blocklist addon)."""

import sys
import types
from pathlib import Path

# Add scaffold/mitmproxy to sys.path so we can import allowlist
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scaffold" / "mitmproxy"))

from allowlist import _is_blocked, _is_passthrough, tls_clienthello, request


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
        tls_clienthello(data)
        assert data.ignore_connection is True

    def test_normal_domain_not_ignored(self):
        data = types.SimpleNamespace(
            context=types.SimpleNamespace(
                server=types.SimpleNamespace(address=("api.anthropic.com", 443))
            ),
            ignore_connection=False,
        )
        tls_clienthello(data)
        assert data.ignore_connection is False

    def test_no_address_does_not_crash(self):
        data = types.SimpleNamespace(
            context=types.SimpleNamespace(
                server=types.SimpleNamespace(address=None)
            ),
            ignore_connection=False,
        )
        # Should not raise — address is None
        tls_clienthello(data)
        assert data.ignore_connection is False


# ---------------------------------------------------------------------------
# request
# ---------------------------------------------------------------------------


class TestRequest:
    def test_blocked_domain_killed(self):
        killed = []
        flow = types.SimpleNamespace(
            request=types.SimpleNamespace(
                pretty_host="http-intake.logs.us5.datadoghq.com",
                method="POST",
                url="https://http-intake.logs.us5.datadoghq.com/v1/input",
            ),
            kill=lambda: killed.append(True),
        )
        request(flow)
        assert len(killed) == 1

    def test_allowed_domain_not_killed(self):
        killed = []
        flow = types.SimpleNamespace(
            request=types.SimpleNamespace(
                pretty_host="api.anthropic.com",
                method="GET",
                url="https://api.anthropic.com/v1/messages",
            ),
            kill=lambda: killed.append(True),
        )
        request(flow)
        assert len(killed) == 0
