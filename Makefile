# Backend stack and its tests. Run from the repo root. Requires docker, make and k6 (https://k6.io).
# The backend scripts and k6 tests read their settings from backend/.env (created from .env.example).
LOAD_ENV = set -a && . ./.env && set +a

.PHONY: stack-up stack-down kitchen-user seed test-backend

# Backend (Orchard Core + PostgreSQL), kitchen user and sample orders. Idempotent; about a minute cold.
stack-up:
	cd backend && { [ -f .env ] || cp .env.example .env; }
	cd backend && docker compose up --build -d --wait
	$(MAKE) kitchen-user seed
	@echo "backend ready on http://localhost:5080"

# Stops the backend stack and drops its database volume.
stack-down:
	cd backend && docker compose down -v

# The shared kitchen account (role Kitchen), through the Orchard admin form. Idempotent.
kitchen-user:
	cd backend && $(LOAD_ENV) && scripts/create-kitchen-user.sh

# Sample orders for yesterday, today and tomorrow (development only). Idempotent.
seed:
	cd backend && $(LOAD_ENV) && k6 run --quiet k6/seed.js

# Integration tests against the running stack; a second kitchen-user run must report "exists" (idempotent).
test-backend: kitchen-user
	cd backend && $(LOAD_ENV) && scripts/create-kitchen-user.sh | grep -q exists
	cd backend && $(LOAD_ENV) && k6 run k6/integration.js
