"""
Domain blocklist addon for mitmproxy.

Default: all traffic is allowed. Only domains in BLOCKED_DOMAINS are
rejected. This is more practical than an allowlist since Claude Code
needs many domains to function and discovering them all is tedious.

Usage:
  mitmweb --mode transparent -s /addons/allowlist.py
"""

import logging

logger = logging.getLogger("blocklist")

# Domains that are blocked. Subdomains are matched:
# "datadoghq.com" blocks "http-intake.logs.us5.datadoghq.com".
BLOCKED_DOMAINS = {
    "datadoghq.com",
}


def _is_blocked(host: str) -> bool:
    """Check if a host matches any blocked domain (including subdomains)."""
    host = host.lower()
    for domain in BLOCKED_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return True
    return False


def request(flow):
    """Called for each request. Kills requests to blocked domains."""
    host = flow.request.pretty_host
    if _is_blocked(host):
        logger.warning("BLOCKED: %s %s", flow.request.method, flow.request.url)
        flow.kill()
