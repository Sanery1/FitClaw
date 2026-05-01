# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies (including devDependencies for build)
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/tui/package.json packages/tui/tsconfig.build.json ./packages/tui/
COPY packages/ai/package.json packages/ai/tsconfig.build.json ./packages/ai/
COPY packages/agent/package.json packages/agent/tsconfig.build.json ./packages/agent/
COPY packages/coding-agent/package.json packages/coding-agent/tsconfig.build.json ./packages/coding-agent/
COPY packages/mom/package.json packages/mom/tsconfig.build.json ./packages/mom/

RUN npm install

# Copy source code
COPY packages/tui/src ./packages/tui/src
COPY packages/ai/src ./packages/ai/src
COPY packages/agent/src ./packages/agent/src
COPY packages/coding-agent/src ./packages/coding-agent/src
COPY packages/coding-agent/data ./packages/coding-agent/data
COPY packages/mom/src ./packages/mom/src

# Build all workspace packages in dependency order
# Use tsgo directly to skip pre/post scripts that require network (generate-models, etc.)
RUN cd packages/tui && npx tsgo -p tsconfig.build.json && \
    cd /app/packages/ai && npx tsgo -p tsconfig.build.json && \
    cd /app/packages/agent && npx tsgo -p tsconfig.build.json && \
    cd /app/packages/coding-agent && npx tsgo -p tsconfig.build.json && npm run copy-assets && \
    cd /app/packages/mom && npx tsgo -p tsconfig.build.json && chmod +x dist/main.js

# Pack each workspace into .tgz (production files only)
RUN mkdir -p /tmp/packs && \
    cd packages/tui && npm pack --pack-destination /tmp/packs && \
    cd /app/packages/ai && npm pack --pack-destination /tmp/packs && \
    cd /app/packages/agent && npm pack --pack-destination /tmp/packs && \
    cd /app/packages/coding-agent && npm pack --pack-destination /tmp/packs && \
    cd /app/packages/mom && npm pack --pack-destination /tmp/packs

# ============================================================================
# Stage 2: Runtime
FROM node:22-slim

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

# Create workspace mount point
RUN mkdir -p /opt/fitclaw/feishu-workspace && chown -R fitclaw:fitclaw /opt/fitclaw

USER fitclaw
ENTRYPOINT ["/opt/fitclaw/docker/entrypoint.sh"]
CMD ["/opt/fitclaw/feishu-workspace"]
