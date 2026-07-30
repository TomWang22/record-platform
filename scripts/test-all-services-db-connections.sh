#!/usr/bin/env bash
# Test all 8 service database connections (ports 5433-5440)
# Verify all databases are externalized

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DB_TEST_LOG="/tmp/db-connection-test-${TIMESTAMP}.log"

exec > >(tee "$DB_TEST_LOG")
exec 2>&1

say "=== Testing All 8 Service Database Connections ==="
info "Log: $DB_TEST_LOG"

# Database configuration (ports 5433-5440)
declare -A DB_CONFIG=(
  ["5433"]="records:records:Main DB"
  ["5434"]="social:social:Social DB"
  ["5435"]="records:listings:Listings DB"
  ["5436"]="shopping:shopping:Shopping DB"
  ["5437"]="records:auth:Auth DB"
  ["5438"]="records:auction_monitor:Auction Monitor DB"
  ["5439"]="records:analytics:Analytics DB"
  ["5440"]="records:python_ai:Python AI DB"
)

# Test database connectivity
test_db_connection() {
  local port=$1
  local db_name=$2
  local schema=$3
  local description=$4
  
  info "Testing $description (port $port, db: $db_name, schema: $schema)..."
  
  # Test direct connection (use gtimeout on macOS if available, otherwise timeout)
  TIMEOUT_CMD="timeout"
  if command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_CMD="gtimeout"
  fi
  DB_TEST=$(PGPASSWORD=postgres $TIMEOUT_CMD 5 psql -h localhost -p "$port" -U postgres -d "$db_name" -tAc "SELECT 1;" 2>&1) || DB_RC=$?
  DB_RC=${DB_RC:-0}
  
  if echo "$DB_TEST" | grep -q "1"; then
    ok "$description: Direct connection OK (port $port)"
    
    # Test schema access
    SCHEMA_TEST=$(PGPASSWORD=postgres $TIMEOUT_CMD 5 psql -h localhost -p "$port" -U postgres -d "$db_name" -tAc "SELECT schema_name FROM information_schema.schemata WHERE schema_name='$schema';" 2>&1) || SCHEMA_RC=$?
    SCHEMA_RC=${SCHEMA_RC:-0}
    
    if echo "$SCHEMA_TEST" | grep -q "$schema"; then
      ok "$description: Schema '$schema' exists"
    else
      warn "$description: Schema '$schema' not found (may need to be created)"
    fi
    
    return 0
  else
    fail "$description: Connection failed (port $port)"
    info "  Error: ${DB_TEST:0:200}"
    return 1
  fi
}

