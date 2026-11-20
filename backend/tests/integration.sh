#!/usr/bin/env bash
# Backend integration test: bash + curl against a running stack (docker compose up).
# Env (from backend/.env if present): BASE_URL (default http://localhost:5080), SCRIPT_CLIENT_SECRET, ADMIN_PASSWORD,
#      KITCHEN_USERNAME, KITCHEN_PASSWORD.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/../.env" ] && { set -a; . "$HERE/../.env"; set +a; }
BASE_URL=${BASE_URL:-http://localhost:5080}
: "${SCRIPT_CLIENT_SECRET:?set SCRIPT_CLIENT_SECRET}" "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}" "${KITCHEN_USERNAME:?set KITCHEN_USERNAME}" "${KITCHEN_PASSWORD:?set KITCHEN_PASSWORD}"
export BASE_URL SCRIPT_CLIENT_SECRET ADMIN_PASSWORD KITCHEN_USERNAME KITCHEN_PASSWORD TZ=${SEED_TZ:-Asia/Ho_Chi_Minh}
FAIL=0
ok()   { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAIL=1; }
check() { # check <name> <command...>
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else fail "$name"; fi
}
jq_py() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

# health (B16)
check "health: GET /health/live is 200" curl -fsS "$BASE_URL/health/live"

# tenant provisioned (B2): root is not redirected to the setup screen
final=$(curl -s -o /dev/null -L -w '%{url_effective}' "$BASE_URL/")
case "$final" in *[Ss]etup*) fail "tenant provisioned (root redirected to $final)";; *) ok "tenant provisioned (no setup redirect)";; esac

# token via client credentials (B11, scripts)
TOKEN=$(curl -fsS "$BASE_URL/connect/token" -d grant_type=client_credentials -d client_id=bpb-orders-script \
  --data-urlencode "client_secret=$SCRIPT_CLIENT_SECRET" | jq_py 'print(d["access_token"])' 2>/dev/null) || TOKEN=""
if [ -n "$TOKEN" ]; then ok "token: client credentials works"; else fail "token: client credentials works"; echo "cannot continue"; exit 1; fi
gql() { curl -sS "$BASE_URL/api/graphql" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1"; }

# Order type present (B3/B4)
fields=$(gql '{"query":"{ __type(name:\"OrderWhereInput\"){ inputFields{name} } }"}' | jq_py 'print(" ".join(f["name"] for f in d["data"]["__type"]["inputFields"]))')
for f in no customerName qty message serviceDate delivered; do
  case " $fields " in *" $f "*) ok "schema: Order filterable on $f";; *) fail "schema: Order filterable on $f";; esac
done

# 401 without a token and no order data (B12)
out=$(mktemp); code=$(curl -s -o "$out" -w '%{http_code}' "$BASE_URL/api/graphql" -H 'Content-Type: application/json' -d '{"query":"{ order { no customerName } }"}')
if [ "$code" = 401 ] && ! grep -q -E 'customerName|"data"' "$out"; then ok "no token: 401 and no data"; else fail "no token: 401 and no data (got $code)"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/graphql" -H 'Authorization: Bearer garbage' -H 'Content-Type: application/json' -d '{"query":"{ order { no } }"}')
[ "$code" = 401 ] && ok "bad token: 401" || fail "bad token: 401 (got $code)"
rm -f "$out"

# CORS preflight (B13)
preflight() { # preflight <origin> <path> -> prints "status|allow-origin"
  curl -s -D - -o /dev/null -X OPTIONS "$BASE_URL$2" -H "Origin: $1" -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: authorization,content-type' |
    awk 'BEGIN{IGNORECASE=1} /^HTTP/{s=$2} tolower($1)=="access-control-allow-origin:"{o=$2} END{gsub(/\r/,"",o); print s "|" o}'
}
for path in /api/graphql /api/content /connect/token; do
  for origin in http://localhost:5173 http://localhost:5174; do
    r=$(preflight "$origin" "$path")
    case "$r" in 2*"|$origin") ok "preflight $origin -> $path allowed ($r)";; *) fail "preflight $origin -> $path allowed ($r)";; esac
  done
  r=$(preflight http://evil.example "$path")
  case "$r" in *"|") ok "preflight evil.example -> $path denied ($r)";; *) fail "preflight evil.example -> $path denied ($r)";; esac
done

