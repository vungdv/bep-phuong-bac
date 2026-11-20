# Orders API (backend)

Status: **Draft, ready for planning** · Owner: orders bounded context · Related: [2026-11-20-order-management.spec.md](2026-11-20-order-management.spec.md)

A backend service that serves **every API the order-management front-end uses**: list the pre-orders for one day, and set an order's delivered flag. It implements the "Target REST contract" of the front-end spec, so the front-end can swap its `localStorage` mock for this service by changing only the `OrdersApi` implementation.

## Context

The order-management spec defines a "Target REST contract" for a future backend and says the mock mirrors it. The front-end's `OrdersApi` has two methods, `listOrders` and `setDelivered`, so this spec builds both: `GET /orders` and `PATCH /orders/{id}`. Creating orders (from Zalo or a form) is not a front-end API today and is separate.

## Goals

1. Provide `GET /orders?serviceDate=YYYY-MM-DD`, returning every order for that service day, sorted by `no`.
2. Provide `PATCH /orders/{id}`, setting an order's delivered flag and returning the updated order.
3. Match the `Order` shape in the front-end spec, so the client needs no mapping layer.
4. Persist orders in a real database with forward-only migrations, so dev and prod behave the same.
5. Be observable from day one: W3C trace context, structured JSON logs and request metrics.
6. Be a complete vertical slice (HTTP → service → repository → database) inside the orders bounded context.

## Non-goals

- Creating, cancelling or deleting orders, and editing any field other than the delivered flag. Rows come from a seed script until an ingestion spec exists.
- Authentication and authorization. v1 is an internal service on a private network, and the endpoint is unauthenticated. This is an open question (see below), and it must be settled before any public exposure.
- Paging, filtering, search, sorting by other fields, and date ranges. A single day holds a small number of orders.
- Changing the front-end. Wiring `HttpOrdersApi` into `apps/orders` is a separate change in that context.
- Zalo ingestion, multi-tenant support and rate limiting.

## Users and stories

| ID | Story |
|---|---|
| US1 | As the orders front-end, I can request one day's orders and receive them in kitchen order (by `no`), so I can render the table. |
| US2 | As the orders front-end, I get an empty list for a day with no orders, so I can show the "no orders" state. |
| US3 | As the orders front-end, I get a clear error for a malformed date, so I can tell a bug from an empty day. |
| US4 | As the orders front-end, I can mark an order delivered or not delivered, and I get the saved order back, so the table shows the server's truth. |
| US5 | As an operator, I can trace one request from the browser through the API and into the logs, and I can see its latency and error rate. |

## Requirements (EARS)

Systems: **API** (the HTTP service) and **store** (the Postgres schema and repository).

### List orders (US1, US2)

| ID | Pattern | Requirement |
|---|---|---|
| B1 | Event-driven | When the API receives `GET /orders?serviceDate=YYYY-MM-DD` with a valid date, the API shall respond `200 OK` with `Content-Type: application/json` and a JSON array of the orders whose service day equals that date. |
| B2 | Ubiquitous | The API shall return the orders sorted in ascending order of `no`. |
| B3 | Unwanted behaviour | If no order exists for the requested day, then the API shall respond `200 OK` with an empty array `[]`, not `404`. |
| B4 | Ubiquitous | The API shall return each order with exactly these fields: `id`, `no`, `name`, `qty`, `message`, `createdAt`, `serviceDate`, `delivered`. |
| B5 | Ubiquitous | The API shall return `createdAt` as an ISO 8601 timestamp with a UTC offset, `serviceDate` as `YYYY-MM-DD`, `message` as `""` when empty, and `delivered` as a boolean. |
| B6 | Ubiquitous | The API shall not return orders from any other service day. |

### Set delivered (US4)