# Test service pod database connections
test_service_db_connection() {
  local service=$1
  local env_var=$2
  local expected_port=$3
  local description=$4
  
  info "Testing $description pod database connection..."
  
  PODS=($(kubectl get pods -n record-platform -l app="$service" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))
  
  if [[ ${#PODS[@]} -eq 0 ]]; then
    warn "$description: No pods found"
    return 1
  fi
  
  POD="${PODS[0]}"
  ok "$description: Found pod $POD"
  
  # Check environment variable
  ENV_VALUE=$(kubectl exec -n record-platform "$POD" -- env 2>/dev/null | grep "^${env_var}=" | cut -d'=' -f2- || echo "")
  
  if [[ -z "$ENV_VALUE" ]]; then
    warn "$description: $env_var not set"
  else
    ok "$description: $env_var is set"
    info "  Value: ${ENV_VALUE:0:100}..."
    
    # Extract port from connection string
    EXTRACTED_PORT=$(echo "$ENV_VALUE" | grep -oE ":[0-9]+" | head -1 | tr -d ':' || echo "")
    if [[ -n "$EXTRACTED_PORT" ]]; then
      if [[ "$EXTRACTED_PORT" == "$expected_port" ]]; then
        ok "$description: Port matches expected ($expected_port)"
      else
        warn "$description: Port mismatch - expected $expected_port, got $EXTRACTED_PORT"
      fi
    fi
    
    # Test connection from pod (services use their own DB clients, not psql)
    # Instead, check if the service can connect via health check or logs
    DB_TEST=$(kubectl exec -n record-platform "$POD" -- sh -c \
      "node -e \"const {Pool}=require('pg');const p=new Pool({connectionString:process.env.${env_var}});p.query('SELECT 1').then(()=>{console.log('OK');process.exit(0)}).catch(e=>{console.error('FAILED:',e.message);process.exit(1)});\" 2>&1" 2>/dev/null || echo "FAILED")
    
    if echo "$DB_TEST" | grep -q "1"; then
      ok "$description: Pod can connect to database"
    else
      fail "$description: Pod cannot connect to database"
      info "  Error: ${DB_TEST:0:200}"
    fi
  fi
}

# Main test sequence
say "=== Step 1: Testing Direct Database Connections (Externalized) ==="
FAILED_DBS=0
TOTAL_DBS=0

for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
  if [[ -n "${DB_CONFIG[$port]:-}" ]]; then
    IFS=':' read -r db_name schema description <<< "${DB_CONFIG[$port]}"
    TOTAL_DBS=$((TOTAL_DBS + 1))
    if ! test_db_connection "$port" "$db_name" "$schema" "$description"; then
      FAILED_DBS=$((FAILED_DBS + 1))
    fi
  fi
done

say "=== Step 2: Testing Service Pod Database Connections ==="

# Test each service
test_service_db_connection "auth-service" "POSTGRES_URL_AUTH" "5437" "Auth Service"
test_service_db_connection "records-service" "POSTGRES_URL" "5433" "Records Service"
test_service_db_connection "messaging-service" "POSTGRES_URL_SOCIAL" "5434" "Messaging Service"
test_service_db_connection "listings-service" "POSTGRES_URL_LISTINGS" "5435" "Listings Service"
test_service_db_connection "shopping-service" "POSTGRES_URL_SHOPPING" "5436" "Shopping Service"
test_service_db_connection "auction-monitor" "POSTGRES_URL_AUCTION_MONITOR" "5438" "Auction Monitor"
test_service_db_connection "analytics-service" "POSTGRES_URL_ANALYTICS" "5439" "Analytics Service"
test_service_db_connection "python-ai-service" "POSTGRES_URL_PYTHON_AI" "5440" "Python AI Service"

say "=== Step 3: Verifying Database Externalization ==="

# Check if databases are running in Docker Compose (externalized)
DOCKER_COMPOSE_DBS=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E "postgres|postgres-" || echo "")

if [[ -n "$DOCKER_COMPOSE_DBS" ]]; then
  ok "Databases found in Docker Compose (externalized):"
  echo "$DOCKER_COMPOSE_DBS" | while read -r db; do
    info "  - $db"
  done
else
  warn "No databases found in Docker Compose - may not be externalized"
fi

# Check Kubernetes services for external databases
say "=== Step 4: Checking Kubernetes External Database Services ==="

for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
  if [[ -n "${DB_CONFIG[$port]:-}" ]]; then
    IFS=':' read -r db_name schema description <<< "${DB_CONFIG[$port]}"
    
    # Look for service with this port
    SVC=$(kubectl get svc -n record-platform -o json 2>/dev/null | \
      jq -r ".items[] | select(.spec.ports[]?.port == $port) | .metadata.name" 2>/dev/null || echo "")
    
    if [[ -n "$SVC" ]]; then
      ok "$description: Kubernetes service '$SVC' found (port $port)"
      
      # Check if it points to external endpoint
      ENDPOINTS=$(kubectl get endpoints -n record-platform "$SVC" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || echo "")
      if [[ -n "$ENDPOINTS" ]]; then
        info "  Endpoint: $ENDPOINTS"
        if echo "$ENDPOINTS" | grep -qE "192\.168\.|host\.docker\.internal"; then
          ok "$description: Points to external database (externalized)"
        else
          warn "$description: May not be externalized (endpoint: $ENDPOINTS)"
        fi
      fi
    else
      warn "$description: No Kubernetes service found for port $port"
    fi
  fi
done

say "=== Summary ==="
if [[ $FAILED_DBS -eq 0 ]]; then
  ok "All $TOTAL_DBS databases are accessible"
else
  warn "$FAILED_DBS out of $TOTAL_DBS databases failed connection tests"
fi

ok "Full test log: $DB_TEST_LOG"
info "Review the log for detailed connection diagnostics"