# sample data + date filter on PostgreSQL (B7, B8 intent)
"$HERE/../scripts/seed.sh" >/dev/null && ok "seed.sh runs" || fail "seed.sh runs"
"$HERE/../scripts/seed.sh" | grep -q seeded && fail "seed.sh is idempotent (re-run seeded again)" || ok "seed.sh is idempotent"
day() { date -d "$1 day" +%F 2>/dev/null || date -v"$([ "$1" -ge 0 ] && echo "+$1" || echo "$1")d" +%F; }
Y=$(day -1); T=$(day 0); N=$(day 1)
list() { gql "{\"query\":\"{ order(where:{serviceDate:\\\"$1\\\"}, orderBy:{createdUtc:ASC}) { no serviceDate delivered createdUtc } }\"}"; }
res=$(list "$N" | jq_py '
o=d["data"]["order"]
ok = len(o)==6 and all(x["serviceDate"]=="'"$N"'" for x in o) and [x["no"] for x in o]==list(range(1,7)) and [x["createdUtc"] for x in o]==sorted(x["createdUtc"] for x in o)
print("ok" if ok else "bad %d rows" % len(o))' 2>&1)
[ "$res" = ok ] && ok "list tomorrow ($N): exactly 6 orders, only that day, in No/createdUtc order" || fail "list tomorrow ($N): $res"
res=$(list "$Y" | jq_py 'o=d["data"]["order"]; n=sum(x["delivered"] for x in o); print("ok" if len(o)==6 and 0<n<6 else "bad %d rows, %d delivered"%(len(o),n))' 2>&1)
[ "$res" = ok ] && ok "yesterday ($Y): 6 orders, some delivered" || fail "yesterday ($Y): $res"
res=$(list "$T" | jq_py 'o=d["data"]["order"]; print("ok" if len(o)==6 and not any(x["delivered"] for x in o) else "bad")' 2>&1)
[ "$res" = ok ] && ok "today ($T): 6 orders, none delivered" || fail "today ($T): $res"

# --- B11/B12: public client with Authorization Code + PKCE, shared kitchen account (role Kitchen) ---
"$HERE/../scripts/create-kitchen-user.sh" >/dev/null && ok "create-kitchen-user.sh runs" || fail "create-kitchen-user.sh runs"
"$HERE/../scripts/create-kitchen-user.sh" | grep -q exists && ok "create-kitchen-user.sh is idempotent" || fail "create-kitchen-user.sh is idempotent"

CH=47DEQpj8HBSa-_TimW-5JBeL3IYJ4yxC0dRYsgA1YcA   # any S256 challenge shape
AUTH="$BASE_URL/connect/authorize?client_id=bpb-orders-ui&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A5174%2F&scope=openid%20offline_access&state=s"
r=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$AUTH&code_challenge=$CH&code_challenge_method=S256")
case "$r" in 302*"/connect/authorize"*) ok "authorize: public client + PKCE is accepted (302 to the login flow)";; *) fail "authorize: public client + PKCE is accepted ($r)";; esac
body=$(curl -s "$AUTH"); echo "$body" | grep -q -i 'invalid_request' && ok "authorize: request without PKCE is rejected" || fail "authorize: request without PKCE is rejected"
body=$(curl -s "${AUTH/localhost%3A5174/evil.example}&code_challenge=$CH&code_challenge_method=S256"); echo "$body" | grep -q -i 'invalid_request\|invalid_client' && ok "authorize: unregistered redirect URI is rejected" || fail "authorize: unregistered redirect URI is rejected"
code=$(curl -s -o /tmp/bpb-cc.$$ -w '%{http_code}' "$BASE_URL/connect/token" -d grant_type=client_credentials -d client_id=bpb-orders-ui)
case "$code" in 4*) ok "public client cannot use client_credentials ($code)";; *) fail "public client cannot use client_credentials ($code)";; esac
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/connect/token" -d grant_type=client_credentials -d client_id=bpb-orders-ui -d client_secret=anything)
case "$code" in 4*) ok "public client with a made-up secret cannot use client_credentials ($code)";; *) fail "public client with a made-up secret cannot use client_credentials ($code)";; esac
rm -f /tmp/bpb-cc.$$