| ID | Pattern | Requirement |
|---|---|---|
| B17 | Event-driven | When the API receives `PATCH /orders/{id}` with `Content-Type: application/merge-patch+json` and a body `{"delivered": true}` or `{"delivered": false}` for an existing order, the API shall persist the flag and respond `200 OK` with the updated order. |
| B18 | Ubiquitous | The API shall make the update idempotent: it sets the flag and never toggles it, so repeating a request leaves the same state and the same response. |
| B19 | Unwanted behaviour | If no order has the given `id` (or `id` is not a valid UUID), then the API shall respond `404 Not Found` as Problem Details. |
| B20 | Unwanted behaviour | If the body is not valid JSON, is not an object, lacks `delivered`, has a non-boolean `delivered`, or names any member other than `delivered`, then the API shall respond `400 Bad Request` as Problem Details and shall not change the order. |
| B21 | Unwanted behaviour | If the `Content-Type` is not `application/merge-patch+json`, then the API shall respond `415 Unsupported Media Type` as Problem Details and shall list the accepted type in `Accept-Patch`. |
| B22 | Ubiquitous | The API shall change only the `delivered` column. `no`, `name`, `qty`, `message`, `createdAt` and `serviceDate` shall stay unchanged. |
| B23 | Unwanted behaviour | If the write fails, then the API shall respond `503` or `500` as Problem Details (as B10) and leave the stored order unchanged. |
| B24 | Ubiquitous | The API shall send `Cache-Control: no-store` on `PATCH` responses. |

### Validation and errors (US3)

| ID | Pattern | Requirement |
|---|---|---|
| B7 | Unwanted behaviour | If `serviceDate` is missing, then the API shall respond `400 Bad Request` as Problem Details. |
| B8 | Unwanted behaviour | If `serviceDate` is not a real calendar date in `YYYY-MM-DD` form (for example `2026-13-01`, `2026-02-30`, `20-11-2026`), then the API shall respond `400 Bad Request` as Problem Details. |
| B9 | Unwanted behaviour | If the request names an unsupported method on `/orders` or `/orders/{id}`, then the API shall respond `405 Method Not Allowed` with an `Allow` header listing the methods the path supports (`GET, HEAD` on `/orders`; `PATCH` on `/orders/{id}`). |
| B10 | Unwanted behaviour | If the store is unreachable or a query fails, then the API shall respond `503 Service Unavailable` (unreachable) or `500 Internal Server Error` (other failure) as Problem Details, without leaking SQL or stack traces. |
| B11 | Ubiquitous | The API shall format every error response as RFC 7807 Problem Details (`application/problem+json`) with `type`, `title`, `status` and `detail`, and shall include the `trace_id` as an extension member. |
| B12 | Unwanted behaviour | If the request has an unknown query parameter, then the API shall ignore it. |

### HTTP behaviour

| ID | Pattern | Requirement |
|---|---|---|
| B13 | Ubiquitous | The API shall send `Cache-Control: no-cache` on `200` responses, so clients always revalidate, because the delivered flag will change in a later spec. |
| B14 | Event-driven | When a request comes from an allowed origin, the API shall answer CORS with that origin in `Access-Control-Allow-Origin`, and shall answer a preflight `OPTIONS` request with `204` that allows `GET`, `PATCH` and the headers `Content-Type` and `traceparent`. The allowed origins come from configuration. |
| B15 | Unwanted behaviour | If the request comes from an origin that is not allowed, then the API shall not send CORS headers. |
| B16 | Ubiquitous | The API shall expose `GET /healthz` (liveness, no dependencies) and `GET /readyz` (readiness, checks the store) and shall return `200` when healthy and `503` when not. |

### Store

| ID | Pattern | Requirement |
|---|---|---|
| S1 | Ubiquitous | The store shall hold orders in an `orders` table created by version-controlled, forward-only SQL migrations, with no DDL outside migrations. |
| S2 | Ubiquitous | The store shall enforce uniqueness of (`service_date`, `no`) and `qty > 0`, and shall index `service_date`. |
| S3 | Ubiquitous | The store shall keep `service_date` as a `date` (no time zone) and `created_at` as `timestamptz`. |
| S4 | Event-driven | When the API starts, the API shall not run migrations itself. A separate `migrate` command shall apply them, and `/readyz` shall report not ready if the schema version is behind. |
| S5 | Ubiquitous | The repository shall read orders only for the requested day, using a parameterised query. |

### Observability (US5)

| ID | Pattern | Requirement |
|---|---|---|
| O1 | Event-driven | When a request carries a W3C `traceparent` header, the API shall continue that trace. When it carries none, the API shall start a new trace. |
| O2 | Ubiquitous | The API shall record a server span per request and the repository query as a child span, set the span status from the HTTP status, and record exceptions on the span. |
| O3 | Ubiquitous | The API shall write one structured JSON log line per request to `stdout`, with `trace_id`, `span_id`, `method`, `path`, `status` and `duration_ms`. It shall not log full query strings with personal data or order contents. |
| O4 | Ubiquitous | The API shall export metrics over OTLP: a request counter, a latency histogram and an error counter, labelled by route template and status class. |
| O5 | Ubiquitous | The API shall echo the trace id in a `traceparent` response header. |

