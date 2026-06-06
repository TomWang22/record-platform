#!/usr/bin/env bash
# Seed all 8 external Postgres instances (5433–5440) with 1–2 million rows per main schema.
# Port/DB mapping per README and infra/docs/EIGHT-DATABASES-ARCHITECTURE.md:
#   5433 postgres-1/records, 5434 social/records, 5435 listings/records, 5436 shopping/shopping,
#   5437 auth/auth, 5438 auction-monitor/postgres, 5439 analytics/analytics, 5440 python-ai/python_ai
# Auth (5437) is the enforced source of truth for users. Analytics (5439) and Python AI (5440) are
# seeded so they go hand-in-hand (dual-write pipeline: analytics → python AI inference).
#
# Usage: ./scripts/seed-all-eight-databases.sh
#   ROWS_PER_SCHEMA=1500000  default 1.5M per main table (range 1–2M)
#   REALISTIC=1  randomized varying-length strings (forum post length, message length, all text columns) for max realism
#   SKIP_5433=1  skip port 5433 (records)
#   DRY_RUN=1    print SQL only, do not run
#   RUN_BACKGROUND=1  run seeding in background (nohup); log to bench_logs/seed-all-eight-*.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROWS="${ROWS_PER_SCHEMA:-1500000}"   # 1.5M default (1–2M range)
REALISTIC="${REALISTIC:-0}"
DRY_RUN="${DRY_RUN:-0}"
RUN_BACKGROUND="${RUN_BACKGROUND:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

_psql() { psql -h "$PGHOST" -p "$1" -U "$PGUSER" -d "$2" -v ON_ERROR_STOP=1 "$@" 2>/dev/null; }

# ----- 5433 records (postgres-1): auth.users + records.records -----
seed_5433() {
  local port=5433 db=records
  say "Seeding $port/$db (records): auth.users + records.records ($ROWS rows each)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5433"; return 0; fi
  # Deterministic UUIDs so we can reference users from records
  _psql "$port" "$db" -c "
    INSERT INTO auth.users (id, email, password_hash, created_at)
    SELECT md5('seed-user-'||i)::uuid, 'user'||i||'@seed.local', 'hash', now()
    FROM generate_series(1, $ROWS) i
    ON CONFLICT (email) DO NOTHING;
  " && ok "5433 auth.users done" || warn "5433 auth.users had errors"
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO records.records (user_id, artist, name, format, catalog_number, notes, created_at, updated_at)
      SELECT md5('seed-user-'||(1 + (i-1) % $ROWS))::uuid,
        substring(md5(random()::text) from 1 for (10 + (random()*90)::int)),
        substring(md5((i::text||random()::text)) from 1 for (15 + (random()*85)::int)),
        (array['LP','EP','12in','7in','CD'])[1 + (i%5)],
        'CAT-'||(i%10000),
        CASE WHEN random() > 0.7 THEN repeat('Note ', (5 + (random()*20)::int)) ELSE NULL END,
        now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " && ok "5433 records.records done (realistic)" || warn "5433 records.records had errors"
  else
    _psql "$port" "$db" -c "
      INSERT INTO records.records (user_id, artist, name, format, created_at, updated_at)
      SELECT md5('seed-user-'||(1 + (i-1) % $ROWS))::uuid, 'Artist '||(i%1000), 'Record '||i, 'LP', now(), now()
      FROM generate_series(1, $ROWS) i;
    " && ok "5433 records.records done" || warn "5433 records.records had errors"
  fi
}

