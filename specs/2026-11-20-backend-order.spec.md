# Order Backend on Orchard Core (spike)

Status: **Spike complete, ready for planning** · Owner: orders bounded context · Front-end: [2026-11-20-order-management.spec.md](2026-11-20-order-management.spec.md)

## Goal

Provide a backend for the orders front-end. Keep the code we own to a minimum, because this is very simple order management. This spike tests whether [Orchard Core](https://orchardcore.net/) (OC) can be that backend, and defines what to build if it can.

## Verdict

**Go, with one adapter on the front-end.** OC gives us storage, an admin UI, a typed content model, a GraphQL read API, a content write API and an OpenID Connect server, all from configuration and one recipe file. We write about 10 lines of C# and no controllers.

OC does **not** expose the REST contract that the front-end spec planned (`GET /orders?serviceDate=`, `PATCH /orders/{id}`, Problem Details). We therefore replace the `LocalStorageOrdersApi` with an `OrchardOrdersApi` that speaks OC's own APIs. The `OrdersApi` seam stays unchanged, so the UI, queries and tests do not change.

## What the spike ran

A throwaway host (`Microsoft.NET.Sdk.Web`, .NET 10, `OrchardCore.Application.Cms.Targets` **3.0.1**, SQLite) set up by an auto-setup recipe. Facts below were observed against that running host, not read from docs. Anything not run is listed under [Not verified](#not-verified).

| # | Question | Result |
|---|---|---|
| 1 | Can the schema be defined as code, not clicked in the admin? | **Yes.** A recipe (`ContentDefinition` step) creates the `Order` type and fields on first start. |
| 2 | Can the site provision itself with no human? | **Yes.** `OrchardCore.AutoSetup` plus an `appsettings.json` tenant block, with `AddSetupFeatures("OrchardCore.AutoSetup")` in `Program.cs`. Without that call the setup page shows and nothing happens. |
| 3 | Machine auth | **Yes.** Recipe steps `OpenIdServerSettings` and `OpenIdApplication` give a client-credentials token at `POST /connect/token`. Needs features `OpenId`, `OpenId.Server` **and** `OpenId.Validation`. With Server alone, the API answers `401` to a valid token. |
| 4 | List a day's orders | **Yes, via GraphQL** `POST /api/graphql`. Needs feature `ContentFields.Indexing.SQL` and `ContentIndexSettings.Included: true` on each field, or `where` cannot filter by field. |
| 5 | Sort by `No` | **No.** `orderBy` offers only content-item fields (`createdUtc`, `modifiedUtc`, …). Use `createdUtc` ASC, which equals `No` order by the front-end's F4. |
| 6 | Create an order | **Yes.** `POST /api/content`. The body key must be `ContentType` (PascalCase). With `contentType` it returns an empty `400`. Success is `200`, not `201`. |
| 7 | Set `delivered` | **Yes, but not as a patch.** There is no `PATCH`. `POST /api/content` with the **full item** (same `ContentItemId`) replaces it. Verified: flag flipped and a later GraphQL read showed it. |
| 8 | Browser access | **Not usable as is.** An `OPTIONS` preflight from another origin returns `401`. CORS must be enabled (see [B13](#requirements-ears)). |
| 9 | Error format | **Not Problem Details.** `400` and `401` come back with an empty body. `401` carries a `WWW-Authenticate: Bearer error=…` header only. |

### Findings that shape the design

1. **GraphQL flattens a same-named part.** The part `Order` on type `Order` has its fields on the type itself, so the query is `{ order { no customerName qty … } }`, not `{ order { order { … } } }`. Fields come back as scalars (`no: 3`, `serviceDate: "2026-11-21"`), but the write API takes the nested form (`"No": {"Value": 3}`). Read and write shapes differ, so the adapter owns two mappers.
2. **Date fields cannot be filtered reliably, so `ServiceDate` is text.** On SQLite, `serviceDate: "2026-11-21"` and `serviceDate_gte` returned `[]` although rows exist; only an exclusive range worked. This is a **dev-prod parity** risk (Principle 1.4), so we use **PostgreSQL** everywhere. Amended after the T1 build: on PostgreSQL 17 with Orchard Core 3.0.1 (the latest release), **every** GraphQL `where` filter on a `DateField` or `DateTimeField` fails (equality, `_gt`, `_lt`, `_gte`, with or without typed variables). GraphQL returns code `POSTGRES`, and the Postgres log says `operator does not exist: timestamp without time zone = text`: the index column is a `timestamp`, but the filter value is sent as text. Selecting the field works. The ContentFields docs page is silent on this, and no matching Orchard issue was found. The only workaround found is custom C# (a bespoke GraphQL filter), which breaks B1. A `TextField` holding `YYYY-MM-DD` supports equality filtering, which is all "orders for one day" needs, and ISO text sorts correctly. A `NumericField` `YYYYMMDD` would add range filters (verified) and is the fallback if ranges are ever needed. The cost of text: no format validation on the field.
3. **The update is read-modify-write.** The adapter fetches the item, flips one field and posts the whole item. A concurrent admin edit to another field can be lost. This is acceptable for one kitchen. If it stops being acceptable, add the thin REST module in [Alternatives](#alternatives-considered).
4. **A browser cannot hold the client secret.** The spike used client credentials, which suits scripts and tests only. The UI needs Authorization Code with PKCE and a public client (see [B11](#requirements-ears) and [Open questions](#open-questions)).

## Non-goals

- Ingesting orders from Zalo, and creating orders from the UI. Orders enter through the OC admin, the content API or the seed recipe.
- Replacing the front-end's `OrdersApi` interface, or changing the UI, queries and their tests.
- A custom REST layer, custom auth or custom crypto (Principle 1.2).
- Multi-tenant OC, OC themes or the public website feature set.
- Production hosting, backups and scaling beyond a single container.
- Using the OC admin as the kitchen's UI. It is the back-office tool only.

## Users and stories

| ID | Story |
|---|---|
| US5 | As the owner, I run one command and get a working backend with the `Order` schema and sample orders, so I can develop against it. |
| US6 | As a chef, the orders app shows the orders for the day I pick, read from the backend instead of `localStorage`. |
| US7 | As a chef, when I tick an order as delivered, it stays ticked after reload and on another device. |
| US8 | As the owner, I can add or fix an order in the OC admin without writing code. |

## Requirements (EARS)

Systems: **backend** (the OC host), **orders app** (front-end remote) and **adapter** (`OrchardOrdersApi`). Syntax as in the front-end spec.

### Backend host and schema (US5, US8)

| ID | Pattern | Requirement |
|---|---|---|
| B1 | Ubiquitous | The backend shall be one ASP.NET Core project, `backend/Bpb.Backend`, that references `OrchardCore.Application.Cms.Targets` and contains no controllers, services or domain code of its own. |
| B2 | Event-driven | When the backend starts with no provisioned tenant, the backend shall create the `Default` tenant from `appsettings` and the `BpbOrders` recipe, with no manual step. |
| B3 | Ubiquitous | The backend shall define the `Order` content type in the recipe with the fields `No` (numeric, integer ≥ 1, required), `CustomerName` (text, required), `Qty` (numeric, integer ≥ 1, required), `Message` (text), `ServiceDate` (**text** holding `YYYY-MM-DD`, required; see finding 2) and `Delivered` (boolean). |
| B4 | Ubiquitous | The backend shall index every `Order` field with SQL field indexing, so that GraphQL can filter on them. |
| B5 | Ubiquitous | The backend shall read its database provider, connection string and all secrets from the environment or configuration, never from source (12-factor). |
| B6 | Ubiquitous | The backend shall use PostgreSQL in local development, CI and production. |
| B7 | Event-driven | When a developer or CI runs `make seed` (`backend/k6/seed.js`), the script shall create sample orders for yesterday, today and tomorrow through the public API (a client-credentials token and `POST /api/content`), skip any day that already has orders, and mark only some of yesterday's orders delivered, matching front-end F22 and F36. Amended: a recipe `content` step is static, but the days are relative to today. |

### Read and write API (US6, US7)

| ID | Pattern | Requirement |
|---|---|---|
| B8 | Event-driven | When the adapter lists a service day, the adapter shall send one GraphQL query that filters `serviceDate` by equality with the `YYYY-MM-DD` day and orders by `createdUtc` ascending, and return orders with `no`, `name`, `qty`, `message`, `createdAt`, `serviceDate` and `delivered` mapped to the `Order` type. |
| B9 | Event-driven | When the adapter sets the delivered flag, the adapter shall read the item by `ContentItemId`, change only `Order.Delivered.Value`, post the whole item to `POST /api/content` and return the updated `Order`. |
| B10 | Unwanted behaviour | If the item does not exist (`404`), then the adapter shall reject with `NotFoundError`; if any other call fails or returns a non-2xx status, then the adapter shall reject with an error that carries the HTTP status, and the front-end rollback (F31) shall apply unchanged. |
| B11 | Ubiquitous | The backend shall authenticate API calls with OAuth 2.0 bearer tokens issued by its own OpenID Connect server. The orders app shall obtain tokens with Authorization Code and PKCE as a public client, and shall hold no client secret. Client credentials remain for scripts and tests only. |
| B12 | Unwanted behaviour | If a call has no valid token, then the backend shall answer `401` and shall return no order data. |
| B13 | Ubiquitous | The backend shall allow cross-origin calls to `/api/graphql`, `/api/content` and `/connect/token` from the configured origins only (shell and dev servers), never `*`. |
| B14 | Ubiquitous | The adapter shall set a request timeout and retry only idempotent reads with backoff. It shall not retry the `POST` update automatically. |

### Operations (cross-cutting, Principle 3)

| ID | Pattern | Requirement |
|---|---|---|
| B15 | Ubiquitous | The backend shall emit structured JSON logs that include `trace_id` and `span_id`, and export traces and metrics over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. |
| B16 | Ubiquitous | The backend shall run as one container built from a Dockerfile in `backend/`, with a health check, started together with PostgreSQL by `docker compose up`. |
| B17 | Ubiquitous | The adapter shall send the W3C `traceparent` header on every call when the shell provides one. |

## Architecture

### Layout and bounded context

One bounded context: **orders**. The backend is the orders context's persistence and API. It never reaches into another context.

```
backend/                          # not in the pnpm workspace (apps/*, packages/*)
  Bpb.Backend/
    Bpb.Backend.csproj            # SDK Web, net10.0, OrchardCore.Application.Cms.Targets
    Program.cs                    # AddOrchardCms + AutoSetup + OpenTelemetry (see below)
    Manifest.cs                   # [assembly: Module(...)] so ./Recipes is discovered
    appsettings.json              # AutoSetup tenant; connection values come from env
    Recipes/BpbOrders.recipe.json # features, Order schema, OpenID server + clients, CORS, sample data
  Dockerfile
  docker-compose.yml              # backend + postgres
apps/orders/src/api/
  orders-api.ts                   # unchanged seam
  orchard-orders-api.ts           # NEW: GraphQL read, content-API write, mappers
  orchard-orders-api.test.ts      # NEW
  http.ts                         # NEW: fetch with token, timeout, traceparent, error mapping
apps/orders/src/auth/             # NEW: Authorization Code + PKCE (use a standard OIDC client library)
```

Dependencies flow one way, as before: `ui → queries → OrdersApi ← OrchardOrdersApi → http/auth`. The choice of implementation (`LocalStorageOrdersApi` or `OrchardOrdersApi`) is made once in `app.tsx`, from config.

### `Program.cs` (the whole of our server code)

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOrchardCms(oc => oc.AddSetupFeatures("OrchardCore.AutoSetup"));
var app = builder.Build();
app.UseStaticFiles();
app.UseOrchardCore();
app.Run();
```

`Manifest.cs` holds one line: `[assembly: OrchardCore.Modules.Manifest.Module(Name = "Bpb.Backend", Author = "bpb", Version = "1.0.0", Category = "Application")]`. Without it OC does not scan the host's `Recipes/` folder. OpenTelemetry wiring (B15) adds a few lines to `Program.cs`.

### Recipe `BpbOrders.recipe.json` (shape verified in the spike)

- `feature` step enabling: `Contents`, `ContentTypes`, `ContentFields`, `ContentFields.Indexing.SQL`, `Apis.GraphQL`, `Users`, `Roles`, `Admin`, `AdminMenu`, `Features`, `Settings`, `OpenId`, `OpenId.Server`, `OpenId.Validation`, plus `Cors` (B13, not yet run).
- `ContentDefinition` step: type `Order`, part `Order` with the six fields of B3, each with `"ContentIndexSettings": { "Included": true }`.
- `OpenIdServerSettings` step: `EnableTokenEndpoint: true`, `TokenEndpointPath: "/connect/token"`, `AllowClientCredentialsFlow: true`. For the UI client (B11), the authorization endpoint and the code flow are added.
- `OpenIdApplication` step: a confidential client for scripts and tests, and a **public** client for the orders app with its redirect URIs.
- `content` step with the sample orders (B7), development only.

The OpenID server step needs the `EnableTokenEndpoint` property. Names such as `TokenEndpointPath` alone leave the endpoint off, and OC logs "client credentials flow cannot be enabled when the token endpoint is disabled".

### Data mapping (adapter)

| `Order` (front-end) | GraphQL read (flattened scalar) | Content API write |
|---|---|---|
| `id` | `contentItemId` | `ContentItemId` |
| `no` | `no` | `Order.No.Value` |
| `name` | `customerName` | `Order.CustomerName.Text` |
| `qty` | `qty` | `Order.Qty.Value` |
| `message` | `message` | `Order.Message.Text` |
| `createdAt` | `createdUtc` (UTC; the adapter keeps it as an ISO 8601 string) | read-only |
| `serviceDate` | `serviceDate` (`YYYY-MM-DD`) | `Order.ServiceDate.Text` (`YYYY-MM-DD`) |
| `delivered` | `delivered` | `Order.Delivered.Value` |

### Request shapes (verified)

List a day (B8), for `2026-11-21`:

```json
{ "query": "{ order(where:{serviceDate:\"2026-11-21\"}, orderBy:{createdUtc:ASC}) { contentItemId no customerName qty message serviceDate delivered createdUtc } }" }
```

Set delivered (B9): `GET /api/content/{id}`, set `Order.Delivered.Value`, then `POST /api/content` with the whole body.

### Alternatives considered

| Option | Cost | Why not (now) |
|---|---|---|
| **A. Adapter on OC's own APIs (chosen)** | 0 lines of backend code. One TS class and mappers. | Read-modify-write on update, and OC-specific JSON shapes live in the adapter. |
| B. Thin OC module with `GET /api/orders` and `PATCH /api/orders/{id}` returning RFC 7807 | About 80–120 lines of C#, with its own tests. | Matches the planned REST contract and removes the race. Pick it if the race or the adapter's mapping cost starts to hurt. |
| C. Keep `localStorage` | None | Data lives in one browser, so US7 (another device) fails. |
| D. OC headless decoupled front-end, GraphQL end to end | Rewrites the data layer | Throws away the `OrdersApi` seam. |

Choosing A over B leaves two standards gaps that the spec accepts knowingly: updates use `POST` rather than `PATCH` with merge-patch, and error responses are not Problem Details. The adapter converts errors to its own typed errors, so the UI never sees either gap. Revisit if a second client appears.

## Testing

Every requirement has at least one automated test. Tests exercise the same interfaces production uses (HTTP, OIDC, GraphQL).

| Area | Covers | Tests |
|---|---|---|
| Adapter unit | B8–B10, B14, B17 | With a fake `fetch`: GraphQL body filters `serviceDate` by equality and orders by `createdUtc`, the response maps to `Order`, update sends the whole item with only `Delivered` changed, `404` becomes `NotFoundError`, `5xx` and network failure reject with status, reads retry with backoff and the update does not, `traceparent` is forwarded. |
| Adapter contract | B8, B9 | Runs the **same test suite** that `LocalStorageOrdersApi` passes (`OrdersApi` behaviour: sorted by `no`, `[]` for an empty day, unknown id rejects, delivered persists), against a real backend container. |
| Backend integration | B2–B7, B11–B13 | In CI, `docker compose up` a clean stack, then: the tenant provisions itself, the `Order` type exists, sample data is present, a token request works, a call without a token gets `401`, a preflight from an allowed origin succeeds and from another origin does not, the day query returns exactly one day on PostgreSQL. |
| Auth | B11 | Authorization Code + PKCE against the container, with no secret in the built bundle (a test greps `dist/`). |
| Telemetry | B15, B16 | The health check passes, and logs contain `trace_id` and `span_id` for a request that carries `traceparent`. |

CI additions: a job that builds the image and runs the backend integration and adapter contract tests. Existing `typecheck`, `test` and `build` jobs are unchanged.

## Acceptance criteria

1. On a clean checkout, `docker compose up` in `backend/` brings up OC and PostgreSQL, and `GET /health/live` succeeds with no manual setup.
2. The OC admin shows an **Order** type with the six fields, and the sample orders for yesterday, today and tomorrow.
3. With the orders app set to the Orchard adapter, opening the app shows today's sample orders in `No` order, and picking another day shows that day's orders (on PostgreSQL, by the equality query).
4. Ticking Delivered survives a reload and shows on a second browser.
5. A request without a token receives `401`. The built front-end contains no client secret.
6. With the adapter swapped back to `LocalStorageOrdersApi`, all existing front-end tests still pass unchanged.
7. Root `pnpm typecheck`, `pnpm test` and `pnpm build` pass, and the backend integration job passes.

## Delivery slices

Each slice is vertically complete inside the orders context (Principle 2).

1. **Backend skeleton:** host, recipe with schema and indexing, PostgreSQL compose, sample data, token with client credentials, integration test (B1–B7, B12, B16).
2. **Read path:** `OrchardOrdersApi.listOrders`, `http.ts`, CORS, contract test (B8, B13, B14).
3. **Write path:** `setDelivered` with read-modify-write, error mapping (B9, B10).
4. **UI auth:** Authorization Code + PKCE and the public client (B11).
5. **Observability:** OpenTelemetry in the backend, `traceparent` in the adapter (B15, B17).

## Implementation status (slices 1–4 and e2e, built 2026-11-20)

Commits: `dca7d4a` backend skeleton, `6d5d8d2` adapter, `6f6f0fd` PKCE sign-in, `7824942` Playwright e2e, `1fb1230` CI backend job and hardening. Slice 5 (observability) is not built.

### Verified by running

- PostgreSQL 17: text `ServiceDate` equality works; `DateField` and `DateTimeField` filters fail (finding 2).
- Auto-provisioning with a PostgreSQL connection string, the `BpbOrders` recipe, the health endpoint (`/health/live`) and the container image.
- CORS: configured origins pass a preflight, others get no `Access-Control-Allow-Origin`, never `*`.
- Authorization Code + PKCE with a public client, refresh tokens, and the role claim. The `Kitchen` role can read and update orders and gets `403` on delete and on admin endpoints.
- The adapter against the real backend (contract test, 4 tests) and the whole flow in a real browser (Playwright, 7 tests, headed and headless): sign-in redirect through the shell with the route restored, today's orders, Delivered persisting across a reload and a second fresh login, date picker, English labels, standalone page, `401` without a token.
- Data-protection keys and tenant settings survive a container recreate (named volumes).

### Known gaps

| # | Gap | Impact | Where it matters |
|---|---|---|---|
| G1 | **Slice 5 not built:** no OpenTelemetry in the backend (B15) and no `traceparent` from the adapter (B17). | No distributed traces or correlated logs yet. Principle 3.1 is unmet for this context. | Before production. |
| G2 | **Concurrent ticks are untested.** A full-item `POST` means the last write wins, and a concurrent edit to another field can be lost. | Low for one kitchen. | Open decision D3. |
| G3 | **The CI `backend` job has not run on a GitHub runner.** It was checked with actionlint and its steps were run locally. Unverified: `--with-deps` apt installs, artifact upload, docker build time on the runner. | The first CI run may need a fix. | First push. |
| G4 | **The kitchen user is created by a script** (`backend/scripts/create-kitchen-user.sh`) that drives Orchard's admin form, because the recipe `users` step cannot set a password and OC 3.0.1 has no user API. | An Orchard upgrade can change the form fields and break it. It is a manual step after first start. | Orchard upgrades. |
| G5 | **PKCE `plain` is accepted** by the server, although the app only sends S256 and the recipe requires PKCE. Forbidding it needs custom C# (an OpenIddict option), which breaks B1. | Only a hostile client can downgrade, but OAuth 2.1 guidance says to disallow `plain`. | Decision D2. |
| G6 | **High-severity NuGet audit warnings** on transitive packages of OC 3.0.1: `SixLabors.ImageSharp` (several high), `System.Security.Cryptography.Pkcs` (high), `HtmlSanitizer` (high, beta), plus moderate `AngleSharp` and `MySqlConnector`. Media features, HTML fields, uploads and MySQL are not used here. | Low exposure today. | Each Orchard upgrade. Pin patched versions or upgrade OC when a release raises them. |
| G7 | **Script client has the Administrator role** (`bpb-orders-script`, client credentials). | Acceptable for dev and CI. A leaked secret would give full admin. | Disable it or narrow its role in production. |
| G8 | **Creation is allowed to the kitchen.** `Edit_Order` plus `Publish_Order` also permit `POST /api/content` without an id, because OC cannot separate create from update. | A kitchen token can create an order. Deletes are denied. | Decision D4. |
| G9 | **Field rules apply only in the admin UI.** `No` and `Qty` as integers ≥ 1 and the `YYYY-MM-DD` format of `ServiceDate` are not enforced by the content API. | A bad value can be written by an API client. | Add validation if a second writer (Zalo ingestion) arrives. |
| G10 | **Config is read once, at tenant creation:** `UI_REDIRECT_URIS` and `CORS_ALLOWED_ORIGINS`. CORS is capped at 4 origins, because one recipe expression cannot produce an array. | Changing an origin later needs a fresh database or an admin edit. | Hosting setup (D5). |
| G11 | **Token expiry and refresh were not exercised in a browser**, and neither were several `<orders-app>` instances on one page. Unit tests cover both with fakes. | Unseen edge cases in a long-lived session. | Manual check or a longer e2e. |
| G12 | **A GraphQL `errors` reply (which arrives with HTTP 200) is mapped to `HttpError(200)`** in the adapter. | The status is misleading in logs. Use a distinct error type or status. | Nit. |
| G13 | **Sample data is a script, not a recipe step**, and a crashed e2e run can leave order 2 delivered. `make stack-up` seeds only empty days. | A rerun after a crash may fail until the stack is recreated. | Test hygiene. |

### Open decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **B14 wording.** The code replays the update once after a `401` with a renewed token (a `401` means nothing was processed). The spec says the update is never retried. | Amend B14 to allow one replay after a `401`, or restrict the replay to reads. | Amend B14. The replay is safe and bounded to once per 60 seconds. |
| D2 | **PKCE `plain`** (G5). | Accept and record, or add a few lines of C# to drop `plain`. | Accept for now, revisit at the next Orchard upgrade. |
| D3 | **Is last-write-wins acceptable** for the update (G2)? | Keep option A, or build option B (thin REST module with `PATCH`). | Keep A until a second writer exists. |
| D4 | **May the kitchen create orders** (G8)? | Accept, or add a custom permission check (custom code). | Accept; creation by the kitchen is harmless here. |
| D5 | **Hosting target** for the container and PostgreSQL, and how production sets origins, secrets and key storage (G10). The existing CI stages static files only. | Not chosen. | Decide before any deployment. |
| D6 | **Per-chef accounts.** The user chose one shared kitchen account for now. OC already stores the `Author` on each change. | Add accounts later at no code cost. | Revisit when an audit trail is needed. |
| D7 | **Service-day time zone.** `ServiceDate` is a day string with no zone, so the front-end's local-day rule (F1) works. The tenant's `SiteTimeZone` is `Asia/Ho_Chi_Minh`. | Confirm the kitchen is always in that zone. | Confirm. |
| D8 | **Zalo ingestion.** Call the content API with a client-credentials token (no new code), or add a small ingestion service. With a second writer, G9 needs validation. | Not chosen. | Decide when ingestion is specced. |
| D9 | **Orchard version policy.** Pin 3.0.1, decide how upgrades are tested (recipe step names changed between majors), and how G4 and G6 are rechecked. | Not chosen. | Pin now; review per release. |

### Differences between this spec's text and the code

These were accepted during the build and are not yet reflected in the requirement wording.

- **B13:** origins come from `CORS_ALLOWED_ORIGINS` (up to 4, never `*`), applied at tenant creation.
- **B14:** one replay of the update after a `401` (D1).
- **B16:** the compose stack adds named volumes `appdata` and `dpkeys-host` so the container survives recreation.
- **B6:** CI uses docker compose with PostgreSQL and the dev placeholder secrets from `backend/.env.example`; the stack is ephemeral.