## Architecture

### Stack

TypeScript (strict) on Node.js, Fastify, PostgreSQL, `pg`, SQL migrations (`node-pg-migrate`), OpenTelemetry (`@opentelemetry/sdk-node`, OTLP exporter), `pino` for logs. Tests: Vitest, Testcontainers (real Postgres), `fastify.inject`. This matches the monorepo's TypeScript and pnpm tooling. The stack is an open question.

### Packaging

- New workspace package `@bpb/orders-api` in `apps/orders-api/`, included by the existing `apps/*` glob.
- Scripts: `dev`, `build`, `test`, `typecheck`, `start`, `migrate`, `seed`.
- `docker-compose.yml` at the repo root runs Postgres for local development, so dev matches prod semantics. No SQLite or in-memory substitute.
- Configuration comes from the environment (12-factor): `DATABASE_URL`, `PORT`, `CORS_ALLOWED_ORIGINS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`. The service fails fast at start-up when `DATABASE_URL` is missing. No secrets in the repo.

### Modules

```
apps/orders-api/
  openapi.yaml              # OpenAPI 3.1 contract, the source of truth for B1–B24
  migrations/0001_create_orders.sql
  src/
    main.ts                 # composition root: config → telemetry → store → server
    config.ts               # env parsing and validation
    telemetry.ts            # OTel SDK, trace context, metrics
    logger.ts               # pino with trace_id / span_id injection
    server.ts               # Fastify app factory: routes, CORS, error handler
    http/orders-route.ts    # GET /orders and PATCH /orders/{id}: validate, call service, map result
    http/problem.ts         # RFC 7807 builder and error handler
    domain/order.ts         # Order type, serviceDate parsing (pure)
    service/orders-service.ts  # listOrders(serviceDate), setDelivered(id, delivered) — depends on OrdersRepository interface
    store/orders-repository.ts # OrdersRepository interface
    store/pg-orders-repository.ts  # Postgres implementation
    store/pool.ts           # pg pool, timeouts, health check
    cli/migrate.ts          # migration runner
    cli/seed.ts             # dev seed: orders for yesterday, today and tomorrow
```

Dependencies flow one way: `http → service → store (interface) ← pg implementation`. The domain imports nothing. Only the repository touches SQL.

### Data model

```sql
CREATE TABLE orders (
  id           uuid PRIMARY KEY,
  service_date date        NOT NULL,
  no           integer     NOT NULL CHECK (no > 0),
  name         text        NOT NULL,
  qty          integer     NOT NULL CHECK (qty > 0),
  message      text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered    boolean     NOT NULL DEFAULT false,
  UNIQUE (service_date, no)
);
CREATE INDEX orders_service_date_idx ON orders (service_date);
```

The response maps `service_date` → `serviceDate`, `created_at` → `createdAt`.

### API contract

```
GET /orders?serviceDate=2026-11-20
200 OK
Content-Type: application/json
Cache-Control: no-cache
traceparent: 00-<trace-id>-<span-id>-01

[
  {
    "id": "6f1c…",
    "no": 1,
    "name": "Nguyen Van A",
    "qty": 2,
    "message": "No chili",
    "createdAt": "2026-11-19T08:30:00+07:00",
    "serviceDate": "2026-11-20",
    "delivered": false
  }
]
```

```
GET /orders?serviceDate=2026-02-30
400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://bepphuongbac.example/problems/invalid-service-date",
  "title": "Invalid service date",
  "status": 400,
  "detail": "serviceDate must be a real date in YYYY-MM-DD form.",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

- `serviceDate` is a plain calendar date with no time zone. The client decides which day "today" is. The server never converts it. This keeps the API independent of the open time-zone question.
- Timestamps in `createdAt` are rendered in UTC (`+00:00`). The client formats them for display.
- `GET` is safe and idempotent (RFC 9110), so clients and intermediaries may retry it.

```
PATCH /orders/6f1c…
Content-Type: application/merge-patch+json

{ "delivered": true }

200 OK
Content-Type: application/json
Cache-Control: no-store

