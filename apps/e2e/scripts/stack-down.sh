#!/usr/bin/env bash
# Stops the backend stack and drops its database volume.
set -euo pipefail
cd "$(dirname "$0")/../../../backend"
docker compose down -v
