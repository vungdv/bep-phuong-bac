#!/usr/bin/env bash
# Publishes the app on a temporary https://*.trycloudflare.com URL (Cloudflare quick tunnel, no account).
# The URL is random per run, and the backend only reads its redirect URIs when the tenant is created, so each run
# resets the backend stack (drops the database; kitchen user and sample orders are recreated) and rebuilds the frontend.
# Run from the repo root: make public
set -euo pipefail
cd "$(dirname "$0")/.."

log=$(mktemp)
tunnel_pid=
cleanup() {
  [ -n "$tunnel_pid" ] && kill "$tunnel_pid" 2>/dev/null || true
  (cd deploy && docker compose down) || true
  rm -f "$log"
}
trap cleanup EXIT INT TERM

command -v cloudflared >/dev/null || { echo "install cloudflared first: brew install cloudflared" >&2; exit 1; }

cloudflared tunnel --no-autoupdate --url http://localhost:8081 >"$log" 2>&1 &
tunnel_pid=$!

url=
for _ in $(seq 1 30); do
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)
  [ -n "$url" ] && break
  sleep 1
done
[ -n "$url" ] || { echo "tunnel did not start:" >&2; cat "$log" >&2; exit 1; }
echo "public url: $url"

[ -f backend/.env ] || cp backend/.env.example backend/.env
sed -i.bak -E '/^#? ?(UI_REDIRECT_URIS|CORS_ALLOWED_ORIGINS)=/d' backend/.env && rm -f backend/.env.bak
{
  echo "UI_REDIRECT_URIS=$url/"
  echo "CORS_ALLOWED_ORIGINS=$url"
} >>backend/.env

make stack-down
make stack-up

VITE_MANIFEST_URL=/host.config.prod.json VITE_BACKEND_URL="$url" pnpm build
mkdir -p apps/shell/dist/remotes/orders
cp apps/orders/dist/orders-app.js apps/shell/dist/remotes/orders/

(cd deploy && docker compose up -d)

echo
echo "ready: $url/#/order   (user kitchen, password from backend/.env). Ctrl+C to stop."
wait "$tunnel_pid"
