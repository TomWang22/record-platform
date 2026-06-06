#!/usr/bin/env bash
# Bounded MinIO health + idempotent bucket create (record-media by default).
set -euo pipefail

MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_HOST="${MINIO_HOST:-127.0.0.1}"
MINIO_BUCKET="${MINIO_BUCKET:-${S3_BUCKET:-record-media}}"
MINIO_USER="${MINIO_ROOT_USER:-minio}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-minio123}"
MINIO_CONTAINER="${MINIO_CONTAINER:-record-platform-minio}"
MINIO_TIMEOUT_SEC="${MINIO_TIMEOUT_SEC:-120}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log() { printf '[ensure-minio-bucket] %s\n' "$*"; }
fail() {
  log "FAIL: $*"
  log "docker ps (minio):"
  docker ps -a --filter "name=${MINIO_CONTAINER}" 2>&1 || true
  if docker ps -a --filter "name=${MINIO_CONTAINER}" --format '{{.Names}}' 2>/dev/null | grep -q .; then
    log "MinIO container logs (last 120 lines):"
    docker logs --tail=120 "$MINIO_CONTAINER" 2>&1 || true
    log "MinIO health state:"
    docker inspect "$MINIO_CONTAINER" --format '{{json .State.Health}}' 2>&1 || true
  else
    log "container ${MINIO_CONTAINER} not found — try: docker compose -f ${COMPOSE_FILE} up -d minio"
    docker compose -f "$REPO_ROOT/$COMPOSE_FILE" ps minio 2>&1 || true
  fi
  exit 1
}

_ensure_minio_container() {
  if docker ps --filter "name=^${MINIO_CONTAINER}$" --format '{{.Names}}' 2>/dev/null | grep -q .; then
    return 0
  fi
  log "starting MinIO via docker compose (service minio)"
  (cd "$REPO_ROOT" && docker compose -f "$COMPOSE_FILE" up -d minio) || fail "docker compose up -d minio failed"
}

_wait_tcp() {
  local elapsed=0 interval=3
  while [[ $elapsed -lt $MINIO_TIMEOUT_SEC ]]; do
    if nc -z "$MINIO_HOST" "$MINIO_PORT" 2>/dev/null; then
      log "MinIO TCP ready on ${MINIO_HOST}:${MINIO_PORT} (${elapsed}s)"
      return 0
    fi
    log "waiting: nc -z ${MINIO_HOST} ${MINIO_PORT} (${elapsed}s / ${MINIO_TIMEOUT_SEC}s)"
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  fail "MinIO port ${MINIO_HOST}:${MINIO_PORT} not open after ${MINIO_TIMEOUT_SEC}s"
}

_wait_health() {
  local path label elapsed=0 interval=3
  for path in /minio/health/live /minio/health/ready; do
    label="${path##*/}"
    elapsed=0
    while [[ $elapsed -lt $MINIO_TIMEOUT_SEC ]]; do
      if curl -fsS "http://${MINIO_HOST}:${MINIO_PORT}${path}" >/dev/null 2>&1; then
        log "MinIO health/${label} OK (${elapsed}s)"
        break
      fi
      log "waiting: curl -fsS http://${MINIO_HOST}:${MINIO_PORT}${path} (${elapsed}s / ${MINIO_TIMEOUT_SEC}s)"
      sleep "$interval"
      elapsed=$((elapsed + interval))
      if [[ $elapsed -ge $MINIO_TIMEOUT_SEC ]]; then
        fail "MinIO health/${label} failed after ${MINIO_TIMEOUT_SEC}s"
      fi
    done
  done
}

_mc() {
  docker run --rm --network host \
    -e "MC_HOST_rp=http://${MINIO_USER}:${MINIO_PASS}@${MINIO_HOST}:${MINIO_PORT}" \
    minio/mc:latest "$@"
}

_ensure_bucket() {
  log "running: minio/mc ls rp"
  if ! _mc ls rp 2>&1; then
    log "mc ls failed (may be empty alias); continuing to mb"
  fi
  log "running: minio/mc mb --ignore-existing rp/${MINIO_BUCKET}"
  if ! _mc mb --ignore-existing "rp/${MINIO_BUCKET}" 2>&1; then
    fail "mc mb rp/${MINIO_BUCKET} failed"
  fi
  log "running: minio/mc stat rp/${MINIO_BUCKET}"
  _mc stat "rp/${MINIO_BUCKET}" >/dev/null 2>&1 || fail "bucket rp/${MINIO_BUCKET} not visible after create"
  log "bucket rp/${MINIO_BUCKET} ready"
}

_ensure_minio_container
_wait_tcp
_wait_health
_ensure_bucket
