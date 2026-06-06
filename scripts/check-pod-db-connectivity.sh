#!/usr/bin/env bash
# Check pod → Postgres connectivity (host.docker.internal) for services that show 502 or "Cannot reach records DB".
# Use when Test 12f (listings 502 H2) or Test 13k (analytics records DB) fail. See docs/CROSS_DB_CONNECTIVITY_AND_ROTATION_HARDENING.md.
set -euo pipefail

NS="${1:-record-platform}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh" || kctl() { kubectl "$@"; }

echo "=== Pod → DB connectivity (namespace: $NS) ==="
echo ""

_check() {
  local deploy="$1"
  local port="$2"
  local label="$3"
  local pod
  pod=$(kctl -n "$NS" get pods -l "app=$deploy" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -z "$pod" ]]; then
    echo "  ⚠ $deploy: no pod found (deploy not running?)"
    return 1
  fi
  echo "  $deploy ($label) → host.docker.internal:$port (pod: $pod)"
  # Try nc first; many images have busybox nc
  if kctl -n "$NS" exec "$pod" -- sh -c "command -v nc >/dev/null 2>&1" 2>/dev/null; then
    if kctl -n "$NS" exec "$pod" -- sh -c "nc -zv host.docker.internal $port 2>&1" 2>/dev/null; then
      echo "    ✅ nc: connect OK"
    else
      echo "    ❌ nc: connect FAILED"
    fi
  else
    echo "    ℹ️  nc not in image (install nc or run manually: kubectl exec -it deploy/$deploy -n $NS -- sh)"
  fi
  if kctl -n "$NS" exec "$pod" -- sh -c "command -v getent >/dev/null 2>&1" 2>/dev/null; then
    local out
    out=$(kctl -n "$NS" exec "$pod" -- getent hosts host.docker.internal 2>&1 || true)
    if [[ -n "$out" ]]; then
      echo "    ✅ getent: $out"
    else
      echo "    ❌ getent: no resolution for host.docker.internal"
    fi
  else
    echo "    ℹ️  getent not in image"
  fi
  echo ""
}

_check "listings-service" "5435" "listings DB"
_check "analytics-service" "5433" "records DB (log-search)"
_check "analytics-service" "5435" "listings DB (if used)"

echo "If nc/getent fail: ensure Postgres listen_addresses='*', pg_hba.conf allows 0.0.0.0/0, and Colima VM can reach host. See docs/CROSS_DB_CONNECTIVITY_AND_ROTATION_HARDENING.md."
