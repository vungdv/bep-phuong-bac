#!/usr/bin/env bash
# Creates the shared kitchen account (role Kitchen, NOT Administrator) through the Orchard Core admin
# user form, because OC 3.0.1 has no user REST API and its recipe `users` step cannot set a password.
# Idempotent: an existing account is left alone. The password comes from the environment, never from source.
# Env: BASE_URL (default http://localhost:5080), ADMIN_USERNAME (default admin), ADMIN_PASSWORD (required),
#      KITCHEN_USERNAME (required), KITCHEN_PASSWORD (required). Run once after the first start.
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:5080}
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}" "${KITCHEN_USERNAME:?set KITCHEN_USERNAME}" "${KITCHEN_PASSWORD:?set KITCHEN_PASSWORD}"
JAR=$(mktemp); PAGE=$(mktemp); trap 'rm -f "$JAR" "$PAGE"' EXIT

token() { grep -o 'name="__RequestVerificationToken"[^>]*value="[^"]*"' "$PAGE" | head -1 | sed 's/.*value="//;s/"$//'; }

login() { # login <user> <password> -> HTTP status of the form post (302 = signed in); cookies go to $JAR
  : >"$JAR"
  curl -fsS -c "$JAR" -b "$JAR" "$BASE_URL/Login" -o "$PAGE"
  curl -sS -c "$JAR" -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE_URL/Login" \
    --data-urlencode "__RequestVerificationToken=$(token)" --data-urlencode "LoginForm.UserName=$1" \
    --data-urlencode "LoginForm.Password=$2"
}

# Idempotent: the account exists when it can already sign in (the admin user list is not available without a theme).
if [ "$(login "$KITCHEN_USERNAME" "$KITCHEN_PASSWORD")" = 302 ]; then echo "kitchen user '$KITCHEN_USERNAME' exists"; exit 0; fi
[ "$(login "$ADMIN_USERNAME" "$ADMIN_PASSWORD")" = 302 ] || { echo "admin login failed" >&2; exit 1; }

curl -fsS -c "$JAR" -b "$JAR" "$BASE_URL/Admin/Users/Create" -o "$PAGE"
# The form binds the role list by index, so every role must be sent; only Kitchen is selected.
roles=(); found=0
while IFS= read -r line; do
  i=${line%%|*}; r=${line#*|}; sel=false
  [ "$r" = Kitchen ] && { sel=true; found=1; }
  roles+=(--form-string "User.Roles[$i].Role=$r" --form-string "User.Roles[$i].IsSelected=$sel")
done < <(grep -o 'name="User.Roles\[[0-9]*\].Role" value="[^"]*"' "$PAGE" | sed 's/.*Roles\[\([0-9]*\)\].Role" value="\(.*\)"/\1|\2/')
[ "$found" = 1 ] || { echo "role Kitchen not found: was the BpbOrders recipe applied?" >&2; exit 1; }
code=$(curl -sS -c "$JAR" -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE_URL/Admin/Users/Create" \
  --form-string "__RequestVerificationToken=$(token)" --form-string "User.UserName=$KITCHEN_USERNAME" \
  --form-string "User.Email=$KITCHEN_USERNAME@bpb.local" --form-string "User.Password=$KITCHEN_PASSWORD" \
  --form-string "User.PasswordConfirmation=$KITCHEN_PASSWORD" "${roles[@]}")
[ "$code" = 302 ] || { echo "creating the kitchen user failed (HTTP $code; the name may be taken with another password)" >&2; exit 1; }
echo "created kitchen user '$KITCHEN_USERNAME' (role Kitchen)"
