"""
Domain allowlist addon for mitmproxy.

Blocks requests to domains not in the allowlist. Blocked requests are
killed and logged. Add domains to ALLOWED_DOMAINS to permit traffic.

Usage:
  mitmweb --mode transparent -s /addons/allowlist.py
"""

import logging

logger = logging.getLogger("allowlist")

# Domains that are allowed through the proxy.
# Subdomains are matched: "github.com" allows "api.github.com".
ALLOWED_DOMAINS = {
    # Claude API and services
    "anthropic.com",
    "api.anthropic.com",
    "statsig.anthropic.com",
    "claude.ai",
    "platform.claude.com",
    "claudeusercontent.com",
    # Package registries
    "registry.npmjs.org",
    # GitHub
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "github-releases.githubusercontent.com",
    # Telemetry
    "sentry.io",
    "statsig.com",
    # PyPI (for pip installs if needed)
    "pypi.org",
    "files.pythonhosted.org",
}


def _is_allowed(host: str) -> bool:
    """Check if a host matches any allowed domain (including subdomains)."""
    host = host.lower()
    for domain in ALLOWED_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return True
    return False


def request(flow):
    """Called for each request. Kills requests to non-allowed domains."""
    host = flow.request.pretty_host
    if not _is_allowed(host):
        logger.warning("BLOCKED: %s %s", flow.request.method, flow.request.url)
        flow.kill()
