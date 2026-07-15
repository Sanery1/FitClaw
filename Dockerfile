# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies (including devDependencies for build)
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ai/package.json packages/ai/tsconfig.build.json ./packages/ai/
COPY packages/agent/package.json packages/agent/tsconfig.build.json ./packages/agent/
COPY packages/runtime/package.json packages/runtime/tsconfig.build.json ./packages/runtime/
COPY packages/coach-core/package.json packages/coach-core/tsconfig.build.json ./packages/coach-core/
COPY apps/coach-bot/package.json apps/coach-bot/tsconfig.build.json ./apps/coach-bot/

RUN npm pkg delete devDependencies.canvas --workspace @fitclaw/ai && \
    npm install --workspaces --include-workspace-root=false --ignore-scripts --no-audit --no-fund --prefer-offline

# Copy source code
COPY packages/ai/src ./packages/ai/src
COPY packages/agent/src ./packages/agent/src
COPY packages/runtime/src ./packages/runtime/src
COPY packages/coach-core/src ./packages/coach-core/src
COPY apps/coach-bot/src ./apps/coach-bot/src

# Build all workspace packages in dependency order
# Invoke TypeScript directly to skip package pre/post scripts that require network.
RUN cd packages/ai && npx tsc -p tsconfig.build.json && \
    cd /app/packages/agent && npx tsc -p tsconfig.build.json && \
    cd /app/packages/runtime && npx tsc -p tsconfig.build.json && \
    cd /app/packages/coach-core && npx tsc -p tsconfig.build.json && \
    cd /app/apps/coach-bot && npx tsc -p tsconfig.build.json && chmod +x dist/main.js

# Pack each workspace into .tgz (production files only)
RUN mkdir -p /tmp/packs && \
    cd packages/ai && npm pack --pack-destination /tmp/packs && \
    cd /app/packages/agent && npm pack --pack-destination /tmp/packs && \
    cd /app/packages/runtime && npm pack --pack-destination /tmp/packs && \
    cd /app/packages/coach-core && npm pack --pack-destination /tmp/packs && \
    cd /app/apps/coach-bot && npm pack --pack-destination /tmp/packs

# ============================================================================
# Stage 2: Runtime
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 && \
    ln -s /usr/bin/python3 /usr/local/bin/python && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -r fitclaw && useradd -r -g fitclaw fitclaw

ENV HOME=/opt/fitclaw
WORKDIR /opt/fitclaw

# Install workspace packages from tarballs (flat install, no symlinks)
COPY --from=builder /tmp/packs/*.tgz /tmp/packs/
RUN npm install --omit=dev /tmp/packs/*.tgz && rm -rf /tmp/packs

# Copy knowledge base
COPY .fitclaw/ /opt/fitclaw/.fitclaw/

# Copy entrypoint script
COPY docker/entrypoint.sh /opt/fitclaw/docker/entrypoint.sh
RUN chmod +x /opt/fitclaw/docker/entrypoint.sh

# Create writable mount points before named volumes are initialized.
RUN mkdir -p /opt/fitclaw/feishu-workspace /run/fitclaw-skill-runner && \
    chown -R fitclaw:fitclaw /opt/fitclaw /run/fitclaw-skill-runner

USER fitclaw
ENTRYPOINT ["/opt/fitclaw/docker/entrypoint.sh"]
CMD ["/opt/fitclaw/feishu-workspace"]
