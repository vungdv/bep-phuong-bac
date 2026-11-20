# Plan: Orders API (backend)

Spec: [specs/2026-11-20-orders-api.spec.md](../../specs/2026-11-20-orders-api.spec.md)

Open questions resolved with the spec's stated defaults: TypeScript + Fastify + Postgres; unauthenticated private-network v1; client sends the date; `no` is stored. Docker 29 is available, so tests use Testcontainers Postgres.

All files live in `apps/orders-api/` unless noted (one bounded context). Tasks T1→T5 are sequential, because their file scopes overlap through `server.ts` and the route file.

| Task | Title | Spec | File scope | Depends |
|---|---|---|---|---|
| T1 | Scaffold, config, migration, store | S1–S5, B16 (readyz) | `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts`, `src/domain/order.ts`, `src/store/*`, `src/cli/migrate.ts`, `src/cli/seed.ts`, `migrations/0001_create_orders.sql`, root `docker-compose.yml` | none |
| T2 | List orders slice | B1–B8, B12, B13 | `src/server.ts`, `src/http/orders-route.ts`, `src/http/problem.ts`, `src/service/orders-service.ts`, tests | T1 |
| T3 | Set-delivered slice | B17–B24, B9, B10–B11 | same files + `PATCH` tests | T2 |
| T4 | CORS, health, shutdown, errors | B9–B11, B14–B16 | `src/server.ts`, `src/main.ts` | T3 |
| T5 | Observability + OpenAPI contract test | O1–O5, contract | `src/telemetry.ts`, `src/logger.ts`, `openapi.yaml`, contract test, `README.md` section | T4 |

Acceptance for every task: reviewer `APPROVE`, `pnpm --filter @bpb/orders-api typecheck test build` pass. Final: root `pnpm typecheck test build` pass and the spec's acceptance criteria 1–7 hold.
