# Introduction
A simple app that read order from a channel like zalo and create/manage orders for skillfull masterchef who wants a perfect meal for their customer. 


## Orders app

Run it standalone (port 5174, renders `<orders-app>` from `apps/orders/index.html`):

```sh
pnpm --filter @bpb/orders dev
```

Run it inside the shell (port 5173). Start both dev servers, then open `http://localhost:5173/#/order` (or `/#/`, the home app). In dev, `apps/shell/public/host.config.json` loads the remote from `http://localhost:5174/src/orders-app.ts`.

```sh
pnpm --filter @bpb/orders dev   # terminal 1
pnpm --filter @bpb/shell dev    # terminal 2
```

Orders are mocked in `localStorage` (seeded once per day, then persisted). Clear site data to reseed.

Deploy: `pnpm build`, then copy `apps/orders/dist/orders-app.js` to `apps/shell/dist/remotes/orders/` (CI does this). `host.config.prod.json` loads `./remotes/orders/orders-app.js`.

## Orders API

Backend for the orders app (`apps/orders-api`): Fastify, PostgreSQL, OpenTelemetry. Contract: [`apps/orders-api/openapi.yaml`](apps/orders-api/openapi.yaml); spec: `specs/2026-11-20-orders-api.spec.md`.

Run it locally (Docker required for Postgres):

```sh
docker compose up -d db
export DATABASE_URL=postgres://orders:orders@localhost:5432/orders
pnpm --filter @bpb/orders-api migrate   # the API never migrates on start
pnpm --filter @bpb/orders-api seed      # orders for yesterday, today, tomorrow
pnpm --filter @bpb/orders-api dev       # http://localhost:8080
```

Environment (12-factor, no secrets in the repo):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string; the service fails fast without it |
| `PORT` | `8080` | HTTP port |
| `CORS_ALLOWED_ORIGINS` | none | Comma-separated allowed origins |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP/HTTP base URL for traces and metrics; nothing is exported when unset (trace ids and logs still work) |
| `OTEL_SERVICE_NAME` | `orders-api` | Service name on telemetry |
| `LOG_LEVEL` | `info` | pino level |

Endpoints: `GET /orders?serviceDate=YYYY-MM-DD`, `PATCH /orders/{id}` (`application/merge-patch+json`, body `{"delivered": true}`), `GET /healthz`, `GET /readyz`. Errors are RFC 7807 `application/problem+json` with a `trace_id`; every response carries a `traceparent` header.

```sh
curl -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" \
  "localhost:8080/orders?serviceDate=$(date +%F)"
```

Tests (Docker required: Testcontainers starts a real Postgres for the store and route tests):

```sh
pnpm --filter @bpb/orders-api test
pnpm --filter @bpb/orders-api typecheck
```