{ "id": "6f1c…", "no": 1, …, "delivered": true }
```

`PATCH` uses JSON Merge Patch (RFC 7396). The only patchable member is `delivered`. A missing order gives `404`, as in the front-end contract. Repeating the call is safe, so no `Idempotency-Key` is needed.

### Resilience

- A pool with a connection limit, a connection timeout and a statement timeout (default 5 s). A timeout maps to `503` (B10).
- No retry loop inside the service. Retries belong to the client (TanStack Query already retries).
- Graceful shutdown on `SIGTERM`: stop accepting, drain in-flight requests, close the pool, flush telemetry.

## Testing

Every requirement is covered by at least one automated test. Tests use the real HTTP interface and a real Postgres, and mock only the OTLP exporter boundary.

| Area | Covers | Tests |
|---|---|---|
| Route (`inject` + Testcontainers Postgres) | B1–B6 | Returns only the requested day's orders, sorted by `no`; `[]` for an empty day; exact field set and formats; no cross-day leakage; `HEAD` works. |
| Set delivered | B17–B24 | Sets and clears the flag and returns the updated order; repeating the call gives the same result; persists across a new request; unknown or non-UUID id gives `404`; invalid JSON, missing, non-boolean or extra members give `400` and change nothing; wrong content type gives `415` with `Accept-Patch`; other columns stay unchanged; a failing write gives `503`/`500` and leaves the row unchanged. |
| Validation | B7–B9, B12 | Missing, malformed, impossible (`2026-02-30`, `2026-13-01`) and wrong-format dates return `400` Problem Details; `POST`/`PUT`/`DELETE` on `/orders` and `GET`/`DELETE` on `/orders/{id}` return `405` with `Allow`; an unknown query parameter is ignored. |
| Errors | B10, B11 | A repository that throws gives `500`; a stopped database gives `503`; neither leaks SQL or stack traces; Problem Details has the required members and `trace_id`. |
| HTTP | B13–B16 | `Cache-Control` on `200`; CORS for an allowed and a disallowed origin; preflight returns `204`; `/healthz` stays `200` with the DB down, and `/readyz` returns `503`. |
| Store and migrations | S1–S5 | Migrations apply to an empty database, and re-applying changes nothing; (`service_date`, `no`) uniqueness and `qty > 0` are enforced; the query is parameterised (a hostile date string never reaches SQL, because B8 rejects it first); `/readyz` is not ready on an old schema. |
| Service | B2, B3, B17–B19 | With a fake `OrdersRepository`: passes the date through, preserves repository order, returns `[]`; `setDelivered` returns the updated order and surfaces not-found. |
| Observability | O1–O5 | An incoming `traceparent` is continued and echoed; a missing one starts a new trace; the span tree has server and repository spans with status set; the log line has `trace_id`, `span_id`, `status` and `duration_ms` and no order contents; metrics are recorded. Uses an in-memory span and metric exporter. |
| Contract | B1–B24 | A response validator generated from `openapi.yaml` checks every response in the route tests, so the spec and the code cannot drift. |

## Acceptance criteria

1. `docker compose up -d db && pnpm --filter @bpb/orders-api migrate && pnpm --filter @bpb/orders-api seed` creates the schema and the sample orders.
2. `curl 'localhost:8080/orders?serviceDate=<today>'` returns the seeded orders for today, sorted by `no`, with all eight fields.
3. A day with no orders returns `200 []`. A malformed date returns `400 application/problem+json`.
4. `PATCH /orders/{id}` with `{"delivered":true}` returns the updated order, and a following `GET` shows `delivered: true`. An unknown id returns `404`.
5. A request with a `traceparent` header yields a log line and a span with the same trace id.
6. `openapi.yaml` validates as OpenAPI 3.1, and all route tests pass against it.
7. Root `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Open questions

1. **Stack.** Is TypeScript on Node and Fastify with Postgres acceptable, or should the backend use another stack (for example Java and Spring Boot with Flyway)? The requirements are stack-neutral, and only the Architecture section would change.
2. **Authentication.** Who may call this endpoint? v1 assumes a private network. Should it require an OIDC bearer token (JWT validated against a JWKS) before it is exposed to the internet?
3. **Time zone.** Should the server fix the service day to `Asia/Ho_Chi_Minh` (and offer `GET /orders` without a date meaning "today")? The v1 default is that the client always sends the date.
4. **Where does `no` come from** once orders can be created? The assumption is a per-day counter assigned at insert, protected by the unique constraint.
5. **Deployment target** for the API and Postgres (managed service, container host), which decides the CORS origins and the OTLP collector.
