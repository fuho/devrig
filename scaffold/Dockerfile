FROM node:25-slim

ARG USER_UID=1000
ARG USER_GID=1000
ARG BUILD_HASH=unknown
ARG CLAUDE_VERSION=latest

# Install system packages + GitHub CLI + zsh in a single layer
RUN apt-get update && \
    apt-get install -y ca-certificates curl wget && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y git socat ripgrep jq vim tree gh gosu zsh fzf && \
    rm -rf /var/lib/apt/lists/*

# Install git-delta for better diffs
RUN ARCH=$(dpkg --print-architecture) && \
    wget -q "https://github.com/dandavison/delta/releases/download/0.18.2/git-delta_0.18.2_${ARCH}.deb" && \
    dpkg -i "git-delta_0.18.2_${ARCH}.deb" && \
    rm "git-delta_0.18.2_${ARCH}.deb"

# Remove built-in node user (UID 1000) to avoid collision on Linux
RUN userdel -r node 2>/dev/null || true

# Create dev user with host-matching UID/GID, zsh as default shell
# --non-unique allows duplicate GIDs (e.g. macOS GID 20 = dialout in Debian)
RUN groupadd --non-unique -g ${USER_GID} dev && \
    useradd -m -s /bin/zsh -u ${USER_UID} -g dev dev

WORKDIR /workspace
RUN chown dev:dev /workspace

# npm global prefix + native installer target (volume-backed at runtime)
RUN mkdir -p /home/dev/.npm-global /home/dev/.npm /home/dev/.local/share && \
    chown -R dev:dev /home/dev/.npm-global /home/dev/.npm /home/dev/.local

# Entrypoint (runs setup, then hands off to CMD)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Container setup script (called by entrypoint)
COPY container-setup.js /usr/local/bin/container-setup.js

# Chrome MCP bridge (protocol translator for containerized Chrome access)
COPY chrome-mcp-bridge.cjs /usr/local/bin/chrome-mcp-bridge.cjs

LABEL devrig.build.hash="${BUILD_HASH}"

# ── Everything below runs as dev ─────────────────────────────────────────
USER dev
ENV USER=dev
ENV SHELL=/bin/zsh
ENV NPM_CONFIG_PREFIX=/home/dev/.npm-global
ENV PATH="/home/dev/.local/bin:/home/dev/.npm-global/bin:$PATH"

# Install zsh + powerlevel10k theme
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v1.2.0/zsh-in-docker.sh)" -- \
    -p git \
    -p fzf \
    -x

RUN git config --global --add safe.directory /workspace

# Install pnpm globally so Claude Code can run project scripts
RUN npm install -g pnpm@9

# Install Claude Code as dev, then switch to root to move the binary
# to /usr/local/bin/ so the /home/dev bind mount doesn't hide it
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root
RUN mv /home/dev/.local/bin/claude /usr/local/bin/claude && \
    chown dev:dev /usr/local/bin/claude
USER dev

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["zsh"]
