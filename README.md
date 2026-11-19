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

Deploy: `pnpm build`, then copy `apps/orders/dist/orders-app.js` to `apps/shell/dist/remotes/orders/` (CI does this). `host.config.prod.json` loads `./remotes/orders/orders-app.js`.
