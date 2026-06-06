#!/usr/bin/env bash
# Seed all DBs (5434–5437) with random data; duplication allowed (record-collecting nature).
# Records (5433): use scripts/load-records-csv-5433.sh with multiple chunks to reach 1M+.
# Target: 2.4M overall, 1M+ outside 5433, with a hot tenant (one user_id has many rows).
#
# Usage:
#   ./scripts/seed-all-dbs.sh
#   HOT_TENANT_UUID=0dc268d0-a86f-4e12-8d10-9db0f1b735e0 LISTINGS_ROWS=200000 ./scripts/seed-all-dbs.sh
#
# Requires: schemas applied (ensure-all-schemas-and-tuning.sh), Postgres on 5434–5437.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
# Hot tenant: gets a large share of rows so partial indexes and caching are effective
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
# Row targets (outside 5433) to reach 1M+ combined; tune as needed
LISTINGS_ROWS="${LISTINGS_ROWS:-50000}"
SOCIAL_POSTS_ROWS="${SOCIAL_POSTS_ROWS:-50000}"
SOCIAL_MESSAGES_ROWS="${SOCIAL_MESSAGES_ROWS:-30000}"
SHOPPING_WATCHLIST_ROWS="${SHOPPING_WATCHLIST_ROWS:-40000}"
SHOPPING_WISHLIST_ROWS="${SHOPPING_WISHLIST_ROWS:-40000}"
SHOPPING_SEARCH_HISTORY_ROWS="${SHOPPING_SEARCH_HISTORY_ROWS:-60000}"
SHOPPING_PURCHASE_ROWS="${SHOPPING_PURCHASE_ROWS:-20000}"
FEEDBACK_REVIEWS_ROWS="${FEEDBACK_REVIEWS_ROWS:-15000}"

# Pool of user UUIDs (hot tenant first, then others; ensure they exist in auth if you use auth later)
USER_POOL="'$HOT_TENANT_UUID'::uuid, 'a1b2c3d4-e5f6-4780-a123-456789abcdef'::uuid, 'b2c3d4e5-f6a7-4891-b234-567890abcdef'::uuid, 'c3d4e5f6-a7b8-4902-c345-678901abcdef'::uuid, 'd4e5f6a7-b8c9-4013-d456-789012abcdef'::uuid, 'e5f6a7b8-c9d0-4124-e567-890123abcdef'::uuid, 'f6a7b8c9-d0e1-4235-f678-901234abcdef'::uuid, 'a7b8c9d0-e1f2-4346-a789-012345abcdef'::uuid, 'b8c9d0e1-f2a3-4457-b890-123456abcdef'::uuid, 'c9d0e1f2-a3b4-4568-c901-234567abcdef'::uuid"

run_psql() {
  local port=$1 db=$2
  shift 2
  PGCONNECT_TIMEOUT=5 psql -h "$PGHOST" -p "$port" -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@" 2>/dev/null || return 1
}

