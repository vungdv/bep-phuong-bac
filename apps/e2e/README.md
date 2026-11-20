# @bpb/e2e

Playwright end-to-end tests of the real stack: shell (5173) and orders dev server (5174) in Chromium, signing in through the Orchard Core login form against the backend (5080).

```sh
apps/e2e/scripts/stack-up.sh                       # backend + PostgreSQL, kitchen user, seed (about 1 min cold, idempotent)
pnpm --filter @bpb/e2e exec playwright install chromium   # once
pnpm --filter @bpb/e2e e2e:headed                  # watch it: real window, slowMo 300 ms (E2E_SLOWMO)
pnpm --filter @bpb/e2e e2e                         # headless (CI mode)
apps/e2e/scripts/stack-down.sh                     # stop and drop the database
```

Playwright starts (or reuses) the two Vite dev servers with `VITE_ORDERS_API=orchard`; it does not start the backend, and `globalSetup` fails fast if `/health/live` is not healthy. Contexts use `Asia/Ho_Chi_Minh` and `vi-VN` so the app's "today" matches the seed.

Env (dev defaults from `backend/.env.example`): `E2E_KITCHEN_USERNAME`, `E2E_KITCHEN_PASSWORD`, `E2E_BACKEND_URL`, `E2E_SHELL_URL`. Failure artifacts (trace, video, screenshot) go to `apps/e2e/test-results` (gitignored).

Changing the shell or orders URLs (ports or hosts) requires setting `UI_REDIRECT_URIS` (OIDC redirect URIs) and `CORS_ALLOWED_ORIGINS` in `backend/.env` before the stack's first start: both are read once, when the tenant is created. To apply a change to an existing stack run `apps/e2e/scripts/stack-down.sh` (drops the database) and start again.
