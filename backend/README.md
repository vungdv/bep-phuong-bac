# Backend (Orchard Core)

One ASP.NET Core host, `Bpb.Backend`, that references `OrchardCore.Application.Cms.Targets` and owns no C# beyond 6 lines in `Program.cs`. The `Order` schema, OpenID server, CORS and health check come from `Bpb.Backend/Recipes/BpbOrders.recipe.json`. Spec: `specs/2026-11-20-backend-order.spec.md`.

## Run

```sh
# from the repo root; needs docker, make and k6 (brew install k6)
make stack-up       # creates backend/.env from .env.example (dev-only, gitignored), starts PostgreSQL + backend on
                    # http://localhost:5080, creates the kitchen user and seeds sample orders; idempotent
make test-backend   # k6 integration tests (backend/k6/integration.js) against the running stack
make seed           # sample orders for yesterday/today/tomorrow only (dev only, idempotent)
make kitchen-user   # the shared kitchen account (role Kitchen) only; idempotent
make stack-down     # stop and drop the database
```

First start auto-provisions the `Default` tenant (OrchardCore.AutoSetup) and runs the `BpbOrders` recipe. Admin UI: `http://localhost:5080/admin` (user `admin`, password `ADMIN_PASSWORD`).

## Configuration (environment, never source)

