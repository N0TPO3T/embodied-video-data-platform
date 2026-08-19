#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env}"
public_host="${2:?public host is required}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing environment file: $env_file" >&2
  exit 1
fi

read_env() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$env_file"
}

upsert_env() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "${env_file}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) print key "=" value
    }
  ' "$env_file" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$env_file"
}

secure_secret() {
  local key="$1"
  local weak_value="${2:-}"
  local current
  current="$(read_env "$key")"
  if [[ -z "$current" || "$current" == "$weak_value" ]]; then
    current="$(openssl rand -hex 32)"
    upsert_env "$key" "$current"
  fi
  printf '%s' "$current"
}

postgres_user="$(read_env POSTGRES_USER)"
postgres_database="$(read_env POSTGRES_DB)"
postgres_user="${postgres_user:-evdp}"
postgres_database="${postgres_database:-evdp}"
postgres_password="$(secure_secret POSTGRES_PASSWORD evdp_local_postgres_password)"
redis_password="$(secure_secret REDIS_PASSWORD evdp_local_redis_password)"
rabbitmq_password="$(secure_secret RABBITMQ_DEFAULT_PASS evdp_local_rabbitmq_password)"
minio_password="$(secure_secret MINIO_ROOT_PASSWORD evdp_local_minio_password)"
secure_secret SESSION_SECRET "" >/dev/null

rabbitmq_user="$(read_env RABBITMQ_DEFAULT_USER)"
rabbitmq_user="${rabbitmq_user:-evdp}"

minio_user="$(read_env MINIO_ROOT_USER)"
if [[ -z "$minio_user" || "$minio_user" == "evdp_local_minio" ]]; then
  minio_user="evdpadmin"
  upsert_env MINIO_ROOT_USER "$minio_user"
fi

upsert_env POSTGRES_DB "$postgres_database"
upsert_env POSTGRES_USER "$postgres_user"
upsert_env DATABASE_URL "postgresql://${postgres_user}:${postgres_password}@postgres:5432/${postgres_database}"
upsert_env REDIS_URL "redis://:${redis_password}@redis:6379/0"
upsert_env RABBITMQ_DEFAULT_USER "$rabbitmq_user"
upsert_env RABBITMQ_URL "amqp://${rabbitmq_user}:${rabbitmq_password}@rabbitmq:5672"
upsert_env MINIO_ACCESS_KEY "$minio_user"
upsert_env MINIO_SECRET_KEY "$minio_password"
upsert_env MINIO_ENDPOINT "http://minio:9000"
upsert_env MINIO_API_HOST_PORT "19000"
upsert_env MINIO_CONSOLE_HOST_PORT "19001"
upsert_env MINIO_PUBLIC_BIND_ADDRESS "0.0.0.0"
upsert_env MINIO_PUBLIC_HOST_PORT "9000"
upsert_env MINIO_PUBLIC_ENDPOINT "http://${public_host}:9000"
upsert_env WEB_BIND_ADDRESS "0.0.0.0"
upsert_env WEB_HOST_PORT "80"
upsert_env WEB_ORIGIN "http://${public_host}"
upsert_env COOKIE_SECURE "false"
upsert_env TRUST_PROXY_HOPS "1"
upsert_env NEXT_PUBLIC_API_BASE_URL "/api/v1"
upsert_env BACKEND_INTERNAL_URL "http://api:4000/api/v1"

chmod 600 "$env_file"

if [[ -n "$(read_env QWEN_API_KEY)" && -n "$(read_env QWEN_BASE_URL)" ]]; then
  echo "Production environment prepared; Qwen credentials are configured."
else
  echo "Production environment prepared; Qwen credentials are missing." >&2
  exit 2
fi
