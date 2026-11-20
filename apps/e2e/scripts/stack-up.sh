#!/usr/bin/env bash
# Brings the backend stack up for the e2e tests. Idempotent; takes about a minute on a cold start.
set -euo pipefail
cd "$(dirname "$0")/../../../backend"
[ -f .env ] || cp .env.example .env
docker compose up --build -d --wait
set -a; . ./.env; set +a
./scripts/create-kitchen-user.sh
./scripts/seed.sh
echo "backend ready on http://localhost:5080"