TOKJSON=$("$HERE/oidc-code-flow.sh" 2>/dev/null) && ok "code flow: login form + PKCE round trip returns tokens" || { fail "code flow: login form + PKCE round trip returns tokens"; TOKJSON='{}'; }
UT=$(echo "$TOKJSON" | jq_py 'print(d.get("access_token",""))' 2>/dev/null); RT=$(echo "$TOKJSON" | jq_py 'print(d.get("refresh_token",""))' 2>/dev/null)
[ -n "$RT" ] && ok "code flow: refresh token issued (offline_access)" || fail "code flow: refresh token issued (offline_access)"
code=$(curl -s -o /tmp/bpb-rt.$$ -w '%{http_code}' "$BASE_URL/connect/token" -d grant_type=refresh_token -d client_id=bpb-orders-ui --data-urlencode "refresh_token=$RT")
[ "$code" = 200 ] && grep -q access_token /tmp/bpb-rt.$$ && ok "refresh_token grant works for the public client" || fail "refresh_token grant works for the public client ($code)"
rm -f /tmp/bpb-rt.$$
u() { curl -s -o /tmp/bpb-u.$$ -w '%{http_code}' "$@" -H "Authorization: Bearer $UT"; }
code=$(u "$BASE_URL/api/graphql" -H 'Content-Type: application/json' -d "{\"query\":\"{ order(where:{serviceDate:\\\"$N\\\"}) { contentItemId no delivered } }\"}")
n=$(jq_py 'print(len(d["data"]["order"]))' < /tmp/bpb-u.$$ 2>/dev/null)
[ "$code" = 200 ] && [ "$n" = 6 ] && ok "kitchen token: GraphQL reads the day's 6 orders" || fail "kitchen token: GraphQL reads orders ($code, $n)"
ID=$(jq_py 'print(d["data"]["order"][0]["contentItemId"])' < /tmp/bpb-u.$$)
code=$(u "$BASE_URL/api/content/$ID"); [ "$code" = 200 ] && ok "kitchen token: GET /api/content/{id}" || fail "kitchen token: GET /api/content/{id} ($code)"
python3 -c 'import sys,json;d=json.load(sys.stdin);d["Order"]["Delivered"]["Value"]=not d["Order"]["Delivered"]["Value"];print(json.dumps(d))' < /tmp/bpb-u.$$ > /tmp/bpb-item.$$
code=$(u "$BASE_URL/api/content" -H 'Content-Type: application/json' -d @/tmp/bpb-item.$$); [ "$code" = 200 ] && ok "kitchen token: POST /api/content updates an order" || fail "kitchen token: POST /api/content updates an order ($code)"
python3 -c 'import sys,json;d=json.load(sys.stdin);d["Order"]["Delivered"]["Value"]=not d["Order"]["Delivered"]["Value"];print(json.dumps(d))' < /tmp/bpb-item.$$ > /tmp/bpb-item2.$$
u "$BASE_URL/api/content" -H 'Content-Type: application/json' -d @/tmp/bpb-item2.$$ >/dev/null   # restore the flag
code=$(u -X DELETE "$BASE_URL/api/content/$ID"); case "$code" in 401|403|404|405) ok "kitchen token: DELETE an order is denied ($code)";; *) fail "kitchen token: DELETE an order is denied ($code)";; esac
code=$(u "$BASE_URL/api/content/$ID"); [ "$code" = 200 ] && ok "kitchen token: the order is still there after the denied DELETE" || fail "order still there after DELETE ($code)"
code=$(u "$BASE_URL/api/content" -H 'Content-Type: application/json' -d '{"ContentType":"User"}'); case "$code" in 2*) fail "kitchen token: cannot create other content types ($code)";; *) ok "kitchen token: cannot create other content types ($code)";; esac
for path in /Admin /Admin/Users/Create /Admin/Roles /Admin/OpenId/Application; do
  r=$(u "$BASE_URL$path"); loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE_URL$path" -H "Authorization: Bearer $UT")
  case "$r" in 302) case "$loc" in *Login*) ok "kitchen token: $path needs the cookie login, not the token ($r)";; *) fail "$path ($r -> $loc)";; esac;; 401|403|404) ok "kitchen token: $path denied ($r)";; *) fail "kitchen token: $path denied ($r)";; esac
done
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/connect/token" -d grant_type=password -d client_id=bpb-orders-ui -d "username=$KITCHEN_USERNAME" --data-urlencode "password=$KITCHEN_PASSWORD")
case "$code" in 4*) ok "password grant is disabled ($code)";; *) fail "password grant is disabled ($code)";; esac
# the kitchen account is not an Administrator: its role claim is only Kitchen, so it cannot sign in to /Admin
J=$(mktemp); pg=$(mktemp); curl -s -c "$J" -b "$J" "$BASE_URL/Login" -o "$pg"
tk=$(grep -o 'name="__RequestVerificationToken"[^>]*value="[^"]*"' "$pg" | head -1 | sed 's/.*value="//;s/"$//')
curl -s -c "$J" -b "$J" -o /dev/null "$BASE_URL/Login" --data-urlencode "__RequestVerificationToken=$tk" -d "LoginForm.UserName=$KITCHEN_USERNAME" --data-urlencode "LoginForm.Password=$KITCHEN_PASSWORD"
code=$(curl -s -b "$J" -o /dev/null -w '%{http_code}' "$BASE_URL/Admin/Users/Create"); loc=$(curl -s -b "$J" -o /dev/null -w '%{redirect_url}' "$BASE_URL/Admin/Users/Create")
case "$code" in 401|403|404) ok "kitchen cookie session cannot open the admin user form ($code)";; 302) case "$loc" in *Login*|*AccessDenied*|*Error/403*) ok "kitchen cookie session cannot open the admin user form (302 $loc)";; *) fail "kitchen cookie session cannot open admin ($code $loc)";; esac;; *) fail "kitchen cookie session cannot open the admin user form ($code)";; esac
rm -f "$J" "$pg" /tmp/bpb-u.$$ /tmp/bpb-item.$$ /tmp/bpb-item2.$$

[ $FAIL = 0 ] && echo "ALL PASSED" || { echo "FAILURES"; exit 1; }
