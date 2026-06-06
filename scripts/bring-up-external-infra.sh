#!/usr/bin/env bash
# Bring up RP external dependencies (single docker-compose.yml): Redis, MinIO, Postgres 5433–5443.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MAX_WAIT="${MAX_WAIT:-180}"
SKIP_COMPOSE_UP="${SKIP_COMPOSE_UP:-0}"
ENFORCE_DB_TUNING="${ENFORCE_DB_TUNING:-0}"
WAIT_K8S_KAFKA="${WAIT_K8S_KAFKA:-0}"
HOUSING_NS="${HOUSING_NS:-record-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

_step_n=0
step() { _step_n=$((_step_n + 1)); say "Step ${_step_n}: $*"; }

# shellcheck source=lib/ensure-colima-docker-context.sh
source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
# shellcheck source=lib/rp-colima-running.sh
source "$SCRIPT_DIR/lib/rp-colima-running.sh"
if command -v colima >/dev/null 2>&1 && rp_colima_is_running; then
  OCH_FORCE_COLIMA_DOCKER=1 och_ensure_colima_docker_context || true
fi
docker info >/dev/null 2>&1 || { warn "Docker not reachable"; exit 1; }

POSTGRES_SERVICES=(
  postgres-records postgres-messaging postgres-listings postgres-shopping postgres-auth
  postgres-auction-monitor-core postgres-analytics postgres-python-ai
  postgres-notification postgres-trust postgres-media
)

bash "$SCRIPT_DIR/rp-stop-och-external-containers.sh" || true

chmod +x "$SCRIPT_DIR/rp-verify-compose-contract.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/rp-verify-compose-contract.sh" || { warn "RP compose contract failed — fix docker-compose.yml"; exit 1; }

EXTERNAL_SERVICES=(
  redis minio jaeger mailpit
  "${POSTGRES_SERVICES[@]}"
)

if [[ "$SKIP_COMPOSE_UP" != "1" ]]; then
  step "Starting RP external deps (docker-compose.yml — no Kafka/apps)"
  docker compose -f "$COMPOSE_FILE" up -d "${EXTERNAL_SERVICES[@]}" 2>&1 || true
else
  info "SKIP_COMPOSE_UP=1"
fi

REDIS_PORT="${REDIS_PORT:-6379}"
step "Waiting for Redis ($REDIS_PORT)"
elapsed=0
_redis_ok=0
while [[ $elapsed -lt $MAX_WAIT ]]; do
  if nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
    ok "Redis"
    _redis_ok=1
    break
  fi
  info "waiting: nc -z 127.0.0.1 ${REDIS_PORT} (${elapsed}s / ${MAX_WAIT}s)"
  sleep 5
  elapsed=$((elapsed + 5))
done
[[ "$_redis_ok" -eq 1 ]] || { warn "Redis not ready on :${REDIS_PORT} after ${MAX_WAIT}s"; exit 1; }

if [[ "$SKIP_COMPOSE_UP" == "1" ]]; then
  info "SKIP_COMPOSE_UP=1 — still ensuring Redis + MinIO are up"
  docker compose -f "$COMPOSE_FILE" up -d redis minio 2>&1 || true
fi

MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_BUCKET="${S3_BUCKET:-record-media}"
step "Ensuring MinIO bucket ($MINIO_BUCKET on :$MINIO_PORT)"
chmod +x "$SCRIPT_DIR/ensure-minio-bucket.sh" 2>/dev/null || true
MINIO_TIMEOUT_SEC="${MINIO_TIMEOUT_SEC:-$MAX_WAIT}" \
  MINIO_BUCKET="$MINIO_BUCKET" \
  MINIO_PORT="$MINIO_PORT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  REPO_ROOT="$REPO_ROOT" \
  bash "$SCRIPT_DIR/ensure-minio-bucket.sh" || {
  warn "MinIO bucket step failed — see ensure-minio-bucket.sh output above"
  exit 1
}
ok "MinIO bucket ${MINIO_BUCKET}"

PORTS="5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443"
step "Waiting for Postgres ($PORTS)"
elapsed=0
_pg_ok=0
while [[ $elapsed -lt $MAX_WAIT ]]; do
  all_ok=true
  for port in $PORTS; do
    nc -z 127.0.0.1 "$port" 2>/dev/null || { all_ok=false; break; }
  done
  if [[ "$all_ok" == "true" ]]; then
    ok "All RP Postgres ports ready"
    _pg_ok=1
    break
  fi
  info "waiting: Postgres ports 5433–5443 (${elapsed}s / ${MAX_WAIT}s)"
  sleep 5
  elapsed=$((elapsed + 5))
done
[[ "$_pg_ok" -eq 1 ]] || { warn "Postgres not ready on 5433–5443 after ${MAX_WAIT}s"; docker compose -f "$COMPOSE_FILE" ps "${POSTGRES_SERVICES[@]}" 2>&1 || true; exit 1; }

docker compose -f "$COMPOSE_FILE" ps redis minio jaeger mailpit "${POSTGRES_SERVICES[@]}" 2>/dev/null || true

RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-}"
if [[ -n "$RESTORE_BACKUP_DIR" ]] && [[ "${SKIP_AUTO_RESTORE:-0}" != "1" ]]; then
  eval "$(bash "$SCRIPT_DIR/resolve-rp-restore-backup-dir.sh" "${RESTORE_BACKUP_DIR:-latest}")"
  RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR_ABS:-$RESTORE_BACKUP_DIR}"
  echo "=== Auto-restore (RP runtime 5433–5443): $RESTORE_BACKUP_DIR ==="
  export RP_SKIP_BOOKING_DB="${RP_SKIP_BOOKING_DB:-1}"
  export RP_SKIP_SOCIAL_SERVICE="${RP_SKIP_SOCIAL_SERVICE:-1}"
  "$SCRIPT_DIR/restore-rp-hybrid-backup.sh" "$RESTORE_BACKUP_DIR"
fi

bash "$SCRIPT_DIR/rp-verify-external-runtime-ports.sh" || warn "RP port check failed — fix legacy port conflicts before restore"

ok "bring-up-external-infra finished"
