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

### Orchard backend mode

Instead of the mock, the orders app can talk to the Orchard Core backend (`backend/`, PostgreSQL, OpenID Connect with Authorization Code + PKCE). Set `VITE_ORDERS_API=orchard` and `VITE_BACKEND_URL` (default `http://localhost:5080`) when starting the orders dev server. Details, environment variables and CORS/redirect settings are in [backend/README.md](backend/README.md).

Known gaps and open decisions (observability not built, PKCE `plain`, hosting, per-chef accounts and others) are listed in [specs/2026-11-20-backend-order.spec.md](specs/2026-11-20-backend-order.spec.md#implementation-status-slices-14-and-e2e-built-2026-11-20).

```sh
apps/e2e/scripts/stack-up.sh        # backend + PostgreSQL, kitchen user, seed data
VITE_ORDERS_API=orchard pnpm --filter @bpb/orders dev
pnpm --filter @bpb/shell dev
pnpm --filter @bpb/e2e e2e:headed   # Playwright against the real stack, in a visible browser (see apps/e2e/README.md)
```

Deploy: `pnpm build`, then copy `apps/orders/dist/orders-app.js` to `apps/shell/dist/remotes/orders/` (CI does this). `host.config.prod.json` loads `./remotes/orders/orders-app.js`.
