# syntax=docker/dockerfile:1
# Pin Node 24.x image digests/tags in CI or here when you upgrade — AdonisJS 7+ expects Node 24+.
# https://docs.adonisjs.com/guides/getting-started/deployment

ARG NODE_VERSION=24.11.0

# ----------------------------
# Stage 1: install all dependencies (incl. devDependencies for the compiler)
# ----------------------------
FROM node:${NODE_VERSION}-bookworm AS deps
WORKDIR /app

# Build tooling needs devDependencies (TypeScript, assembler, etc.)
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

# ----------------------------
# Stage 2: compile TypeScript → standalone ./build
# ----------------------------
FROM deps AS build
WORKDIR /app

COPY . .
RUN node ace build

# ----------------------------
# Stage 3: minimal runtime with production deps only
# ----------------------------
ARG NODE_VERSION=24.11.0
FROM node:${NODE_VERSION}-bookworm-slim AS production
WORKDIR /app

ENV NODE_ENV=production

# Native addons (e.g. better-sqlite3) need a compiler during `npm ci` in slim images.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/build ./

# Reproducible install from lockfile; production-only deps (see Adonis build output package.json).
RUN npm ci --omit=dev

EXPOSE 3333

# Standalone build entrypoint (from project root package.json "start" script).
CMD ["node", "bin/server.js"]
