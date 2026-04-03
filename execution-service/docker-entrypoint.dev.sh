#!/usr/bin/env sh
set -e
cd /app

# Named volume hides image node_modules; install once (and after volume wipe).
if [ ! -d "node_modules/@adonisjs/core" ]; then
  echo "[dev] Installing dependencies from package-lock.json..."
  npm ci
fi

exec "$@"
