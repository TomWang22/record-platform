#!/usr/bin/env bash
# Load millions of rows into shopping DB (port 5436): cart, watchlist, recently_viewed, wishlist, purchase_history, search_history.
# Respects schema and UNIQUE constraints. Realistic item_type, query, metadata.
# Usage: TARGET_CART=300000 TARGET_SEARCH_HISTORY=1000000 ./scripts/load-shopping-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
#   STATEMENT_TIMEOUT=600 — per-statement timeout in seconds (default 10 min; keeps Colima/K3s within limits)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${SHOPPING_DB_HOST:-localhost}"
DB_PORT="${SHOPPING_DB_PORT:-5436}"
DB_USER="${SHOPPING_DB_USER:-postgres}"
DB_NAME="${SHOPPING_DB_NAME:-records}"
DB_PASS="${SHOPPING_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

TARGET_CART="${TARGET_CART:-300000}"
TARGET_WATCHLIST="${TARGET_WATCHLIST:-400000}"
TARGET_RECENTLY_VIEWED="${TARGET_RECENTLY_VIEWED:-500000}"
TARGET_WISHLIST="${TARGET_WISHLIST:-400000}"
TARGET_PURCHASE_HISTORY="${TARGET_PURCHASE_HISTORY:-800000}"
TARGET_SEARCH_HISTORY="${TARGET_SEARCH_HISTORY:-1000000}"
BATCH_SIZE="${BATCH_SIZE:-50000}"
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-600}"

echo "$(ts) === Load shopping DB (port $DB_PORT) ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

if ! psql -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'shopping' AND table_name = 'shopping_cart';" 2>/dev/null | grep -q 1; then
  echo "$(ts) shopping schema missing. Run shopping migrations first (e.g. infra/db/06-shopping-schema.sql)." >&2
  exit 1
fi

# shopping_cart
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.shopping_cart;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) shopping.shopping_cart: $CURRENT (target $TARGET_CART)"
while [[ "$CURRENT" -lt "$TARGET_CART" ]]; do
  NEED=$(( TARGET_CART - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO shopping.shopping_cart (user_id, listing_id, item_type, item_id, quantity, price, metadata)
SELECT gen_random_uuid(), gen_random_uuid(), (ARRAY['listing','record','custom'])[1 + (g.n % 3)], gen_random_uuid(), 1 + (g.n % 5), (random() * 100)::numeric(10,2), '{}'::jsonb
FROM generate_series(1, $THIS) AS g(n);" >/dev/null 2>/dev/null || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.shopping_cart;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   shopping_cart: $CURRENT"
done

# watchlist (UNIQUE user_id, item_type, item_id — random UUIDs make conflicts rare)
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.watchlist;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) shopping.watchlist: $CURRENT (target $TARGET_WATCHLIST)"
while [[ "$CURRENT" -lt "$TARGET_WATCHLIST" ]]; do
  NEED=$(( TARGET_WATCHLIST - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO shopping.watchlist (user_id, listing_id, item_type, item_id, notify_on, metadata)
SELECT gen_random_uuid(), gen_random_uuid(), (ARRAY['listing','record','auction'])[1 + (g.n % 3)], gen_random_uuid(), '{}', '{}'::jsonb
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (user_id, item_type, item_id) DO NOTHING;" >/dev/null 2>/dev/null || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.watchlist;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   watchlist: $CURRENT"
done

# recently_viewed
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.recently_viewed;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) shopping.recently_viewed: $CURRENT (target $TARGET_RECENTLY_VIEWED)"
while [[ "$CURRENT" -lt "$TARGET_RECENTLY_VIEWED" ]]; do
  NEED=$(( TARGET_RECENTLY_VIEWED - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO shopping.recently_viewed (user_id, item_type, item_id, metadata)
SELECT gen_random_uuid(), (ARRAY['listing','record','user','forum_post'])[1 + (g.n % 4)], gen_random_uuid(), '{}'::jsonb
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (user_id, item_type, item_id) DO NOTHING;" >/dev/null 2>/dev/null || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.recently_viewed;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   recently_viewed: $CURRENT"
done

# wishlist
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.wishlist;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) shopping.wishlist: $CURRENT (target $TARGET_WISHLIST)"
while [[ "$CURRENT" -lt "$TARGET_WISHLIST" ]]; do
  NEED=$(( TARGET_WISHLIST - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO shopping.wishlist (user_id, listing_id, item_type, item_id, priority, notes, metadata)
SELECT gen_random_uuid(), gen_random_uuid(), (ARRAY['listing','record','custom'])[1 + (g.n % 3)], gen_random_uuid(), (g.n % 10), 'Note ' || g.n, '{}'::jsonb
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (user_id, item_type, item_id) DO NOTHING;" >/dev/null 2>/dev/null || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.wishlist;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   wishlist: $CURRENT"
done

# purchase_history
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.purchase_history;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) shopping.purchase_history: $CURRENT (target $TARGET_PURCHASE_HISTORY)"
while [[ "$CURRENT" -lt "$TARGET_PURCHASE_HISTORY" ]]; do
  NEED=$(( TARGET_PURCHASE_HISTORY - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO shopping.purchase_history (user_id, order_id, listing_id, item_type, item_id, quantity, price_paid, currency, purchase_type, status, purchased_at, metadata)
SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), (ARRAY['listing','record','auction'])[1 + (g.n % 3)], gen_random_uuid(), 1, (random() * 200)::numeric(10,2), 'USD', (ARRAY['buy_now','auction_win','best_offer'])[1 + (g.n % 3)], 'completed', now() - (random() * interval '730 days'), '{}'::jsonb
FROM generate_series(1, $THIS) AS g(n);" >/dev/null 2>/dev/null || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.purchase_history;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   purchase_history: $CURRENT"
done

# search_history
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.search_history;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) shopping.search_history: $CURRENT (target $TARGET_SEARCH_HISTORY)"
while [[ "$CURRENT" -lt "$TARGET_SEARCH_HISTORY" ]]; do
  NEED=$(( TARGET_SEARCH_HISTORY - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO shopping.search_history (user_id, query, query_type, filters, result_count, searched_at)
SELECT gen_random_uuid(), 'query ' || (ARRAY['Beatles','vinyl','LP','rare','first pressing'])[1 + (g.n % 5)] || ' ' || substr(md5(g.n::text), 1, 6), (ARRAY['listing','record','user','forum'])[1 + (g.n % 4)], '{}'::jsonb, (random() * 500)::int, now() - (random() * interval '90 days')
FROM generate_series(1, $THIS) AS g(n);" >/dev/null 2>/dev/null || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM shopping.search_history;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   search_history: $CURRENT"
done

echo "$(ts) Done. Run run_shopping_pgbench_sweep.sh for benchmarking."
