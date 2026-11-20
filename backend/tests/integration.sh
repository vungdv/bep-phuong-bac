#!/usr/bin/env bash
# Backend integration test: bash + curl against a running stack (docker compose up).
# Env: BASE_URL (default http://localhost:5080), SCRIPT_CLIENT_SECRET (from backend/.env if present).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/../.env" ] && { set -a; . "$HERE/../.env"; set +a; }
BASE_URL=${BASE_URL:-http://localhost:5080}
: "${SCRIPT_CLIENT_SECRET:?set SCRIPT_CLIENT_SECRET}"
export BASE_URL SCRIPT_CLIENT_SECRET TZ=${SEED_TZ:-Asia/Ho_Chi_Minh}
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

[ $FAIL = 0 ] && echo "ALL PASSED" || { echo "FAILURES"; exit 1; }
