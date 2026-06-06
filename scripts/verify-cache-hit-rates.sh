#!/usr/bin/env bash
# Verify cache hit rates for all services
# Checks Redis cache statistics and service-level cache performance
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

NS="record-platform"
LOG_DIR="${LOG_DIR:-/tmp/cache-verification-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

say "=== Cache Hit Rate Verification ==="
info "Log directory: $LOG_DIR"

# 1. Check Redis connectivity and stats
say "1. Checking Redis connectivity and statistics..."
REDIS_LOG="$LOG_DIR/redis-stats.log"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

# Try to find Redis pod or use external Redis
REDIS_POD=$(_kb -n "$NS" get pods -l app=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$REDIS_POD" ]]; then
  info "Found Redis pod: $REDIS_POD"
  _kb -n "$NS" exec "$REDIS_POD" -- redis-cli INFO stats > "$REDIS_LOG" 2>&1 || warn "Could not get Redis stats from pod"
  _kb -n "$NS" exec "$REDIS_POD" -- redis-cli INFO memory >> "$REDIS_LOG" 2>&1 || true
else
  info "No Redis pod found (externalized) - checking external Redis..."
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -u "$REDIS_URL" INFO stats > "$REDIS_LOG" 2>&1 || warn "Could not connect to external Redis"
    redis-cli -u "$REDIS_URL" INFO memory >> "$REDIS_LOG" 2>&1 || true
  else
    warn "redis-cli not available and no Redis pod found"
  fi
fi

# Extract cache hit rate from Redis stats
if [[ -f "$REDIS_LOG" ]]; then
  KEYS_HITS=$(grep "^keyspace_hits:" "$REDIS_LOG" | cut -d: -f2 | tr -d '\r' || echo "0")
  KEYS_MISSES=$(grep "^keyspace_misses:" "$REDIS_LOG" | cut -d: -f2 | tr -d '\r' || echo "0")
  
  if [[ "$KEYS_HITS" =~ ^[0-9]+$ ]] && [[ "$KEYS_MISSES" =~ ^[0-9]+$ ]]; then
    TOTAL=$((KEYS_HITS + KEYS_MISSES))
    if [[ $TOTAL -gt 0 ]]; then
      HIT_RATE=$(echo "scale=2; $KEYS_HITS * 100 / $TOTAL" | bc -l 2>/dev/null || echo "0")
      ok "Redis cache hit rate: ${HIT_RATE}% (hits: $KEYS_HITS, misses: $KEYS_MISSES, total: $TOTAL)"
      
      if (( $(echo "$HIT_RATE < 80" | bc -l 2>/dev/null || echo "1") )); then
        warn "Cache hit rate is below 80% - consider optimizing cache strategy"
      fi
    else
      info "No cache operations yet (hits + misses = 0)"
    fi
  fi
fi

# 2. Check service-level cache performance
say "2. Checking service-level cache performance..."

# Test cache by making multiple requests to the same endpoint
test_cache_performance() {
  local service_name="$1"
  local endpoint="$2"
  local token="${3:-}"
  local test_log="$LOG_DIR/cache-test-$service_name.log"
  
  info "Testing cache for $service_name..."
  
  local times=()
  for i in {1..5}; do
    local start=$(date +%s%N)
    if [[ -n "$token" ]]; then
      curl -sS -w "\nHTTP_CODE:%{http_code}\n" --http2 --max-time 5 \
        --resolve "${HOST:-record.local}:${PORT:-30443}:127.0.0.1" \
        -H "Host: ${HOST:-record.local}" \
        -H "Authorization: Bearer $token" \
        "https://${HOST:-record.local}:${PORT:-30443}$endpoint" >/dev/null 2>&1 || echo "FAILED"
    else
      curl -sS -w "\nHTTP_CODE:%{http_code}\n" --http2 --max-time 5 \
        --resolve "${HOST:-record.local}:${PORT:-30443}:127.0.0.1" \
        -H "Host: ${HOST:-record.local}" \
        "https://${HOST:-record.local}:${PORT:-30443}$endpoint" >/dev/null 2>&1 || echo "FAILED"
    fi
    local end=$(date +%s%N)
    local duration=$(( (end - start) / 1000000 ))
    times+=("$duration")
    echo "Request $i: ${duration}ms" >> "$test_log"
    sleep 0.2
  done
  
  # Calculate average and check for cache effect (later requests should be faster)
  local first_avg=$(echo "${times[0]}" | awk '{print $1}')
  local last_avg=$(echo "${times[4]}" | awk '{print $1}')
  
  if [[ ${#times[@]} -ge 2 ]]; then
    local improvement=$(echo "scale=1; (${times[0]} - ${times[4]}) * 100 / ${times[0]}" | bc -l 2>/dev/null || echo "0")
    if (( $(echo "$improvement > 10" | bc -l 2>/dev/null || echo "0") )); then
      ok "$service_name: Cache appears effective (${improvement}% improvement from first to last request)"
    else
      info "$service_name: Cache may not be effective (${improvement}% improvement)"
    fi
  fi
}

# Test cache for different services
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"

# Get a token for authenticated endpoints
REGISTER_RESPONSE=$(curl -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "${HOST}:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://${HOST}:${PORT}/api/auth/register" \
  -d "{\"email\":\"cache-test-$(date +%s)@example.com\",\"password\":\"test123\"}" 2>&1 || echo "")
TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")

if [[ -n "$TOKEN" ]]; then
  # Test authenticated endpoints with cache
  test_cache_performance "records" "/api/records/healthz" "$TOKEN"
  test_cache_performance "listings" "/api/listings/healthz" "$TOKEN"
  test_cache_performance "social" "/api/social/healthz" "$TOKEN"
else
  warn "Could not get token for authenticated cache tests"
fi

# 3. Check database cache hit rates (PostgreSQL)
say "3. Checking database cache hit rates..."
DB_LOG="$LOG_DIR/db-cache-stats.log"

# Check each database
for port in 5433 5434 5435 5436 5437; do
  info "Checking database on port $port..."
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records -tAc "
    SELECT 
      'Database: ' || current_database() || ' (port $port)' as info,
      ROUND(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit) + sum(blks_read), 0), 2) as cache_hit_ratio
    FROM pg_stat_database
    WHERE datname = current_database();
  " >> "$DB_LOG" 2>&1 || warn "Could not check database on port $port"
done

if [[ -f "$DB_LOG" ]] && [[ -s "$DB_LOG" ]]; then
  ok "Database cache statistics saved to $DB_LOG"
  cat "$DB_LOG"
fi

# 4. Summary
say "=== Cache Verification Summary ==="
ok "All cache verification logs saved to: $LOG_DIR"
info "Files:"
info "  - Redis stats: $REDIS_LOG"
info "  - Service cache tests: $LOG_DIR/cache-test-*.log"
info "  - Database cache stats: $DB_LOG"

exit 0
