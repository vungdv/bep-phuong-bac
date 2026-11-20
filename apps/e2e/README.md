# @bpb/e2e

Playwright end-to-end tests of the real stack: shell (5173) and orders dev server (5174) in Chromium, signing in through the Orchard Core login form against the backend (5080).

```sh
make stack-up                                      # backend + PostgreSQL, kitchen user, seed (about 1 min cold, idempotent)
pnpm --filter @bpb/e2e exec playwright install chromium   # once
pnpm --filter @bpb/e2e e2e:headed                  # watch it: real window, slowMo 300 ms (E2E_SLOWMO)
pnpm --filter @bpb/e2e e2e                         # headless (CI mode)
make stack-down                                    # stop and drop the database
```

`preorder-pipeline.spec.ts` posts a message to the content API and needs the LLM to be the stub: run `make stub-up` instead of `make stack-up` (`make test-backend` ends by restoring the default endpoint, so run `make stub-up` right before the e2e; it also reads `E2E_SCRIPT_CLIENT_SECRET`, default `dev-script-secret`).

Playwright starts (or reuses) the two Vite dev servers with `VITE_BACKEND_URL`; it does not start the backend, and `globalSetup` fails fast if `/health/live` is not healthy. Contexts use `Asia/Ho_Chi_Minh` and `vi-VN` so the app's "today" matches the seed.

Env (dev defaults from `backend/.env.example`): `E2E_KITCHEN_USERNAME`, `E2E_KITCHEN_PASSWORD`, `E2E_BACKEND_URL`, `E2E_SHELL_URL`. Failure artifacts (trace, video, screenshot) go to `apps/e2e/test-results` (gitignored).

Changing the shell or orders URLs (ports or hosts) requires setting `UI_REDIRECT_URIS` (OIDC redirect URIs) and `CORS_ALLOWED_ORIGINS` in `backend/.env` before the stack's first start: both are read once, when the tenant is created. To apply a change to an existing stack run `make stack-down` (drops the database) and start again.
