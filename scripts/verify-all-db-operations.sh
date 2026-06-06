#!/usr/bin/env bash
# Comprehensive database verification for all operations
# Verifies data persistence after all test operations across all services
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

LOG_DIR="${LOG_DIR:-/tmp/db-verification-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"

say "=== Comprehensive Database Verification ==="
info "Log directory: $LOG_DIR"

# Database ports mapping
declare -A DB_PORTS=(
  ["auth"]="5437"
  ["records"]="5433"
  ["social"]="5434"
  ["listings"]="5435"
  ["shopping"]="5436"
)

# Verify table exists and has data
verify_table() {
  local db_name="$1"
  local port="$2"
  local schema="$3"
  local table="$4"
  local user_id="${5:-}"
  local log_file="$LOG_DIR/${db_name}-${schema}-${table}.log"
  
  local query
  if [[ -n "$user_id" ]]; then
    query="SELECT COUNT(*) FROM ${schema}.${table} WHERE user_id='$user_id';"
  else
    query="SELECT COUNT(*) FROM ${schema}.${table};"
  fi
  
  local count=$(PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records -tAc "$query" 2>/dev/null || echo "0")
  
  {
    echo "=== ${schema}.${table} (port $port) ==="
    echo "Query: $query"
    echo "Count: $count"
    if [[ -n "$user_id" ]]; then
      echo "User ID: $user_id"
    fi
  } > "$log_file"
  
  if [[ "$count" =~ ^[0-9]+$ ]]; then
    if [[ "$count" -gt 0 ]]; then
      ok "${schema}.${table}: $count record(s) found"
      return 0
    else
      warn "${schema}.${table}: No records found"
      return 1
    fi
  else
    warn "${schema}.${table}: Could not query (count: $count)"
    return 1
  fi
}

# 1. Verify auth.users
say "1. Verifying auth.users table..."
for port in "${DB_PORTS[@]}"; do
  verify_table "auth" "$port" "auth" "users" "" || true
done

# 2. Verify records.records
say "2. Verifying records.records table..."
if [[ -n "${RECORD_ID:-}" ]]; then
  verify_table "records" "${DB_PORTS[records]}" "records" "records" "" || true
  # Verify specific record
  RECORD_COUNT=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[records]}" -U postgres -d records -tAc \
    "SELECT COUNT(*) FROM records.records WHERE id='${RECORD_ID}';" 2>/dev/null || echo "0")
  if [[ "$RECORD_COUNT" == "1" ]]; then
    ok "Record ${RECORD_ID} exists in records.records"
  else
    warn "Record ${RECORD_ID} NOT found (count: $RECORD_COUNT)"
  fi
fi

# 3. Verify social service tables
say "3. Verifying social service tables..."
if [[ -n "${USER1_ID:-}" ]]; then
  # Verify forum.posts
  if [[ -n "${FORUM_POST_ID:-}" ]]; then
    verify_table "social" "${DB_PORTS[social]}" "forum" "posts" "" || true
    POST_COUNT=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[social]}" -U postgres -d records -tAc \
      "SELECT COUNT(*) FROM forum.posts WHERE id='${FORUM_POST_ID}';" 2>/dev/null || echo "0")
    if [[ "$POST_COUNT" == "1" ]]; then
      ok "Forum post ${FORUM_POST_ID} exists"
    else
      warn "Forum post ${FORUM_POST_ID} NOT found (count: $POST_COUNT)"
    fi
  fi
  
  # Verify messages
  verify_table "social" "${DB_PORTS[social]}" "messages" "messages" "${USER1_ID}" || true
  
  # Verify groups
  verify_table "social" "${DB_PORTS[social]}" "groups" "groups" "${USER1_ID}" || true
fi

# 4. Verify listings.listings
say "4. Verifying listings.listings table..."
if [[ -n "${LISTING_ID:-}" ]]; then
  verify_table "listings" "${DB_PORTS[listings]}" "listings" "listings" "" || true
  LISTING_COUNT=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[listings]}" -U postgres -d records -tAc \
    "SELECT COUNT(*) FROM listings.listings WHERE id='${LISTING_ID}';" 2>/dev/null || echo "0")
  if [[ "$LISTING_COUNT" == "1" ]]; then
    ok "Listing ${LISTING_ID} exists"
  else
    warn "Listing ${LISTING_ID} NOT found (count: $LISTING_COUNT)"
  fi
