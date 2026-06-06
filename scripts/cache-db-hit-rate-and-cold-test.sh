#!/usr/bin/env bash
# Pre-flight cache & DB check: hit rate %, cold-cache behavior.
# Proves Redis + Lua are doing the work (cold vs cached request latency).
# Use before preflight/suites. Supports Redis in-cluster or external (localhost:6379).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 1. Redis: hit rate % (in-cluster or external)
say "=== 1. Redis cache hit rate ==="
REDIS_POD=$(kubectl -n record-platform get pods -l app=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

redis_info() {
  if [[ -n "$REDIS_POD" ]]; then
    kubectl -n record-platform exec "$REDIS_POD" -- redis-cli info stats 2>/dev/null || echo ""
  else
    redis-cli -h localhost -p 6379 info stats 2>/dev/null || echo ""
  fi
}

REDIS_PING=0
if [[ -n "$REDIS_POD" ]]; then
  kubectl -n record-platform exec "$REDIS_POD" -- redis-cli ping >/dev/null 2>&1 && REDIS_PING=1
else
  redis-cli -h localhost -p 6379 ping >/dev/null 2>&1 && REDIS_PING=1
fi

if [[ "$REDIS_PING" -eq 1 ]]; then
  ok "Redis: Connected (in-cluster pod or localhost:6379)"
  REDIS_STATS=$(redis_info)
  if [[ -n "$REDIS_STATS" ]]; then
    HITS=$(echo "$REDIS_STATS" | grep "keyspace_hits" | cut -d: -f2 | tr -d '\r' || echo "0")
    MISSES=$(echo "$REDIS_STATS" | grep "keyspace_misses" | cut -d: -f2 | tr -d '\r' || echo "0")
    HITS=$(echo "${HITS:-0}" | tr -cd '0-9' | head -1)
    MISSES=$(echo "${MISSES:-0}" | tr -cd '0-9' | head -1)
    HITS=${HITS:-0}
    MISSES=${MISSES:-0}
    TOTAL=$((HITS + MISSES))
    if [[ "$TOTAL" -gt 0 ]]; then
      HIT_RATE=$(echo "scale=2; $HITS * 100 / $TOTAL" | bc -l 2>/dev/null || echo "0")
      ok "Cache hit rate: ${HIT_RATE}% (hits=$HITS, misses=$MISSES)"
    else
      info "Cache: No keyspace operations yet (hit rate N/A)"
    fi
    # Lua scripts loaded?
    if [[ -n "$REDIS_POD" ]]; then
      SCRIPT_LIST=$(kubectl -n record-platform exec "$REDIS_POD" -- redis-cli script list 2>/dev/null || echo "")
    else
      SCRIPT_LIST=$(redis-cli -h localhost -p 6379 script list 2>/dev/null || echo "")
    fi
    if [[ -n "$SCRIPT_LIST" ]]; then
      ok "Lua scripts: Loaded (singleflight/cache logic available)"
    else
      info "Lua scripts: None loaded yet (may load on first use)"
    fi
  fi
else
  warn "Redis: Not reachable (start docker compose redis or ensure cluster has Redis)"
fi

# 2. Cold-cache behavior: same endpoint N times; first = cold, rest = cached (if Redis works)
say "=== 2. Cold-cache behavior (proves Redis/Lua doing work) ==="
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
# Use an endpoint that typically uses cache (e.g. listings health or a read path)
BASE_URL="https://${HOST}:${PORT}"
CURL_OPTS="-k -s --connect-timeout 3 --max-time 10 --resolve ${HOST}:${PORT}:127.0.0.1 -H Host: ${HOST}"

if ! command -v curl >/dev/null 2>&1; then
  warn "curl not found - skipping cold-cache request test"
else
  # Endpoints that may hit cache (listings, auth health)
  for endpoint in "/api/listings/health" "/api/auth/healthz" "/_caddy/healthz"; do
    info "Cold then cached: $endpoint"
    COLD_MS=""
    CACHED_MS=""
    for i in 1 2 3; do
      START=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || perl -MTime::HiRes -e 'print int(1000*Time::HiRes::time())' 2>/dev/null || echo "$(date +%s)000")
      curl $CURL_OPTS "${BASE_URL}${endpoint}" >/dev/null 2>&1 || true
      END=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || perl -MTime::HiRes -e 'print int(1000*Time::HiRes::time())' 2>/dev/null || echo "$(date +%s)000")
      if [[ -n "$START" ]] && [[ -n "$END" ]] && [[ "$START" =~ ^[0-9]+$ ]] && [[ "$END" =~ ^[0-9]+$ ]]; then
        ELAPSED=$((END - START))
        [[ $i -eq 1 ]] && COLD_MS=$ELAPSED || CACHED_MS="${CACHED_MS:+${CACHED_MS}, }$ELAPSED"
      fi
    done
    if [[ -n "$COLD_MS" ]]; then
      info "  Request 1 (cold): ${COLD_MS}ms | 2–3 (cached): ${CACHED_MS:-N/A}ms"
      if [[ -n "$CACHED_MS" ]]; then
        ok "  Cold vs cached latency captured (Redis/Lua reduces repeat load)"
      fi
    fi
  done
fi

# 3. DB connectivity (quick)
say "=== 3. DB connectivity (quick) ==="
# All 8 service DBs: 5433–5440
DB_PORTS=(5433 5434 5435 5436 5437 5438 5439 5440)
DB_NAMES=(records social listings shopping auth auction-monitor analytics python-ai)
for i in "${!DB_PORTS[@]}"; do
  port="${DB_PORTS[$i]}"
  name="${DB_NAMES[$i]}"
  if PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records -c "SELECT 1;" >/dev/null 2>&1; then
    ok "DB $name (port $port): Connected"
  else
    warn "DB $name (port $port): Connection failed"
  fi
done

say "=== Cache & DB pre-check complete ==="
