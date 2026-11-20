# Plan: Order backend on Orchard Core

Spec: [specs/2026-11-20-backend-order.spec.md](../../specs/2026-11-20-backend-order.spec.md). Scope markers: Non-goals (no Zalo ingestion, no custom REST layer, no UI changes beyond the adapter), slice 5 (observability) not in this run.

## Tasks

| # | Task | Spec | File scope | Depends on | Done when |
|---|---|---|---|---|---|
| T1 | Backend skeleton: host, recipe (schema, indexing, OpenID server, CORS, sample data), PostgreSQL compose, Dockerfile, health check | B1–B7, B12, B13, B16 | `backend/**` | — | `docker compose up` provisions itself; token request works; no-token call gets `401`; preflight from allowed origin passes; sample data present |
| T2 | Read path: `http.ts` + `OrchardOrdersApi.listOrders`, config switch in `app.tsx` | B8, B14 | `apps/orders/src/api/{http,orchard-orders-api}.ts(+test)`, `apps/orders/src/app.tsx` | T1 for contract test | unit tests pass; contract test passes against the container |
| T3 | Write path: `setDelivered` read-modify-write, error mapping | B9, B10 | `apps/orders/src/api/orchard-orders-api.ts(+test)` | T2 | unit + contract tests pass |
| T4 | UI auth: Authorization Code + PKCE, public client | B11 | `apps/orders/src/auth/**`, `backend/**/Recipes`, `app.tsx` | T1–T3 | no secret in `dist/`; sign-in works |
| T5 | Playwright (headed) e2e against the running stack | Acceptance 2–5 | `e2e/**` | T1–T4 | tick survives reload; no-token gets `401` |

T1 → T2 → T3 → T4 → T5 run in order. T2 and T3 share a file, so they are not parallel.

## Open decision

T5 cannot run a real browser flow without T4. Without T4 the UI has no way to get a token.

## Out of this run

Slice 5 (OpenTelemetry, B15, B17).