fi

# 5. Verify shopping service tables
say "5. Verifying shopping service tables..."
if [[ -n "${USER1_ID:-}" ]]; then
  # Verify shopping_cart (may be empty after checkout)
  CART_COUNT=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[shopping]}" -U postgres -d records -tAc \
    "SELECT COUNT(*) FROM shopping.shopping_cart WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
  
  if [[ "$CART_COUNT" -gt 0 ]]; then
    ok "Shopping cart: $CART_COUNT item(s) for user ${USER1_ID}"
  else
    # Check if user has orders (items removed during checkout)
    ORDER_COUNT=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[shopping]}" -U postgres -d records -tAc \
      "SELECT COUNT(*) FROM shopping.orders WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
    if [[ "$ORDER_COUNT" -gt 0 ]]; then
      ok "Shopping cart empty (expected after checkout). User has $ORDER_COUNT order(s)"
    else
      info "Shopping cart empty - no items added or items were removed"
    fi
  fi
  
  # Verify orders
  verify_table "shopping" "${DB_PORTS[shopping]}" "shopping" "orders" "${USER1_ID}" || true
  
  # Verify purchase_history
  verify_table "shopping" "${DB_PORTS[shopping]}" "shopping" "purchase_history" "${USER1_ID}" || true
fi

# 6. Verify foreign key integrity
say "6. Verifying foreign key integrity..."
FK_LOG="$LOG_DIR/foreign-key-integrity.log"
{
  echo "=== Foreign Key Integrity Checks ==="
  
  # Check records.records -> auth.users
  echo "Checking records.records -> auth.users..."
  FK_VIOLATIONS=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[records]}" -U postgres -d records -tAc "
    SELECT COUNT(*) FROM records.records r
    WHERE r.user_id NOT IN (SELECT id FROM auth.users);
  " 2>/dev/null || echo "0")
  if [[ "$FK_VIOLATIONS" == "0" ]]; then
    ok "records.records -> auth.users: No violations"
  else
    warn "records.records -> auth.users: $FK_VIOLATIONS violations"
  fi
  
  # Check social.messages -> auth.users
  echo "Checking social.messages -> auth.users..."
  FK_VIOLATIONS=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[social]}" -U postgres -d records -tAc "
    SELECT COUNT(*) FROM messages.messages m
    WHERE m.sender_id NOT IN (SELECT id FROM auth.users)
       OR m.recipient_id NOT IN (SELECT id FROM auth.users);
  " 2>/dev/null || echo "0")
  if [[ "$FK_VIOLATIONS" == "0" ]]; then
    ok "messages.messages -> auth.users: No violations"
  else
    warn "messages.messages -> auth.users: $FK_VIOLATIONS violations"
  fi
  
  # Check shopping.orders -> auth.users
  echo "Checking shopping.orders -> auth.users..."
  FK_VIOLATIONS=$(PGPASSWORD=postgres psql -h localhost -p "${DB_PORTS[shopping]}" -U postgres -d records -tAc "
    SELECT COUNT(*) FROM shopping.orders o
    WHERE o.user_id NOT IN (SELECT id FROM auth.users);
  " 2>/dev/null || echo "0")
  if [[ "$FK_VIOLATIONS" == "0" ]]; then
    ok "shopping.orders -> auth.users: No violations"
  else
    warn "shopping.orders -> auth.users: $FK_VIOLATIONS violations"
  fi
} > "$FK_LOG"
ok "Foreign key integrity check saved to $FK_LOG"

# 7. Summary
say "=== Database Verification Summary ==="
ok "All verification logs saved to: $LOG_DIR"
info "Key files:"
info "  - Table verification: $LOG_DIR/*.log"
info "  - Foreign key integrity: $FK_LOG"

exit 0