| Variable | Meaning |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password (compose uses it for both containers) |
| `ADMIN_PASSWORD` | OC admin password (`...AutoSetup__Tenants__0__AdminPassword`) |
| `KITCHEN_USERNAME`, `KITCHEN_PASSWORD` | the shared kitchen account used by the orders app; read only by `scripts/create-kitchen-user.sh` and the k6 tests, never by the backend container |
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
- **Pre-order schema** (spec `2026-11-20-process-preorder`): the recipe also defines the sample source type `ChannelMessage` (`Channel`, `SenderName`, `Text`, `SentAt`), the additive text field `Order.SourceContentItemId`, and enables Workflows, Queries (SQL) and the admin theme (`TheAdmin`, `OrchardCore.Navigation`) so `/Admin/Workflows` works without clicks. The system roles `Anonymous` and `Authenticated` have no generic `ViewContent` (Orchard's default grants it, which made every published item, `ChannelMessage` included, readable through the content API by anyone with `ApiViewContent`); `Kitchen` has no permission on `ChannelMessage` or workflows.
- **Why a script creates the user**: Orchard Core 3.0.1 has no user REST API, and the recipe `users` step cannot set a password (it only imports a stored hash, which would have to live in source). `scripts/create-kitchen-user.sh` signs in to the admin as `admin` and submits the standard admin "create user" form. It is idempotent (an account that can already sign in is left alone).
- `k6/lib/oidc.js` runs a real Authorization Code + PKCE round trip (login form included, no browser); `k6/integration.js` uses it.

## LLM Extract activity (module `Bpb.Workflows.Llm`)

A generic workflow task, **LLM Extract**, for any workflow (content-triggered or not). The author sets, in the activity editor:
a **System prompt** and a **User prompt** (Liquid, e.g. `{{ Workflow.Input.ContentItem.Content.ChannelMessage.Text.Text }}` or `{{ Workflow.Properties.Text }}`),
the **Tools** (JSON array of `{ "name", "description", "parameters": <JSON Schema of the arguments> }`), an optional **Model** and a **Result key**
(default `Llm`). One request is sent (`POST {endpoint}/v1/chat/completions`, `tool_choice: required`, temperature 0, the User prompt as the only user
message); the tool is never run and nothing is retried.

- **Outcomes**: one per tool name, `Invalid` (no tool call, unknown tool, arguments fail that tool's JSON Schema) and `Failed` (endpoint unset, timeout, HTTP error, empty or unparseable reply, bad tool settings, empty User prompt).
- **Workflow properties** (prefix = Result key): `LlmTool` (tool called, else empty), `LlmArgsJson` (validated arguments as a JSON **string**; read with `JSON.parse(property('LlmArgsJson'))` in a ScriptTask), `LlmError` (short reason for `Invalid`/`Failed`, else empty). Schema checks use JsonSchema.Net; business rules are the workflow's job (ScriptTask).
- **Configuration** (`Bpb:Llm:*`, environment `OrchardCore__Bpb__Llm__*`, set from `.env` by compose): `LLM_ENDPOINT` (default `http://ollama:11434`), `LLM_MODEL` (default `qwen2.5:7b-instruct`), `LLM_TIMEOUT_SECONDS` (default 120), `LLM_API_KEY` (optional, never logged). Prompts, message text and arguments are never logged; failures log only a short reason.
- **Local model**: `make llm-up` starts the `ollama` service (compose profile `llm`, own volume, no host port, so a host Ollama on `localhost:11434` is not touched) and pulls the model once; `make llm-pull` re-pulls. `make stack-up` does not start it (multi-GB download); without it the activity ends `Failed` (`connection failed`). To use the host's Ollama set `LLM_ENDPOINT=http://host.docker.internal:11434` in `.env`.
- **Tests**: `dotnet test Bpb.Workflows.Llm.Tests` (unit, fake client and handler). `make test-backend` first runs `make stub-up`, which points the backend at `llm-stub` (compose profile `test`, `127.0.0.1:5099`), then `k6/llm-extract.js` runs a tiny workflow through the activity using the test-only recipe `k6/recipes/LlmExtractProbe.recipe.json` (imported through the admin JSON import, which needs the `OrchardCore.Deployment` feature: the test enables it and disables it again, and removes everything it created in teardown). `make test-backend` ends by recreating the backend with the default endpoint, so the stack is back on Ollama afterwards, pass or fail.
- **`llm-stub`** (`llm-stub/server.cjs`): the reply is chosen from the user message. Markers: `[stub:500]`, `[stub:delay=SECONDS]`, `[stub:garbage]`, `[stub:empty]`, `[stub:notool]`, `[stub:tool=NAME args={...}]`, `[stub:argstring=TEXT]`; otherwise a keyword row of `llm-stub/replies.json` (add canned replies there; arguments may use `{{today}}`, `{{tomorrow}}`, `{{yesterday}}`), else the fallback `ignore_message`. `GET /requests/last` returns the last request body.

## Pre-order extraction (workflow `ExtractOrder`, spec `2026-11-20-process-preorder`)

The recipe creates the workflow at first start (no clicks). Creating and publishing a `ChannelMessage` (admin or `POST /api/content`) starts it, inline in that request:

`ContentPublished(ChannelMessage)` -> **LLM Extract** (tools `record_order`, `ignore_message`) -> script check (P12) -> dedupe query (P17) -> `No` query -> **Create Content** `Order` -> `ExtractStatus = Extracted`.

The System prompt states today's date (`{{ "now" | local | date: "%Y-%m-%d" }}`, tenant time zone `Asia/Ho_Chi_Minh`) and asks for exactly one tool call; the User prompt is only `{{ Workflow.Input.ContentItem.Content.ChannelMessage.Text.Text }}`. Another content type works the same way: change the start event's type filter and the User prompt expression (the activity is generic; `k6/llm-extract.js` shows it behind a different type).

| `ExtractStatus` | When | `ExtractReason` |
|---|---|---|
| `Extracted` | the model called `record_order` and the order passed every check; an `Order` was created | empty; `duplicate` when an order for this message already existed (none created, `OrderId` is the existing one) |
| `NotAnOrder` | the model called `ignore_message` | empty |
| `Rejected` | the model's output broke a rule; nothing created | `invalid qty` (not an integer 1..999), `invalid customerName` (empty or over 200 characters), `no date` (D5), `invalid date` (not `YYYY-MM-DD` or not a real day), `past date` (before today in Asia/Ho_Chi_Minh), `multiple` (the model flagged several orders, D2), or `invalid output: ...` (the activity's `Invalid`: no tool call, unknown tool, arguments fail the tool schema) |
| `Failed` | the LLM step failed: timeout (`Bpb:Llm:TimeoutSeconds`), HTTP error, empty or unparseable reply, endpoint down, or a script error; nothing created, no retry, no loop | the activity's short reason (for example `timeout after 120s`, `HTTP 500`, `connection failed: HttpRequestException`) |

Validation happens before anything is created (a `CreateContentTask` failure would roll back the whole request). The outcome lives on the workflow instance only; the message is never modified (P19). The properties `LlmTool`, `LlmArgsJson`, `LlmError`, `OrderId`, `ExtractStatus`, `ExtractReason` are all on the instance.

**Read an outcome (admin)**: sign in as `admin`, `/Admin/Workflows/Types`, open `ExtractOrder`'s *Instances* (newest first), open an instance: the **State** tab shows `correlationId` (= the message's content item id), the status (`Finished`) and `Properties` with `ExtractStatus` and `ExtractReason`. The Orders list shows the order; `Order.SourceContentItemId` links back to the message. There is no REST/GraphQL API for workflow instances in Orchard Core, so `k6/pipeline.js` reads these same admin pages.

