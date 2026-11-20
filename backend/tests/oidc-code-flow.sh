#!/usr/bin/env bash
# Scripted Authorization Code + PKCE round trip as the public client bpb-orders-ui (no browser).
# Signs in through the Orchard Core login form as the kitchen user, then prints the token endpoint's JSON
# response on stdout. Progress goes to stderr. Exit 1 on any failure.
# Env: BASE_URL (default http://localhost:5080), KITCHEN_USERNAME, KITCHEN_PASSWORD (required),
#      REDIRECT_URI (default http://localhost:5174/), SCOPE (default "openid offline_access").
set -euo pipefail
BASE_URL=${BASE_URL:-http://localhost:5080}
: "${KITCHEN_USERNAME:?set KITCHEN_USERNAME}" "${KITCHEN_PASSWORD:?set KITCHEN_PASSWORD}"
RU=${REDIRECT_URI:-http://localhost:5174/}
SCOPE=${SCOPE:-openid offline_access}
JAR=$(mktemp); PAGE=$(mktemp); trap 'rm -f "$JAR" "$PAGE"' EXIT

VERIFIER=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
enc() { python3 -c 'import sys,urllib.parse as u;print(u.quote(sys.argv[1],safe=""))' "$1"; }
URL="$BASE_URL/connect/authorize?client_id=bpb-orders-ui&response_type=code&redirect_uri=$(enc "$RU")&scope=$(enc "$SCOPE")&state=s1&code_challenge=$CHALLENGE&code_challenge_method=S256"

loc=""
for _ in 1 2 3 4 5 6 7 8; do
  res=$(curl -sS -c "$JAR" -b "$JAR" -o "$PAGE" -w '%{http_code} %{redirect_url}' "$URL")
  status=${res%% *}; loc=${res#* }
  case "$loc" in "$RU"*) break;; esac
  if [ "$status" = 200 ] && grep -q 'LoginForm.UserName' "$PAGE"; then
    tok=$(grep -o 'name="__RequestVerificationToken"[^>]*value="[^"]*"' "$PAGE" | head -1 | sed 's/.*value="//;s/"$//')
    action=$(grep -o '<form[^>]*action="[^"]*"' "$PAGE" | head -1 | sed 's/.*action="//;s/"$//;s/&amp;/\&/g')
    echo "login form at $action" >&2
    res=$(curl -sS -c "$JAR" -b "$JAR" -o "$PAGE" -w '%{http_code} %{redirect_url}' "$BASE_URL$action" \
      --data-urlencode "__RequestVerificationToken=$tok" --data-urlencode "LoginForm.UserName=$KITCHEN_USERNAME" \
      --data-urlencode "LoginForm.Password=$KITCHEN_PASSWORD")
    loc=${res#* }
    [ -n "$loc" ] || { echo "login rejected (HTTP ${res%% *})" >&2; exit 1; }
  fi
  [ -n "$loc" ] || { echo "no redirect at $URL (HTTP $status)" >&2; exit 1; }
  URL=$loc
done
case "$loc" in "$RU"*) ;; *) echo "never reached the redirect URI (last: $loc)" >&2; exit 1;; esac
code=$(printf %s "$loc" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
[ -n "$code" ] || { echo "no code in $loc" >&2; exit 1; }
echo "authorization code received" >&2
curl -fsS "$BASE_URL/connect/token" -d grant_type=authorization_code -d client_id=bpb-orders-ui \
  --data-urlencode "code=$code" --data-urlencode "redirect_uri=$RU" --data-urlencode "code_verifier=$VERIFIER"
