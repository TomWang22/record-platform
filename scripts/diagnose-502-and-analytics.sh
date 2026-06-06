#!/usr/bin/env bash
# Live diagnostic for 502 (listings/social), analytics log-search logged:false, Python AI 503.
# Uses nc only (no /dev/tcp). Summary reflects live truth only — no stale blame.
set -euo pipefail

NS="record-platform"
say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*"; }
info(){ echo "ℹ️  $*"; }

HOST_OK=true
POD_OK=true

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

check_host_port() {
  local port=$1
  if nc -z -w2 127.0.0.1 "$port" 2>/dev/null; then
    ok "Host port $port reachable"
  elif command -v psql >/dev/null 2>&1 && PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -p "$port" -U postgres -c "SELECT 1" 2>/dev/null | grep -q 1; then
    ok "Host port $port reachable (psql)"
  else
    warn "Host port $port unreachable"
    HOST_OK=false
  fi
}

check_pod_port() {
  local port=$1
  local pod
  pod=$(_kb -n "$NS" get pods -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  [[ -z "$pod" ]] && pod=$(_kb -n "$NS" get pods -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  [[ -z "$pod" ]] && pod=$(_kb -n "$NS" get pods -l app=python-ai-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -z "$pod" ]]; then
    warn "No pod in $NS for pod→host check"
    POD_OK=false
    return
  fi
  if _kb -n "$NS" exec "$pod" -- sh -c "nc -z -w2 host.docker.internal $port" 2>/dev/null; then
    ok "Pod → host.docker.internal:$port reachable"
  else
    warn "Pod → host.docker.internal:$port unreachable"
    POD_OK=false
  fi
}

say "=== Live 502 / DB Diagnostic ==="
info "Checks: host DB ports, pod→host.docker.internal, then summary from live results only."

say "1. Host DB ports (127.0.0.1)"
for p in 5433 5434 5435 5436 5437 5438 5439 5440; do
  check_host_port "$p"
done

say "2. Pod → host.docker.internal"
for p in 5433 5435 5440; do
  check_pod_port "$p"
done

# 3. Analytics table (records 5433)
say "3. Host → records (5433): listings.search_history"
if command -v psql >/dev/null 2>&1; then
  if PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -p 5433 -U postgres -d records -c "SELECT 1 FROM listings.search_history LIMIT 1" 2>/dev/null | grep -q 1; then
    ok "records:listings.search_history exists and readable"
  elif PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -p 5433 -U postgres -d records -c "\d listings.search_history" 2>/dev/null | grep -q "Column"; then
    ok "records:listings.search_history exists (table empty)"
  else
    warn "records:listings.search_history missing or unreachable"
  fi
else
  info "Skipped (no psql)"
fi

# 4. Python AI DB (5440)
say "4. Host → python_ai DB (5440)"
if command -v psql >/dev/null 2>&1; then
  if PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -c "SELECT 1" 2>/dev/null | grep -q 1; then
    ok "python_ai DB reachable"
  else
    warn "python_ai DB unreachable or missing"
  fi
else
  info "Skipped (no psql)"
fi

say "=== Live Summary ==="
if [[ "$HOST_OK" == "true" ]] && [[ "$POD_OK" == "true" ]]; then
  ok "All live DB connectivity checks passed."
  info "If 502 or logged:false still occur, check app logs and that Postgres listens on 0.0.0.0. See docs/COLIMA_POD_STABILITY_AND_HOST_ALIASES.md"
  exit 0
else
  fail "Connectivity issue detected (host and/or pod→host)."
  if [[ "$ctx" == *"k3d"* ]]; then
    info "On k3d: run ./scripts/apply-k3d-host-aliases.sh (or HOST_GATEWAY_IP=<ip> ./scripts/apply-k3d-host-aliases.sh)"
  else
    info "On Colima: run ./scripts/colima-apply-host-aliases.sh"
  fi
  info "Ensure: Postgres listens 0.0.0.0, no SSH on 5433–5440, python_ai DB created. See docs/COLIMA_POD_STABILITY_AND_HOST_ALIASES.md"
  exit 1
fi
