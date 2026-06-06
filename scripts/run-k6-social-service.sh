#!/usr/bin/env bash
set -euo pipefail

# Run k6 tests for social-service with comprehensive coverage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
BASE_URL="${BASE_URL:-https://${HOST}:${PORT}}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== K6 Social Service Comprehensive Test ==="

# Check dependencies
if ! command -v k6 >/dev/null 2>&1; then
  fail "k6 is not installed. Install with: brew install k6"
fi

# Check if social-service is running
say "Checking social-service health..."
SOCIAL_HEALTH=$(curl -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
  --resolve "${HOST}:${PORT}:127.0.0.1" \
  -H "Host: ${HOST}" \
  "${BASE_URL}/api/forum/posts?page=1&limit=1" 2>&1 | tail -1 || echo "000")

if [[ "$SOCIAL_HEALTH" != "200" ]] && [[ "$SOCIAL_HEALTH" != "401" ]]; then
  warn "Social service health check returned HTTP $SOCIAL_HEALTH"
  warn "  → Service may not be ready, but continuing with tests..."
else
  ok "Social service is reachable"
fi

# Check Kafka connectivity
say "Checking Kafka/Zookeeper connectivity..."
if docker ps | grep -q "record-platform-kafka-1"; then
  if docker exec record-platform-kafka-1 kafka-broker-api-versions --bootstrap-server localhost:9092 >/dev/null 2>&1; then
    ok "Kafka is running"
  else
    warn "Kafka may not be ready"
  fi
else
  warn "Kafka container not found (tests will still run, but Kafka ingestion won't be verified)"
fi

# Create Kafka topics if they don't exist
say "Ensuring Kafka topics exist..."
for topic in "forum-posts" "forum-comments" "messages" "group-messages"; do
  if docker exec record-platform-kafka-1 kafka-topics --bootstrap-server localhost:9092 --list 2>/dev/null | grep -q "^${topic}$"; then
    ok "Topic '${topic}' exists"
  else
    say "Creating topic '${topic}'..."
    docker exec record-platform-kafka-1 kafka-topics \
      --bootstrap-server localhost:9092 \
      --create \
      --topic "${topic}" \
      --partitions 3 \
      --replication-factor 1 \
      --if-not-exists 2>/dev/null && ok "Topic '${topic}' created" || warn "Failed to create topic '${topic}'"
  fi
done

# Run k6 test
say "Running k6 comprehensive social-service test..."
say "Base URL: ${BASE_URL}"

cd "$PROJECT_ROOT"

# Run k6 with environment variables
export BASE_URL
export K6_BROWSER_ENABLED=false

# Run the test
k6 run \
  --out json=results/k6-social-service-$(date +%Y%m%d-%H%M%S).json \
  --summary-export=results/k6-social-service-summary-$(date +%Y%m%d-%H%M%S).json \
  "$SCRIPT_DIR/load/k6-social-service-comprehensive.js"

K6_EXIT=$?

if [[ $K6_EXIT -eq 0 ]]; then
  ok "K6 tests completed successfully"
else
  warn "K6 tests exited with code $K6_EXIT"
fi

# Verify Kafka ingestion (check recent messages in topics)
say "Verifying Kafka ingestion..."
sleep 2  # Give Kafka time to process

for topic in "forum-posts" "forum-comments" "messages" "group-messages"; do
  MESSAGE_COUNT=$(docker exec record-platform-kafka-1 kafka-console-consumer \
    --bootstrap-server localhost:9092 \
    --topic "${topic}" \
    --from-beginning \
    --max-messages 100 \
    --timeout-ms 5000 2>/dev/null | wc -l || echo "0")
  
  if [[ "$MESSAGE_COUNT" -gt "0" ]]; then
    ok "Topic '${topic}' has ${MESSAGE_COUNT} messages (Kafka ingestion working)"
  else
    warn "Topic '${topic}' has no messages (may be normal if tests just started)"
  fi
done

say "=== Test Complete ==="
exit $K6_EXIT

