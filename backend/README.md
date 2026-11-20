# Backend (Orchard Core)

One ASP.NET Core host, `Bpb.Backend`, that references `OrchardCore.Application.Cms.Targets` and owns no C# beyond 6 lines in `Program.cs`. The `Order` schema, OpenID server, CORS and health check come from `Bpb.Backend/Recipes/BpbOrders.recipe.json`. Spec: `specs/2026-11-20-backend-order.spec.md`.

## Run

```sh
cd backend
cp .env.example .env          # dev-only values; .env is gitignored
docker compose up --build -d --wait   # PostgreSQL + backend on http://localhost:5080
set -a; . ./.env; set +a      # the scripts below read SCRIPT_CLIENT_SECRET, ADMIN_PASSWORD, KITCHEN_* from the environment
./scripts/create-kitchen-user.sh      # the shared kitchen account (role Kitchen), once; idempotent
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
| `KITCHEN_USERNAME`, `KITCHEN_PASSWORD` | the shared kitchen account used by the orders app; read only by `scripts/create-kitchen-user.sh` and the tests, never by the backend container |
| `UI_REDIRECT_URIS` | optional, space-separated redirect URIs of the public client `bpb-orders-ui` (default `http://localhost:5173/ http://localhost:5174/`); set it for another origin (`OrchardCore__Bpb__UiRedirectUris`, read by the recipe) |
| `CORS_ALLOWED_ORIGINS` | optional, space- or comma-separated browser origins allowed by CORS (default `http://localhost:5173 http://localhost:5174`; never `*`; at most 4, the recipe has four slots, extras are ignored; `OrchardCore__Bpb__CorsAllowedOrigins`) |
| `SCRIPT_CLIENT_SECRET` | secret of the confidential client `bpb-orders-script` (`OrchardCore__Bpb__ScriptClientSecret`, read by the recipe via `configuration('Bpb:ScriptClientSecret')`) |
| `OrchardCore__OrchardCore_AutoSetup__Tenants__0__DatabaseConnectionString` | PostgreSQL connection string (set by compose) |

Non-secret defaults (provider `Postgres`, table prefix `bpb`, time zone) are in `appsettings.json`. CORS allowed origins come from `CORS_ALLOWED_ORIGINS` (defaults in the recipe). Like the redirect URIs they are applied when the tenant is first created; changing them later needs a fresh database (`docker compose down -v`).

Persistence: the named volume `appdata` (`/app/App_Data`: tenant shell settings and the tenant's data-protection keys) and `dpkeys-host` (`/root/.aspnet/DataProtection-Keys`) survive container recreation, so issued tokens and cookies keep working and a recreated container does not re-run setup against the existing database. `docker compose down -v` removes them together with the database.

## Endpoints

| Path | Auth | Use |
|---|---|---|
| `GET /health/live` | none | health check (container `HEALTHCHECK`) |
| `GET /connect/authorize` | browser login | Authorization Code + PKCE for the public client `bpb-orders-ui` |
| `POST /connect/token` | code + PKCE, refresh token (public client), client credentials (script client) | OpenID token |
| `POST /api/graphql` | bearer | read orders |
| `POST /api/content` | bearer | create or replace an order (body key `ContentType`) |

List a day: `{ order(where:{serviceDate:"2026-11-21"}, orderBy:{createdUtc:ASC}) { contentItemId no customerName qty message serviceDate delivered createdUtc } }`.

**`ServiceDate` is a text field holding `YYYY-MM-DD`.** On PostgreSQL, Orchard Core 3.0.1 binds date/datetime GraphQL filter values as text and the query fails (`operator does not exist: timestamp without time zone > text`), so the Date field cannot be filtered. Text equality works and returns exactly one day.

## Sign-in (B11, B12)

- **Orders app**: public client `bpb-orders-ui` (no secret), Authorization Code + PKCE (S256 required), refresh tokens, scopes `openid offline_access`, implicit consent. Redirect URIs are the origin roots (`http://localhost:5173/`, `http://localhost:5174/`; override with `UI_REDIRECT_URIS`).
- **Scripts and tests**: confidential client `bpb-orders-script`, client credentials, role Administrator.
- **Shared kitchen account** (one login for every chef): username and password from `KITCHEN_USERNAME` / `KITCHEN_PASSWORD`, role **Kitchen**, not Administrator. The recipe defines the role with these permissions only: `AccessContentApi`, `ApiViewContent`, `ExecuteGraphQL`, `View_Order`, `Edit_Order`, `Publish_Order`. It can read and update orders (and create them, which `Edit_Order` + `Publish_Order` allow); it cannot delete them, create other content types or use the admin UI.
- **Why a script creates the user**: Orchard Core 3.0.1 has no user REST API, and the recipe `users` step cannot set a password (it only imports a stored hash, which would have to live in source). `scripts/create-kitchen-user.sh` signs in to the admin as `admin` and submits the standard admin "create user" form. It is idempotent (an account that can already sign in is left alone).
- `tests/oidc-code-flow.sh` runs a real Authorization Code + PKCE round trip with curl (login form included) and prints the token response.

## Local dev without Docker

Run PostgreSQL yourself, export the variables above (plus `ASPNETCORE_URLS`), then `dotnet run --project Bpb.Backend --no-launch-profile`.
