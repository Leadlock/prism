#!/bin/sh
set -e

# In production, fetch secrets from AWS SSM Parameter Store before starting
# either service so both Node.js and Python inherit them.
# Locally, docker-compose supplies the env via env_file — this is a no-op.
if [ "$NODE_ENV" = "production" ]; then
  echo "[startup] Fetching secrets from SSM (${SSM_PATH:-/prism/prod/})..."
  eval "$(node /app/load-secrets.mjs)"
  echo "[startup] Secrets loaded."
fi

# Wait for DB
./wait-for-db.sh db

# Start Python FastAPI (DPDP tool) in background
uvicorn prism_dpdp.app:app --host 0.0.0.0 --port 8080 &

# Start Node API in foreground
node src/index.js