# ----- 5434 social (records): forum.posts + messages.messages -----
seed_5434() {
  local port=5434 db=records
  say "Seeding $port/$db (social): forum.posts + messages.messages ($ROWS rows each)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5434"; return 0; fi
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO forum.posts (id, user_id, title, content, flair, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid,
        substring(md5(random()::text)||' '||repeat('ab ', 50) from 1 for (20 + (random()*180)::int)),
        repeat(md5(i::text), (50 + (random()*1950)::int) / 32 + 1),
        (array['general','Discussion','Question','Showcase','Vintage'])[1 + (i%5)],
        now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5434 forum.posts done (varying length)" || info "5434 forum.posts (table may not exist or conflict)"
    _psql "$port" "$db" -c "
      INSERT INTO messages.messages (id, sender_id, recipient_id, subject, content, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('s'||i)::text)::uuid, md5(('r'||i)::text)::uuid,
        substring(md5(random()::text) from 1 for (15 + (random()*185)::int)),
        repeat(md5((i||random())::text), (20 + (random()*980)::int) / 32 + 1),
        now() - (i || ' hours')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5434 messages.messages done (varying length)" || info "5434 messages (table may not exist)"
  else
    _psql "$port" "$db" -c "
      INSERT INTO forum.posts (id, user_id, title, content, flair, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, 'Title '||i, 'Content '||i, 'general', now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5434 forum.posts done" || info "5434 forum.posts (table may not exist or conflict)"
    _psql "$port" "$db" -c "
      INSERT INTO messages.messages (id, sender_id, recipient_id, subject, content, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('s'||i)::text)::uuid, md5(('r'||i)::text)::uuid, 'Subj '||i, 'Message '||i, now() - (i || ' hours')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5434 messages.messages done" || info "5434 messages (table may not exist)"
  fi
}

# ----- 5435 listings (records): listings.listings + listings.search_history -----
seed_5435() {
  local port=5435 db=records
  say "Seeding $port/$db (listings): listings.listings + search_history ($ROWS rows)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5435"; return 0; fi
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO listings.listings (id, user_id, title, description, price, currency, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid,
        substring(md5(random()::text)||repeat(' ab', 30) from 1 for (30 + (random()*170)::int)),
        repeat(md5(i::text), (100 + (random()*900)::int) / 32 + 1),
        10 + (i%100), (array['USD','EUR','GBP'])[1 + (i%3)], now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5435 listings.listings done (varying length)" || info "5435 listings (may exist)"
    _psql "$port" "$db" -c "
      INSERT INTO listings.search_history (user_id, source, q, results, created_at)
      SELECT md5(('u'||i)::text)::uuid, (array['web','api','mobile'])[1 + (i%3)], substring(md5(random()::text) from 1 for (10 + (random()*90)::int)), i%100, now() - (i || ' hours')::interval
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5435 listings.search_history done (varying q)" || true
  else
    _psql "$port" "$db" -c "
      INSERT INTO listings.listings (id, user_id, title, description, price, currency, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, 'Listing '||i, 'Desc '||i, 10 + (i%100), 'USD', now(), now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5435 listings.listings done" || info "5435 listings (may exist)"
    _psql "$port" "$db" -c "
      INSERT INTO listings.search_history (user_id, source, q, results, created_at)
      SELECT md5(('u'||i)::text)::uuid, 'web', 'query '||i, i%100, now() - (i || ' hours')::interval
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5435 listings.search_history done" || true
  fi
}

# ----- 5436 shopping (shopping DB): shopping.orders + shopping.shopping_cart -----
seed_5436() {
  local port=5436 db=shopping
  say "Seeding $port/$db (shopping): shopping.orders + shopping_cart ($ROWS rows)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5436"; return 0; fi
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO shopping.orders (id, user_id, order_number, total, status, payment_status, subtotal, shipping_cost, tax, currency, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, 'ORD-'||to_char(now(),'YYYY')||'-'||lpad(i::text, 6, '0'), 50 + (i%500), (array['completed','pending','shipped'])[1 + (i%3)], 'paid', 50 + (i%500), (random()*10)::numeric(10,2), (random()*5)::numeric(10,2), 'USD', now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i
      ON CONFLICT (order_number) DO NOTHING;
    " 2>/dev/null && ok "5436 shopping.orders done (realistic)" || info "5436 shopping.orders (may need sequence/table)"
    _psql "$port" "$db" -c "
      INSERT INTO shopping.shopping_cart (id, user_id, item_type, item_id, quantity, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, (array['record','cd','merch'])[1 + (i%3)], md5(('item'||i)::text)::uuid, 1 + (i%5), now() - (i || ' hours')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5436 shopping.shopping_cart done (realistic)" || true
  else
    _psql "$port" "$db" -c "
      INSERT INTO shopping.orders (id, user_id, order_number, total, status, payment_status, subtotal, shipping_cost, tax, currency, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, 'ORD-'||to_char(now(),'YYYY')||'-'||lpad(i::text, 6, '0'), 50 + (i%500), 'completed', 'paid', 50 + (i%500), 0, 0, 'USD', now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i
      ON CONFLICT (order_number) DO NOTHING;
    " 2>/dev/null && ok "5436 shopping.orders done" || info "5436 shopping.orders (may need sequence/table)"
    _psql "$port" "$db" -c "
      INSERT INTO shopping.shopping_cart (id, user_id, item_type, item_id, quantity, created_at, updated_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, 'record', md5(('item'||i)::text)::uuid, 1, now(), now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5436 shopping.shopping_cart done" || true
  fi
}

# ----- 5437 auth (auth DB): auth.users — enforced source of truth -----
seed_5437() {
  local port=5437 db=auth
  say "Seeding $port/$db (auth, enforced): auth.users ($ROWS rows)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5437"; return 0; fi
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO auth.users (id, email, password_hash, created_at)
      SELECT md5('auth-user-'||i)::uuid, 'user'||i||'-'||substring(md5(random()::text) from 1 for 12)||'@'||(array['seed.local','example.com','test.org'])[1 + (i%3)], 'hash'||md5(i::text), now() - (i || ' days')::interval
      FROM generate_series(1, $ROWS) i
      ON CONFLICT (email) DO NOTHING;
    " && ok "5437 auth.users done (realistic)" || warn "5437 auth.users had errors (conflicts expected if run twice)"
  else
    _psql "$port" "$db" -c "
      INSERT INTO auth.users (id, email, password_hash, created_at)
      SELECT md5('auth-user-'||i)::uuid, 'auth'||i||'@seed.local', 'hash', now()
      FROM generate_series(1, $ROWS) i
      ON CONFLICT (email) DO NOTHING;
    " && ok "5437 auth.users done (enforced)" || warn "5437 auth.users had errors"
  fi
}

# ----- 5438 auction-monitor (postgres DB): auction_monitor.auction_results -----
seed_5438() {
  local port=5438 db=postgres
  say "Seeding $port/$db (auction-monitor): auction_monitor.auction_results ($ROWS rows)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5438"; return 0; fi
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO auction_monitor.auction_results (id, source, external_id, title, artist, price, currency, total_cost, sold_at, created_at)
      SELECT gen_random_uuid(), (array['ebay','discogs','shop'])[1 + (i%3)], 'ext-'||md5(i::text), substring(md5(random()::text)||repeat(' x', 40) from 1 for (25 + (random()*175)::int)), substring(md5((i%100)::text) from 1 for (15 + (random()*85)::int)), 20 + (i%200), 'USD', 25 + (i%200), now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5438 auction_monitor.auction_results done (varying length)" || info "5438 auction_monitor (table may differ)"
  else
    _psql "$port" "$db" -c "
      INSERT INTO auction_monitor.auction_results (id, source, external_id, title, artist, price, currency, total_cost, sold_at, created_at)
      SELECT gen_random_uuid(), 'ebay', 'ext-'||i, 'Title '||i, 'Artist '||(i%100), 20 + (i%200), 'USD', 25 + (i%200), now() - (i || ' days')::interval, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5438 auction_monitor.auction_results done" || info "5438 auction_monitor (table may differ)"
  fi
}

# ----- 5439 analytics: analytics.price_snapshots + user_behavior (feeds python AI) -----
seed_5439() {
  local port=5439 db=analytics
  say "Seeding $port/$db (analytics): price_snapshots + user_behavior ($ROWS rows)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5439"; return 0; fi
  _psql "$port" "$db" -c "
    INSERT INTO analytics.price_snapshots (id, record_id, source, price, currency, snapshot_date, created_at)
    SELECT gen_random_uuid(), md5(('r'||i)::text)::uuid, 'discogs', 15 + (i%100), 'USD', current_date - (i%365), now()
    FROM generate_series(1, $ROWS) i;
  " 2>/dev/null && ok "5439 analytics.price_snapshots done" || info "5439 price_snapshots (may exist)"
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO analytics.user_behavior (id, user_id, event_type, entity_type, entity_id, event_timestamp)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, (array['view','click','add_cart','purchase'])[1 + (i%4)], (array['record','listing','order'])[1 + (i%3)], md5(('r'||i)::text)::uuid, now() - (i || ' minutes')::interval
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5439 analytics.user_behavior done (realistic)" || true
  else
    _psql "$port" "$db" -c "
      INSERT INTO analytics.user_behavior (id, user_id, event_type, entity_type, entity_id, event_timestamp)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, 'view', 'record', md5(('r'||i)::text)::uuid, now() - (i || ' minutes')::interval
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5439 analytics.user_behavior done" || true
  fi
}

# ----- 5440 python_ai: ai.price_predictions + inference_log (dual-write with analytics) -----
seed_5440() {
  local port=5440 db=python_ai
  say "Seeding $port/$db (python_ai): ai model_metadata + price_predictions + inference_log ($ROWS rows)..."
  if [[ "$DRY_RUN" == "1" ]]; then echo "[DRY RUN] would seed 5440"; return 0; fi
  # One model_metadata row for FK
  _psql "$port" "$db" -c "
    INSERT INTO ai.model_metadata (id, model_name, model_version, model_type, is_active, created_at, updated_at)
    VALUES (md5('model-seed-1')::uuid, 'price_model', '1.0', 'price_prediction', true, now(), now())
    ON CONFLICT (model_name, model_version) DO NOTHING;
  " 2>/dev/null || true
  _psql "$port" "$db" -c "
    INSERT INTO ai.price_predictions (id, record_id, model_id, predicted_price, confidence_score, prediction_date, created_at)
    SELECT gen_random_uuid(), md5(('r'||i)::text)::uuid, (SELECT id FROM ai.model_metadata LIMIT 1), 20 + (i%80), 0.9, now(), now()
    FROM generate_series(1, $ROWS) i;
  " 2>/dev/null && ok "5440 ai.price_predictions done" || info "5440 price_predictions (may need model_metadata)"
  if [[ "$REALISTIC" == "1" ]]; then
    _psql "$port" "$db" -c "
      INSERT INTO ai.inference_log (id, user_id, query, inference_type, input_data, output_data, processing_time_ms, analytics_data_used, created_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, substring(md5(random()::text) from 1 for (20 + (random()*80)::int)), (array['selling','buying','pricing'])[1 + (i%3)], ('{\"q\":\"'||md5(i::text)||'\"}')::jsonb, ('{\"price\":'||(20+i%80)||'}')::jsonb, 10 + (i%90), (random() > 0.3), now() - (i || ' hours')::interval
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5440 ai.inference_log done (realistic)" || info "5440 inference_log (table may be in python-ai-schema)"
  else
    _psql "$port" "$db" -c "
      INSERT INTO ai.inference_log (id, user_id, query, inference_type, input_data, output_data, processing_time_ms, analytics_data_used, created_at)
      SELECT gen_random_uuid(), md5(('u'||i)::text)::uuid, 'query '||i, 'selling', '{}', '{}', 10 + (i%90), true, now()
      FROM generate_series(1, $ROWS) i;
    " 2>/dev/null && ok "5440 ai.inference_log done (analytics dual-write)" || info "5440 inference_log (table may be in python-ai-schema)"
  fi
}

# ----- Run all -----
main() {
  if [[ "${RUN_BACKGROUND:-0}" == "1" ]]; then
    mkdir -p "$REPO_ROOT/bench_logs"
    local log="$REPO_ROOT/bench_logs/seed-all-eight-$(date +%Y%m%d-%H%M%S).log"
    ( ROWS_PER_SCHEMA="$ROWS" REALISTIC="$REALISTIC" SKIP_5433="${SKIP_5433:-0}" DRY_RUN="$DRY_RUN" RUN_BACKGROUND=0 "$0" ) >> "$log" 2>&1 &
    echo "Seeding started in background. PID=$! Log=$log"
    return 0
  fi
  say "Seeding all 8 databases (1–2M rows per schema); ROWS_PER_SCHEMA=$ROWS REALISTIC=$REALISTIC"
  [[ "${SKIP_5433:-0}" != "1" ]] && seed_5433 || info "Skipping 5433"
  seed_5434
  seed_5435
  seed_5436
  seed_5437
  seed_5438
  seed_5439
  seed_5440
  say "Seeding complete. Run ANALYZE on each DB for fresh stats."
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    case $port in 5433|5434|5435) db=records ;; 5436) db=shopping ;; 5437) db=auth ;; 5438) db=postgres ;; 5439) db=analytics ;; 5440) db=python_ai ;; esac
    _psql "$port" "$db" -c "ANALYZE;" 2>/dev/null && info "ANALYZE $port/$db" || true
  done
  ok "All 8 ports seeded and analyzed."
}

main "$@"