**Re-run a `Failed` message (P18, admin only)**: fix the cause (for example start the LLM), then re-publish the message: in the admin Contents list open the message, *Unpublish* then *Publish* (or edit and publish); through the API `POST /api/content` with the same `ContentItemId` and `"Published": true`. A new instance starts from the top (the new run logs the same `SourceContentItemId`, so `grep` shows every attempt). It creates exactly one order: before creating, the workflow looks for an `Order` with that `SourceContentItemId` (SQL query `OrderBySource`), so re-publishing an already extracted message creates nothing and ends `Extracted` / `duplicate`. The instance list's *Restart* button was not exercised; re-publishing is the documented procedure.

**Operate: logs and tracing (P23, Acceptance 4)**: the backend writes one JSON object per line to the container's console (`docker compose logs backend`; `Microsoft.Extensions.Logging` JSON console with scopes). Every request log carries the active W3C trace in its scopes as `TraceId` and `SpanId` (the spec's `trace_id` / `span_id`; the standard logging names are kept rather than renamed). Follow one message end to end with its content item id (the id returned by `POST /api/content`, shown as `correlationId` on the workflow instance and as `Order.SourceContentItemId`):

- the LLM step logs `LLM extract called tool ...` (or the short failure / invalid reason) with `SourceContentItemId` as a structured scope field (`Scopes[].SourceContentItemId`);
- an order creation logs `Order <id> created from SourceContentItemId=<id>` (the recipe's `LogTask` in `ExtractOrder`; there the id is part of the message text, because the stock `LogTask` has no structured fields).

`docker compose logs backend --no-log-prefix | grep <message id>` shows both, and `TraceId` in their scopes is the same for the two lines of one run. Only the `Bpb.Workflows.Llm` and `LogTask` categories log at Information (`appsettings.json`); everything else stays at Warning. Message text, prompts, tool arguments and the `LLM_API_KEY` are never logged (the unit tests assert it for the activity). Check after a run: `docker compose logs backend | grep -c '<a phrase you sent>'` must print 0.

**How `No` is assigned (D3)**: inside the workflow, per service day: the SQL query `NextOrderNo` returns the highest `No` of that day's published orders, a script adds 1 (the query parser rejects `max(x)+1`), first order of a day gets 1. **Known limitation (accepted for the pilot)**: the workflow runs inside the request and is not serialised, and the LLM call sits between reading the maximum and creating the order, so two messages processed at about the same time for the same day can get the same `No` (measured in the spike: 7 of 8 concurrent runs got 1). An admin can correct a duplicate `No` by editing the order. Do not "fix" it with the singleton flag (`IsSingleton`): the lock is held during the LLM call and a message that waits more than 20 seconds is silently skipped. A race-free counter needs a small C# service, a separate change.

**Request time**: the HTTP call that publishes the message returns only after the LLM answered (up to `Bpb:Llm:TimeoutSeconds`, default 120); callers need a client timeout above that.

**Tests**: `make test-backend` runs `k6/pipeline.js` after the others, with the stub as LLM and `Bpb:Llm:TimeoutSeconds` shortened to 5 for the run only (`STUB_LLM_TIMEOUT_SECONDS`; production default stays 120). It covers: order created, not an order, qty 0 / over 999 / not an integer, past date, bad date, blank or long name, no date, multiple orders, LLM 500 / timeout / garbage / empty, tool-schema violations, prompt-injection text (the request log shows the only user content is the message text), quotes and markup in names and text, `No` numbering, replay of a `Failed` message creating one order, and the type filter. Canned replies for readable cases are in `llm-stub/replies.json`; the markers cover the rest.

**Browser e2e**: `apps/e2e/tests/preorder-pipeline.spec.ts` creates a message through `POST /api/content` and expects the order in the orders app for its service day (tomorrow; it deletes both afterwards). It needs the stub as LLM; `make test-backend` ends by restoring the default endpoint, so run `make stub-up` right before the e2e: `make stub-up`, then `pnpm --filter @bpb/e2e e2e`; `make stack-up` restores Ollama.

**Live model check** (not part of `make test-backend`): with Ollama on the host, `LLM_ENDPOINT=http://host.docker.internal:11434 docker compose up -d --wait backend` (from `backend/`), then publish a message (for example with `curl` and a script-client token) and read the instance as above; `make stack-up` restores the default endpoint. Small local models make mistakes (spike: invented names or dates, a dropped second order, obeyed injections); the rules above exist to catch what can be checked, the rest is for the owner to review in the Orders list.

## Local dev without Docker

Run PostgreSQL yourself, export the variables above (plus `ASPNETCORE_URLS`), then `dotnet run --project Bpb.Backend --no-launch-profile`.
