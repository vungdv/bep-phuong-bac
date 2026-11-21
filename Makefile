# Backend stack and its tests. Run from the repo root. Requires docker, make and k6 (https://k6.io).
# The backend scripts and k6 tests read their settings from backend/.env (created from .env.example).
LOAD_ENV = set -a && . ./.env && set +a

.PHONY: dev stack-up stack-down kitchen-user seed test-backend llm-up llm-pull stub-up

# Everything for local development: JS dependencies, the backend stack, then both frontends (blocks; Ctrl-C stops them).
dev: stack-up
	npm run dev

# JS dependencies, then backend (Orchard Core + PostgreSQL), kitchen user and sample orders. Idempotent; about a minute cold.
# Returns when done (CI and deploy/quick-tunnel.sh call it); `make dev` also starts the frontends.
stack-up:
	pnpm install
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

# Local model server (compose profile `llm`, not part of stack-up: the model is a multi-GB download). Starts Ollama and
# pulls the model once (the pull is a no-op when it is already there). Uses its own volume and publishes no host port, so an
# Ollama already running on the host (localhost:11434) is not touched. Run `make stack-up` first or after; the backend
# reaches it at http://ollama:11434 (default of Bpb:Llm:Endpoint).
LLM_MODEL ?= qwen2.5:7b-instruct
llm-up:
	cd backend && { [ -f .env ] || cp .env.example .env; }
	cd backend && docker compose --profile llm up -d --wait ollama
	$(MAKE) llm-pull

llm-pull:
	cd backend && docker compose --profile llm exec ollama ollama pull $(LLM_MODEL)

# Points the backend at the deterministic llm-stub (compose profile `test`) instead of Ollama. `make stack-up` points it back.
# The timeout is shortened for the test run only (the pipeline test needs an LLM timeout scenario); the default stays 120.
STUB_LLM_TIMEOUT_SECONDS ?= 5
stub-up:
	cd backend && { [ -f .env ] || cp .env.example .env; }
	cd backend && LLM_ENDPOINT=http://llm-stub:8080 LLM_TIMEOUT_SECONDS=$(STUB_LLM_TIMEOUT_SECONDS) docker compose --profile test up --build -d --wait

# Integration tests against the running stack; a second kitchen-user run must report "exists" (idempotent).
# The LLM is the stub (see stub-up), so no model is needed; the k6 LLM test also reads the stub's request log.
test-backend: stub-up kitchen-user
	cd backend && $(LOAD_ENV) && scripts/create-kitchen-user.sh | grep -q exists
	@cd backend && $(LOAD_ENV) && { k6 run k6/integration.js && k6 run k6/llm-extract.js && k6 run k6/pipeline.js; rc=$$?; \
	  echo "pointing the backend back at the default LLM endpoint"; docker compose up -d --wait backend; exit $$rc; }

# Temporary public URL through a Cloudflare quick tunnel; resets the backend stack (see deploy/README.md).
.PHONY: public
public:
	deploy/quick-tunnel.sh
