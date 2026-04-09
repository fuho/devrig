#!/bin/bash
set -euo pipefail

# Firewall script for devrig containers.
# Runs inside the mitmproxy sidecar (which has NET_ADMIN capability).
# Redirects all HTTP/HTTPS traffic to mitmproxy for transparent inspection,
# and blocks all other outbound traffic.

echo "Configuring firewall..."

# Get the mitmproxy user ID (traffic from mitmproxy itself must bypass redirect)
MITM_UID=$(id -u mitmproxy 2>/dev/null || echo "65534")

# Detect host network from default route
HOST_IP=$(ip route | grep default | head -1 | awk '{print $3}')
if [ -z "$HOST_IP" ]; then
    echo "WARNING: Could not detect host IP from default route"
    HOST_NETWORK="172.16.0.0/12"
else
    HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/16/")
    echo "Host network: $HOST_NETWORK"
fi

# Save Docker's internal DNS NAT rules before flushing.
# Docker redirects 127.0.0.11:53 to its embedded resolver via NAT rules.
# Flushing nat OUTPUT without restoring these breaks DNS resolution.
DOCKER_DNS_RULES=$(iptables-save -t nat 2>/dev/null | grep "127\.0\.0\.11" || true)

# Flush existing OUTPUT rules only
iptables -F OUTPUT 2>/dev/null || true
iptables -t nat -F OUTPUT 2>/dev/null || true

# Restore Docker DNS NAT rules
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat 2>/dev/null || true
fi

# --- NAT table: redirect HTTP/HTTPS to mitmproxy ---

# Redirect HTTP (80) to mitmproxy transparent port (8080)
iptables -t nat -A OUTPUT -p tcp --dport 80 \
    -m owner ! --uid-owner "$MITM_UID" \
    -j REDIRECT --to-port 8080

# Redirect HTTPS (443) to mitmproxy transparent port (8080)
iptables -t nat -A OUTPUT -p tcp --dport 443 \
    -m owner ! --uid-owner "$MITM_UID" \
    -j REDIRECT --to-port 8080

# --- Filter table: allowlist ---

# Allow DNS (needed for domain resolution)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow Docker internal networks (172.16-31.x.x, 10.x.x.x, 192.168.x.x)
iptables -A OUTPUT -d 10.0.0.0/8 -j ACCEPT
iptables -A OUTPUT -d 172.16.0.0/12 -j ACCEPT
iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT

# Allow host network (for Chrome bridge and other host services)
if [ -n "$HOST_IP" ]; then
    iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT
fi

# Allow host.docker.internal (may be outside standard private ranges, e.g. OrbStack uses 0.250.x.x)
HOST_DOCKER_IP=$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')
if [ -n "$HOST_DOCKER_IP" ]; then
    echo "host.docker.internal: $HOST_DOCKER_IP"
    iptables -A OUTPUT -d "$HOST_DOCKER_IP" -j ACCEPT
fi

# Allow established connections (responses to already-approved traffic)
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow mitmproxy's own outbound traffic (it actually reaches the internet)
iptables -A OUTPUT -m owner --uid-owner "$MITM_UID" -j ACCEPT

# Allow traffic to mitmproxy ports (HTTP/HTTPS already redirected via NAT)
iptables -A OUTPUT -p tcp --dport 8080 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 8081 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 8082 -j ACCEPT

# Block everything else with an immediate reject (not silent drop)
iptables -A OUTPUT -j REJECT --reject-with icmp-port-unreachable

echo "Firewall configured."

# Verify: test that blocked traffic is rejected
if curl --connect-timeout 3 -s http://example.com >/dev/null 2>&1; then
    echo "WARNING: Firewall verification failed — example.com is reachable"
else
    echo "Firewall OK — unauthorized traffic is blocked."
fi
