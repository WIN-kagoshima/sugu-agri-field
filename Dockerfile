# syntax=docker/dockerfile:1.7
#
# Multi-stage build for Cloud Run.
#
# Final image:
#   - gcr.io/distroless/nodejs20-debian12:nonroot
#   - runs as non-root user (uid 65532)
#   - read-only filesystem friendly (snapshots are baked in at build time)
#
# Runtime ENV:
#   PORT (Cloud Run sets this)
#   MCP_BASE_URL (e.g. https://mcp.sugukuru.dev)
#   LOG_LEVEL (info|warn|error|debug)
#
# Build:
#   docker build -t sugu-agri-field:local .
#   docker run --rm -p 8080:8080 -e PORT=8080 -e MCP_BASE_URL=http://localhost:8080 sugu-agri-field:local

############################
# 1. deps stage — install
############################
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Tools needed to compile better-sqlite3 native bindings.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --ignore-scripts \
    && npm rebuild better-sqlite3

############################
# 2. build stage — tsc
############################
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json ./
COPY server.ts ./
COPY src ./src
COPY scripts ./scripts

RUN node_modules/.bin/tsc -p tsconfig.build.json

############################
# 3. snapshot stage — optional
############################
# Snapshots are intentionally NOT baked into the OSS image because
# eMAFF/FAMIC data must be downloaded by the operator. To bake your own
# snapshots, build the image with --build-arg BAKE_SNAPSHOTS=1 after
# placing the *.sqlite files under ./snapshots/ on the host.
ARG BAKE_SNAPSHOTS=0

############################
# 4. final stage — distroless
############################
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    LOG_LEVEL=info

COPY --from=build  --chown=nonroot:nonroot /app/dist          ./dist
COPY --from=build  --chown=nonroot:nonroot /app/node_modules  ./node_modules
COPY --from=build  --chown=nonroot:nonroot /app/package.json  ./package.json

# Snapshots dir always exists; specific files only present if BAKE_SNAPSHOTS=1.
COPY --chown=nonroot:nonroot snapshots/.gitkeep ./snapshots/.gitkeep

USER nonroot
EXPOSE 8080

# Cloud Run sets $PORT (default 8080); the entry point reads it.
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/server.js", "--http"]
