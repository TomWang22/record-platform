#!/usr/bin/env bash
# Preflight before running load-all-dbs-millions.sh: Docker responsive, Postgres containers up (5433–5440), disk space.
# Run: ./scripts/preflight-load-dbs.sh
# Skip disk check: SKIP_DISK_CHECK=1 ./scripts/preflight-load-dbs.sh
# Optional: PREFLIGHT_PORTS="5433 5439 5440" to only check those ports.
# Optional: PREFLIGHT_DOCKER_TIMEOUT=20 — max seconds to wait for docker ps (default 20). Colima can hang; we never block indefinitely.
set -Euo pipefail

ts() { printf '%s' "$(date '+%Y-%m-%d %H:%M:%S')"; }

FAILED=0
DOCKER_TIMEOUT="${PREFLIGHT_DOCKER_TIMEOUT:-20}"

# Portable timeout: run command with max wait (no GNU timeout needed). Returns 124 on timeout.
_run_with_timeout() {
  local timeout_sec=$1 out_f=$2
  shift 2
  rm -f "$out_f" "${out_f}.exit"
  ( "$@" > "$out_f" 2>/dev/null; echo $? > "${out_f}.exit" ) & local pid=$!
  local i=0
  while [[ $i -lt "$timeout_sec" ]]; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    rm -f "$out_f" "${out_f}.exit"
    return 124
  fi
  wait "$pid" 2>/dev/null
  local ec; ec=$(cat "${out_f}.exit" 2>/dev/null); rm -f "${out_f}.exit"
  return "${ec:-1}"
}

echo "$(ts) === Preflight for DB load (load-all-dbs-millions.sh) ==="
echo ""

# 1) Docker responsive with timeout (Colima/Docker can hang for minutes otherwise)
echo "$(ts) Checking Docker (timeout ${DOCKER_TIMEOUT}s)..."
_tmp="/tmp/preflight-docker.$$"
if _run_with_timeout "$DOCKER_TIMEOUT" "$_tmp" docker ps -q; then
  echo "$(ts) Docker OK"
else
  rm -f "$_tmp"
  echo "$(ts) ERROR: Docker did not respond within ${DOCKER_TIMEOUT}s (Colima/Docker may be hung or cold). Run: docker ps" >&2
  exit 1
fi
rm -f "$_tmp"
echo ""

# 2) Containers for each port (each check also timed so one slow port doesn't block the rest)
PORTS="${PREFLIGHT_PORTS:-5433 5434 5435 5436 5437 5438 5439 5440}"
for port in $PORTS; do
  _out="/tmp/preflight-port.$$.$port"
  if _run_with_timeout "$DOCKER_TIMEOUT" "$_out" docker ps -q --filter "publish=${port}" --format '{{.Names}}'; then
    name=$(head -1 "$_out" 2>/dev/null)
  else
    name=""
  fi
  rm -f "$_out"
  if [[ -z "$name" ]]; then
    echo "$(ts) WARN: No container publishing port $port within ${DOCKER_TIMEOUT}s (start with: docker compose up -d)" >&2
    FAILED=1
  else
    echo "$(ts) Port $port: $name"
  fi
done
echo ""

# 3) Disk space (same policy as pgbench: warn >90%, refuse >95%)
if [[ "${SKIP_DISK_CHECK:-0}" != "1" ]]; then
  echo "$(ts) Checking disk space..."
  # Use the mount for current directory (repo root typically)
  pct="$(df -P . 2>/dev/null | awk 'NR==2 { gsub(/%/,""); print $5 }')"
  if [[ -z "$pct" || ! "$pct" =~ ^[0-9]+$ ]]; then
    echo "$(ts) WARN: Could not get disk usage (df -P .)" >&2
  elif [[ "$pct" -ge 95 ]]; then
    echo "$(ts) ERROR: Disk usage ${pct}% >= 95%. Free space before loading millions of rows." >&2
    FAILED=1
  elif [[ "$pct" -ge 90 ]]; then
    echo "$(ts) WARN: Disk usage ${pct}% >= 90%. Consider freeing space." >&2
  else
    echo "$(ts) Disk usage: ${pct}% OK"
  fi
else
  echo "$(ts) Skipping disk check (SKIP_DISK_CHECK=1)"
fi
echo ""

if [[ "$FAILED" -eq 1 ]]; then
  echo "$(ts) Preflight had warnings or errors. Fix above before running load-all-dbs-millions.sh." >&2
  exit 1
fi

echo "$(ts) Preflight OK. You can run: PGSQL_VIA_DOCKER=1 LOAD_SAFE_FOR_COLIMA=1 ./scripts/load-all-dbs-millions.sh"
exit 0
