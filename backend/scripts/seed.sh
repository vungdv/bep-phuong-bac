#!/usr/bin/env bash
# Seeds sample orders for yesterday, today and tomorrow (development only).
# Idempotent: a day that already has orders is skipped. Uses the public APIs
# (client-credentials token, GraphQL read, content write), no database access.
# Env: BASE_URL (default http://localhost:5080), SCRIPT_CLIENT_SECRET (required),
#      SEED_TZ (default Asia/Ho_Chi_Minh, the tenant time zone).
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:5080}
: "${SCRIPT_CLIENT_SECRET:?set SCRIPT_CLIENT_SECRET}"
export TZ=${SEED_TZ:-Asia/Ho_Chi_Minh}

day() { # day <offset> -> YYYY-MM-DD relative to today in $TZ (GNU or BSD date)
  date -d "$1 day" +%F 2>/dev/null || date -v"$([ "$1" -ge 0 ] && echo "+$1" || echo "$1")d" +%F
}

TOKEN=$(curl -fsS "$BASE_URL/connect/token" -d grant_type=client_credentials \
  -d client_id=bpb-orders-script --data-urlencode "client_secret=$SCRIPT_CLIENT_SECRET" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

count_for() { # count_for <date>  (ServiceDate is a text field "YYYY-MM-DD"; equality works on PostgreSQL)
  curl -fsS "$BASE_URL/api/graphql" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"query\":\"{ order(where:{serviceDate:\\\"$1\\\"}) { contentItemId } }\"}" |
    python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]["order"]))'
}

# name|qty|message|hour|minute  (same rows as apps/orders local-storage-orders-api.ts)
ROWS=$(cat <<'ROWS'
Nguyễn Văn An|2|Ít cay, giao trước 11h|8|5
Trần Thị Bích|1||8|40
Lê Hoàng Nam|4|Thêm rau sống|9|15
Phạm Thu Hà|3||10|2
Võ Minh Tuấn|5|Gọi trước khi đến|10|48
Đặng Ngọc Lan|1|Không hành|11|30
ROWS
)

for offset in -1 0 1; do
  d=$(day "$offset")
  if [ "$(count_for "$d")" -gt 0 ]; then echo "skip $d (already has orders)"; continue; fi
  no=0
  while IFS='|' read -r name qty msg h m; do
    no=$((no + 1))
    # only some of yesterday's orders are delivered (odd positions), like the front-end seed
    delivered=false; { [ "$offset" = -1 ] && [ $((no % 2)) -eq 1 ]; } && delivered=true
    body=$(python3 - "$no" "$name" "$qty" "$msg" "$d" "$delivered" <<'PY'
import json, sys
no, name, qty, msg, d, delivered = sys.argv[1:]
print(json.dumps({"ContentType": "Order", "DisplayText": f"{d} #{no} {name}", "Published": True, "Latest": True,
  "Order": {"No": {"Value": int(no)}, "CustomerName": {"Text": name}, "Qty": {"Value": int(qty)},
            "Message": {"Text": msg}, "ServiceDate": {"Text": d},
            "Delivered": {"Value": delivered == "true"}}}, ensure_ascii=False))
PY
)
    curl -fsS -o /dev/null "$BASE_URL/api/content" -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' -d "$body"
  done <<< "$ROWS"
  echo "seeded $d ($no orders)"
done
