#!/bin/sh
set -e

# Wait for DB
./wait-for-db.sh db

# Start Python FastAPI (DPDP tool) in background
uvicorn prism_dpdp.app:app --host 0.0.0.0 --port 8080 &

# Start Node API in foreground
node src/index.js