ok()  { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# ---- 5435: listings (random; duplication of title/price ok) ----
seed_listings() {
  local port=5435 db=listings
  if ! run_psql "$port" postgres -tAc "SELECT 1" | grep -q 1; then warn "Port $port not reachable."; return; fi
  info "Seeding listings (5435) with $LISTINGS_ROWS rows (random, duplication allowed)..."
  run_psql "$port" "$db" <<SQL
INSERT INTO listings.listings (user_id, title, description, price, currency, listing_type, condition, category, location, shipping_cost, is_active, view_count, watch_count)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  'Record ' || (md5(random()::text))::varchar(8) || ' ' || (array['LP','CD','7"','12"','Cassette'])[1 + floor(random()*5)::int % 5],
  'Description ' || md5(random()::text),
  (random() * 200 + 5)::numeric(12,2),
  'USD',
  (array['fixed_price','fixed_price','fixed_price','auction','obo'])[1 + floor(random()*5)::int % 5],
  (array['New','Like New','Very Good','Good','Fair'])[1 + floor(random()*5)::int % 5],
  (array['Rock','Jazz','Electronic','Classical','Other'])[1 + floor(random()*5)::int % 5],
  (array['US','UK','JP','DE',''])[1 + floor(random()*5)::int % 5],
  (random() * 10)::numeric(10,2),
  true,
  floor(random() * 1000)::int,
  floor(random() * 100)::int
FROM generate_series(1, $LISTINGS_ROWS) s;
SQL
  run_psql "$port" "$db" -c "ANALYZE listings.listings;"
  ok "Listings: $(run_psql "$port" "$db" -tAc "SELECT count(*) FROM listings.listings;") rows"
}

# ---- 5434: social (forum posts, then direct messages) ----
seed_social() {
  local port=5434 db=social
  if ! run_psql "$port" postgres -tAc "SELECT 1" | grep -q 1; then warn "Port $port not reachable."; return; fi
  info "Seeding social (5434): $SOCIAL_POSTS_ROWS posts, $SOCIAL_MESSAGES_ROWS messages..."
  run_psql "$port" "$db" <<SQL
INSERT INTO forum.posts (user_id, title, content, flair, upload_type)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  'Post ' || (md5(random()::text))::varchar(12),
  'Content ' || md5(random()::text) || ' ' || md5((random()*1000)::text),
  (array['Discussion','Question','Showcase','Sale','Other'])[1 + floor(random()*5)::int % 5],
  'text'
FROM generate_series(1, $SOCIAL_POSTS_ROWS) s;
SQL
  # Direct messages: only if messages.messages exists (social schema may be partial on some envs)
  if run_psql "$port" "$db" -tAc "SELECT to_regclass('messages.messages')" | grep -q messages; then
    run_psql "$port" "$db" <<SQL
INSERT INTO messages.messages (sender_id, recipient_id, group_id, message_type, subject, content)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  NULL,
  'General',
  'Re: ' || (md5(random()::text))::varchar(10),
  'Message body ' || md5(random()::text)
FROM generate_series(1, $SOCIAL_MESSAGES_ROWS) s;
SQL
  else
    warn "messages.messages not found on 5434; skipping messages seed"
  fi
  run_psql "$port" "$db" -c "ANALYZE forum.posts;"
  msg_count=""
  if run_psql "$port" "$db" -tAc "SELECT to_regclass('messages.messages')" | grep -q messages; then
    run_psql "$port" "$db" -c "ANALYZE messages.messages;" 2>/dev/null || true
    msg_count=", $(run_psql "$port" "$db" -tAc "SELECT count(*) FROM messages.messages;") messages"
  fi
  ok "Social: $(run_psql "$port" "$db" -tAc "SELECT count(*) FROM forum.posts;") posts${msg_count}"
}

# ---- 5436: shopping (watchlist, wishlist, search_history, purchase_history, feedback.reviews) ----
seed_shopping() {
  local port=5436 db=shopping
  if ! run_psql "$port" postgres -tAc "SELECT 1" | grep -q 1; then warn "Port $port not reachable."; return; fi
  info "Seeding shopping (5436): watchlist, wishlist, search_history, purchase_history, feedback.reviews..."

  # Watchlist: item_type listing, item_id from listings (we don't have FK cross-DB; use random UUID or existing listing ids from 5435)
  run_psql "$port" "$db" <<SQL
INSERT INTO shopping.watchlist (user_id, listing_id, item_type, item_id, metadata)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  gen_random_uuid(),
  'listing',
  gen_random_uuid(),
  '{"artist":"Seed","name":"Record"}'::jsonb
FROM generate_series(1, $SHOPPING_WATCHLIST_ROWS) s
ON CONFLICT (user_id, item_type, item_id) DO NOTHING;
SQL
  run_psql "$port" "$db" <<SQL
INSERT INTO shopping.wishlist (user_id, listing_id, item_type, item_id, metadata)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  gen_random_uuid(),
  'listing',
  gen_random_uuid(),
  '{"artist":"Seed"}'::jsonb
FROM generate_series(1, $SHOPPING_WISHLIST_ROWS) s
ON CONFLICT (user_id, item_type, item_id) DO NOTHING;
SQL
  run_psql "$port" "$db" <<SQL
INSERT INTO shopping.search_history (user_id, query, query_type, result_count)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  (array['jazz','rock','vinyl','rare','LP','CD'])[1 + floor(random()*6)::int % 6] || ' ' || (md5(random()::text))::varchar(4),
  'listing',
  floor(random() * 500)::int
FROM generate_series(1, $SHOPPING_SEARCH_HISTORY_ROWS) s;
SQL
  run_psql "$port" "$db" <<SQL
INSERT INTO shopping.purchase_history (user_id, order_id, listing_id, item_type, item_id, quantity, price_paid, currency, purchase_type, status)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  gen_random_uuid(),
  gen_random_uuid(),
  'listing',
  gen_random_uuid(),
  1,
  (random() * 100 + 5)::numeric(10,2),
  'USD',
  'buy_now',
  'completed'
FROM generate_series(1, $SHOPPING_PURCHASE_ROWS) s;
SQL
  # Reviews: unique (reviewer_id, reviewee_id, transaction_id); allow random so some conflicts
  run_psql "$port" "$db" <<SQL
INSERT INTO feedback.reviews (reviewer_id, reviewee_id, role, transaction_id, rating, comment)
SELECT
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  (ARRAY[$USER_POOL])[1 + (floor(random() * 10)::int % 10)],
  (array['seller','buyer'])[1 + floor(random()*2)::int % 2],
  gen_random_uuid(),
  (1 + floor(random()*5)::int),
  'Seed review ' || md5(random()::text)
FROM generate_series(1, $FEEDBACK_REVIEWS_ROWS) s
ON CONFLICT (reviewer_id, reviewee_id, transaction_id) DO NOTHING;
SQL
  run_psql "$port" "$db" -c "ANALYZE shopping.watchlist; ANALYZE shopping.wishlist; ANALYZE shopping.search_history; ANALYZE shopping.purchase_history; ANALYZE feedback.reviews;"
  ok "Shopping: watchlist/wishlist/search/purchase/reviews seeded"
}

# ---- 5437: auth user_addresses (for existing users in pool) ----
seed_auth_addresses() {
  local port=5437 db=auth
  if ! run_psql "$port" postgres -tAc "SELECT 1" | grep -q 1; then warn "Port $port not reachable."; return; fi
  info "Seeding auth (5437): user_addresses for tax/shipping..."
  run_psql "$port" "$db" <<SQL
INSERT INTO auth.users (id, email) VALUES
  ('${HOT_TENANT_UUID}'::uuid, ('seed-hot-${HOT_TENANT_UUID}@local')::citext),
  ('a1b2c3d4-e5f6-4780-a123-456789abcdef'::uuid, 'seed1@local'),
  ('b2c3d4e5-f6a7-4891-b234-567890abcdef'::uuid, 'seed2@local'),
  ('c3d4e5f6-a7b8-4902-c345-678901abcdef'::uuid, 'seed3@local'),
  ('d4e5f6a7-b8c9-4013-d456-789012abcdef'::uuid, 'seed4@local'),
  ('e5f6a7b8-c9d0-4124-e567-890123abcdef'::uuid, 'seed5@local'),
  ('f6a7b8c9-d0e1-4235-f678-901234abcdef'::uuid, 'seed6@local'),
  ('a7b8c9d0-e1f2-4346-a789-012345abcdef'::uuid, 'seed7@local'),
  ('b8c9d0e1-f2a3-4457-b890-123456abcdef'::uuid, 'seed8@local'),
  ('c9d0e1f2-a3b4-4568-c901-234567abcdef'::uuid, 'seed9@local')
ON CONFLICT (id) DO NOTHING;
SQL
  run_psql "$port" "$db" <<SQL
INSERT INTO auth.user_addresses (user_id, label, country_code, region, postal_code, address_line1, city, is_default)
SELECT u.id, 'Home', (array['US','GB','JP','DE','FR'])[1 + (floor(random()*5)::int % 5)], 'Region', '12345', '123 Main St', 'City', true
FROM (SELECT unnest(ARRAY[$USER_POOL]) AS id) u;
SQL
  ok "Auth: user_addresses seeded for user pool"
}

# ---- Run in order (listings first so we could later reference real listing ids if desired) ----
seed_listings
seed_social
seed_shopping
seed_auth_addresses

echo ""
echo "---"
info "This script seeds ports 5434–5437 only (listings, social, shopping, auth)."
info "Records (5433) are not seeded here. To load records: ./scripts/load-records-csv-5433.sh [path/to/chunk.csv or records_chunks/]"
info "Hot tenant UUID (for tuning): $HOT_TENANT_UUID"
