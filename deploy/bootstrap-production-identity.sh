#!/usr/bin/env bash
set -euo pipefail

project_directory="${1:-/srv/evdp}"
public_origin="${2:?public origin is required}"
credentials_file="${3:-/root/evdp-initial-credentials.txt}"

cd "$project_directory"

compose=(docker compose -f compose.yaml -f compose.prod.yaml)
postgres_user="$(awk -F= '$1 == "POSTGRES_USER" { print $2; exit }' .env)"
postgres_database="$(awk -F= '$1 == "POSTGRES_DB" { print $2; exit }' .env)"
user_count="$(${compose[@]} exec -T postgres psql -U "$postgres_user" -d "$postgres_database" -tAc 'SELECT COUNT(*) FROM users')"
user_count="${user_count//[[:space:]]/}"

if [[ "$user_count" != "0" ]]; then
  echo "Identity store already contains users; bootstrap skipped."
  exit 0
fi

random_password() {
  printf 'Evdp-%s!' "$(openssl rand -hex 12)"
}

admin_password="$(random_password)"
leader_one_password="$(random_password)"
leader_two_password="$(random_password)"
collector_one_password="$(random_password)"
collector_two_password="$(random_password)"
collector_three_password="$(random_password)"
collector_four_password="$(random_password)"
collector_five_password="$(random_password)"
cookie_file="$(mktemp)"
trap 'rm -f "$cookie_file"' EXIT

EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=true \
  "${compose[@]}" run --rm --no-deps \
  -e EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=true \
  api node dist/cli/bootstrap-local-identity.js >/dev/null

curl -fsS -c "$cookie_file" \
  -H "Origin: ${public_origin}" \
  -H 'Content-Type: application/json' \
  --data '{"username":"admin","password":"admin123"}' \
  http://127.0.0.1:4000/api/v1/auth/login >/dev/null

reset_password() {
  local account_id="$1"
  local password="$2"
  curl -fsS -b "$cookie_file" \
    -H "Origin: ${public_origin}" \
    -H 'Content-Type: application/json' \
    --data "{\"password\":\"${password}\"}" \
    "http://127.0.0.1:4000/api/v1/accounts/${account_id}/reset-password" >/dev/null
}

reset_password U-LEAD-01 "$leader_one_password"
reset_password U-LEAD-02 "$leader_two_password"
reset_password U-COL-01 "$collector_one_password"
reset_password U-COL-02 "$collector_two_password"
reset_password U-COL-03 "$collector_three_password"
reset_password U-COL-04 "$collector_four_password"
reset_password U-COL-05 "$collector_five_password"

curl -fsS -b "$cookie_file" \
  -H "Origin: ${public_origin}" \
  -H 'Content-Type: application/json' \
  --data "{\"currentPassword\":\"admin123\",\"newPassword\":\"${admin_password}\"}" \
  http://127.0.0.1:4000/api/v1/accounts/me/change-password >/dev/null

curl -fsS -c "$cookie_file" \
  -H "Origin: ${public_origin}" \
  -H 'Content-Type: application/json' \
  --data "{\"username\":\"admin\",\"password\":\"${admin_password}\"}" \
  http://127.0.0.1:4000/api/v1/auth/login >/dev/null

umask 077
{
  printf 'admin=%s\n' "$admin_password"
  printf 'tuanzhang1=%s\n' "$leader_one_password"
  printf 'tuanzhang2=%s\n' "$leader_two_password"
  printf 'ceshirenyuan1=%s\n' "$collector_one_password"
  printf 'ceshirenyuan2=%s\n' "$collector_two_password"
  printf 'ceshirenyuan3=%s\n' "$collector_three_password"
  printf 'ceshirenyuan4=%s\n' "$collector_four_password"
  printf 'ceshirenyuan5=%s\n' "$collector_five_password"
} > "$credentials_file"
chmod 600 "$credentials_file"

echo "Starter accounts created, rotated, and verified."
