# Backend (Orchard Core)

One ASP.NET Core host, `Bpb.Backend`, that references `OrchardCore.Application.Cms.Targets` and owns no C# beyond 6 lines in `Program.cs`. The `Order` schema, OpenID server, CORS and health check come from `Bpb.Backend/Recipes/BpbOrders.recipe.json`. Spec: `specs/2026-11-20-backend-order.spec.md`.

## Run

```sh
cd backend
cp .env.example .env          # dev-only values; .env is gitignored
docker compose up --build -d  # PostgreSQL + backend on http://localhost:5080
./scripts/seed.sh             # sample orders for yesterday/today/tomorrow (dev only, idempotent)
./tests/integration.sh        # bash + curl checks against the running stack
docker compose down -v        # stop and drop the database
```

First start auto-provisions the `Default` tenant (OrchardCore.AutoSetup) and runs the `BpbOrders` recipe. Admin UI: `http://localhost:5080/admin` (user `admin`, password `ADMIN_PASSWORD`).

## Configuration (environment, never source)

| Variable | Meaning |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password (compose uses it for both containers) |
| `ADMIN_PASSWORD` | OC admin password (`...AutoSetup__Tenants__0__AdminPassword`) |
| `SCRIPT_CLIENT_SECRET` | secret of the confidential client `bpb-orders-script` (`OrchardCore__Bpb__ScriptClientSecret`, read by the recipe via `configuration('Bpb:ScriptClientSecret')`) |
| `OrchardCore__OrchardCore_AutoSetup__Tenants__0__DatabaseConnectionString` | PostgreSQL connection string (set by compose) |

Non-secret defaults (provider `Postgres`, table prefix `bpb`, time zone) are in `appsettings.json`. CORS allowed origins (`http://localhost:5173`, `http://localhost:5174`) are in the recipe.

## Endpoints

| Path | Auth | Use |
|---|---|---|
| `GET /health/live` | none | health check (container `HEALTHCHECK`) |
| `POST /connect/token` | client credentials | OpenID token |
| `POST /api/graphql` | bearer | read orders |
| `POST /api/content` | bearer | create or replace an order (body key `ContentType`) |

List a day: `{ order(where:{serviceDate:"2026-11-21"}, orderBy:{createdUtc:ASC}) { contentItemId no customerName qty message serviceDate delivered createdUtc } }`.

**`ServiceDate` is a text field holding `YYYY-MM-DD`.** On PostgreSQL, Orchard Core 3.0.1 binds date/datetime GraphQL filter values as text and the query fails (`operator does not exist: timestamp without time zone > text`), so the Date field cannot be filtered. Text equality works and returns exactly one day.

## Local dev without Docker

Run PostgreSQL yourself, export the variables above (plus `ASPNETCORE_URLS`), then `dotnet run --project Bpb.Backend --no-launch-profile`.
