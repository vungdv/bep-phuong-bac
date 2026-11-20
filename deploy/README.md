# Publish the app through a Cloudflare quick tunnel

```sh
brew install cloudflared   # once
make public                # Ctrl+C stops the tunnel and the gateway
```

It prints `https://<random>.trycloudflare.com`; open `<url>/#/order` and sign in as the kitchen user.

```
Internet -> Cloudflare -> cloudflared -> nginx :8081 -> built shell files (index.html, assets/, remotes/, *.json)
                                                     -> everything else: Orchard Core backend :5080
```

One origin serves both, so the browser needs no CORS and only one public URL.

## What each run does

The URL changes on every run and the backend reads its OIDC redirect URIs only when the tenant is first created, so `make public`:

1. starts the tunnel and reads the URL,
2. writes `UI_REDIRECT_URIS` and `CORS_ALLOWED_ORIGINS` for that URL into `backend/.env`,
3. runs `make stack-down stack-up` (**drops the database**; kitchen user and sample orders are recreated),
4. builds the frontend with `VITE_BACKEND_URL=<url>` and stages the orders remote,
5. starts nginx (`deploy/docker-compose.yml`).

## Notes

- Anyone with the URL can reach the backend, which uses the dev passwords from `backend/.env`. Share the URL carefully.
- Quick tunnels have no uptime guarantee and no SSE support; fine for demos.
- The script sets `FORWARDED_HEADERS_ENABLED=true` in `backend/.env` (maps to `ASPNETCORE_FORWARDEDHEADERS_ENABLED`) so the backend honours nginx's `X-Forwarded-Proto` and advertises an `https://` issuer. Without it the browser blocks `/connect/token` as mixed content. It trusts any caller's forwarded headers, so only enable it behind the gateway.
