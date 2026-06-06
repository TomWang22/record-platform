#!/usr/bin/env bash
# Apply index/ANALYZE tuning and run EXPLAIN (ANALYZE, BUFFERS) for all 8 DBs (ports 5433–5440).
# Use after DBs are up and loaded (e.g. before or after run-preflight-scale-and-all-suites.sh).
# No pgbouncer. Connection pool: max_connections=600 per instance (docker-compose).
#
# Steps:
#   1. Apply gold defaults (12-apply-gold-defaults.sql) to all 8 DBs (sub-20ms: parallel 12/4, random_page_cost 0.8).
#   2. Apply content-hash migrations (10) for buffer-friendly hashing (forum, messages, shopping, records).
#   3. Records (5433): KNN/trigram (43-optimize-knn-trgm.sql) + VACUUM ANALYZE.
#   4. Service-specific tuning (5434–5440): composite/partial indexes, autovacuum (ON_ERROR_STOP=0).
#   5. Listings (5435): optimize-listings-db.sql.
#   5.5 Data summary: per-schema/table row counts and sizes -> data-summary-<name>.txt (transparent for 7-8 figure scale).
#   6. EXPLAIN (ANALYZE, BUFFERS) per DB and per-schema (e.g. records, records-count, social forum, social messages, listings, …) -> bench_logs/explain-all-<ts>/*.txt (target 8-20ms).
#   6.5 Execution time check: warn if any plan exceeds EXPLAIN_TARGET_MS.
#   6.6 Bottleneck self-detection: Seq Scan, high shared read (BUFFER_READ_THRESHOLD=500), execution time -> bottleneck-summary.txt.
#   7. Optional: RUN_QUICK_PGBENCH=1 runs pgbench -S per port (fast latency check).
#   8. Optional: RUN_FULL_PGBENCH=1 runs the same 8 pgbench sweeps as preflight step 8 (PGBENCH_PARALLEL=1 by default).
#
#   RUN_EXPLAIN_ONLY=1: skip steps 1–5.5 and only run step 6 (EXPLAIN ANALYZE, BUFFERS for all 8 DBs/schemas).
#   Used by run-all-8-pgbench-standalone.sh to produce a combined explain log after the sweeps.
#
# See: scripts/DB_TUNING_7_SERVICES.md, PGBENCH_HARDENING.md, run-preflight-scale-and-all-suites.sh (step 8).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
GOLD_SQL="$REPO_ROOT/infra/db/12-apply-gold-defaults.sql"
CONTENT_HASH_SQL="$REPO_ROOT/infra/db/10-content-hash-migrations.sql"
SERVICE_TUNING="$REPO_ROOT/infra/db/service-specific-tuning.sql"
KNN_TRGM="$REPO_ROOT/infra/db/43-optimize-knn-trgm.sql"
LISTINGS_OPT="$REPO_ROOT/infra/db/optimize-listings-db.sql"
RUN_QUICK_PGBENCH="${RUN_QUICK_PGBENCH:-0}"
RUN_FULL_PGBENCH="${RUN_FULL_PGBENCH:-0}"    # run same 8 pgbench sweeps as run-preflight-scale-and-all-suites.sh step 8
PGBENCH_MODE="${PGBENCH_MODE:-quick}"         # quick | deep (used when RUN_FULL_PGBENCH=1)
SKIP_CONTENT_HASH="${SKIP_CONTENT_HASH:-0}"   # set to 1 to skip (content-hash UPDATEs can be slow on large tables)
RUN_EXPLAIN_ONLY="${RUN_EXPLAIN_ONLY:-0}"    # set to 1 to skip steps 1-5 and only run EXPLAIN (ANALYZE, BUFFERS) for all 8 DBs/schemas

# port -> default database name (same as apply-gold-tuning-all-dbs.sh)
declare -A PORT_DB=(
  [5433]=records
  [5434]=postgres
  [5435]=records
  [5436]=postgres
  [5437]=postgres
  [5438]=auction_monitor
  [5439]=analytics
  [5440]=python_ai
)

# port -> short name for logs
declare -A PORT_NAME=(
  [5433]=records
  [5434]=social
  [5435]=listings
  [5436]=shopping
  [5437]=auth
  [5438]=auction-monitor
  [5439]=analytics
  [5440]=python-ai
)

psql_conn() {
  local port=$1
  local db=$2
  shift 2
  psql -h "$PGHOST" -p "$port" -U postgres -d "$db" -v ON_ERROR_STOP="${ON_ERROR_STOP:-1}" "$@"
}

ok()  { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "📋 $*"; }
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

# --- Log dir (always; used by EXPLAIN step and by optional 5.45/5.5) ---
# EXPLAIN_DIR: when set (e.g. by run-preflight-scale-and-all-suites.sh), write EXPLAIN outputs here for packaged run.
TS=$(date +%Y%m%d-%H%M%S)
LOG_DIR="${EXPLAIN_DIR:-$REPO_ROOT/bench_logs/explain-all-${TS}}"
mkdir -p "$LOG_DIR"

if [[ "${RUN_EXPLAIN_ONLY}" != "1" ]]; then
# --- 1. Gold defaults for all 8 ---
info "Applying gold defaults to all 8 DBs..."
for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
  db="${PORT_DB[$port]}"
  if psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
    if psql_conn "$port" "$db" -f "$GOLD_SQL" >/dev/null 2>&1; then
      ok "Gold defaults (port $port, db $db)"
    else
      if [[ "$db" != "postgres" ]] && psql_conn "$port" postgres -f "$GOLD_SQL" >/dev/null 2>&1; then
        ok "Gold defaults (port $port, db postgres)"
      else
        warn "Gold defaults failed (port $port, db $db)"
      fi
    fi
  else
    warn "Cannot connect to port $port (db $db), skipping"
  fi
done

# --- 2. Content-hash (hashing for buffer fit, dedup) on all 8 DBs ---
if [[ "$SKIP_CONTENT_HASH" == "1" ]] || [[ "$SKIP_CONTENT_HASH" == "true" ]]; then
  info "Skipping content-hash (SKIP_CONTENT_HASH=1). Run without it to apply hashing."
else
  info "Applying content-hash migrations (buffer-friendly hashing) to all 8 DBs..."
  if [[ -f "$CONTENT_HASH_SQL" ]]; then
    export ON_ERROR_STOP=0
    for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
      db="${PORT_DB[$port]}"
      if psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
        psql_conn "$port" "$db" -f "$CONTENT_HASH_SQL" >/dev/null 2>&1 && ok "Content-hash (port $port)" || ok "Content-hash applied with skips (port $port)"
      fi
    done
    export ON_ERROR_STOP=1
  else
    warn "Content-hash SQL not found ($CONTENT_HASH_SQL), skipping"
  fi
fi

# --- 3. Records (5433): KNN/trigram + VACUUM ANALYZE ---
port=5433
db="${PORT_DB[$port]}"
if psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
  info "Records (5433): applying KNN/trigram tuning..."
  if [[ -f "$KNN_TRGM" ]]; then
    psql_conn "$port" "$db" -f "$KNN_TRGM" >/dev/null 2>&1 && ok "43-optimize-knn-trgm applied" || warn "43-optimize-knn-trgm had errors (continuing)"
  fi
  info "Records (5433): VACUUM ANALYZE records.records..."
  psql_conn "$port" "$db" -c "VACUUM ANALYZE records.records;" >/dev/null 2>&1 || true
  ok "Records tuning done"
else
  warn "Records (5433) not reachable, skipping"
fi

# --- 4. Service-specific tuning for 5434–5440 (continue on error so only matching schemas apply) ---
info "Applying service-specific tuning to ports 5434–5440..."
export ON_ERROR_STOP=0
for port in 5434 5435 5436 5437 5438 5439 5440; do
  db="${PORT_DB[$port]}"
  if psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
    if [[ -f "$SERVICE_TUNING" ]]; then
      psql_conn "$port" "$db" -f "$SERVICE_TUNING" >/dev/null 2>&1 && ok "Service tuning applied (port $port)" || ok "Service tuning applied with some skips (port $port)"
    fi
  else
    warn "Cannot connect to port $port, skipping"
  fi
done
export ON_ERROR_STOP=1

# --- 5. Listings (5435): optimize-listings-db.sql ---
port=5435
db="${PORT_DB[$port]}"
if psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1 && [[ -f "$LISTINGS_OPT" ]]; then
  info "Listings (5435): applying optimize-listings-db.sql..."
  psql_conn "$port" "$db" -f "$LISTINGS_OPT" >/dev/null 2>&1 && ok "Listings optimization applied" || warn "Listings optimization had errors"
fi

# --- 5.45 Drop unused indexes: report on all DBs; drop known-unused on records (5433) only ---
DROP_UNUSED_REPORT="${REPO_ROOT}/infra/db/45-drop-unused-indexes.sql"
DROP_UNUSED_RECORDS="${REPO_ROOT}/infra/db/45-drop-unused-indexes-records.sql"
if [[ -f "$DROP_UNUSED_REPORT" ]]; then
  info "Unused indexes: report on all DBs..."
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    db="${PORT_DB[$port]}"
    name="${PORT_NAME[$port]}"
    if psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
      psql_conn "$port" "$db" -f "$DROP_UNUSED_REPORT" > "$LOG_DIR/unused-indexes-$name.txt" 2>&1 || true
      ok "unused-indexes report $name -> $LOG_DIR/unused-indexes-$name.txt"
    fi
  done
  if [[ -f "$DROP_UNUSED_RECORDS" ]] && psql_conn 5433 records -tAc "SELECT 1" >/dev/null 2>&1; then
    info "Records (5433): dropping known-unused indexes..."
    psql_conn 5433 records -f "$DROP_UNUSED_RECORDS" >/dev/null 2>&1 && ok "Dropped unused indexes on records" || warn "Drop unused records had errors (continuing)"
  fi
else
  warn "45-drop-unused-indexes.sql not found, skipping"
fi

# --- 5.5 Data summary (per-schema/table row counts and sizes; transparent for tuning) ---
DATA_SUMMARY_SQL="${REPO_ROOT}/infra/db/31-data-summary.sql"
info "Writing data summaries and EXPLAIN outputs to: $LOG_DIR"
if [[ -f "$DATA_SUMMARY_SQL" ]]; then
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    db="${PORT_DB[$port]}"
    name="${PORT_NAME[$port]}"
    if psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
      psql_conn "$port" "$db" -f "$DATA_SUMMARY_SQL" > "$LOG_DIR/data-summary-$name.txt" 2>&1 || true
      ok "data summary $name -> $LOG_DIR/data-summary-$name.txt"
    fi
  done
else
  warn "Data summary SQL not found ($DATA_SUMMARY_SQL), skipping"
fi
fi
# END RUN_EXPLAIN_ONLY skip

# --- 6. EXPLAIN (ANALYZE, BUFFERS) per DB (target 8-20ms per query) ---
if [[ "${RUN_EXPLAIN_ONLY}" == "1" ]]; then
  info "RUN_EXPLAIN_ONLY=1: skipping tune steps; running EXPLAIN (ANALYZE, BUFFERS) for all 8 DBs/schemas only."
fi
# Session settings matching pgbench gold (run_pgbench_sweep.sh) so Execution Time is comparable to benchmark TPS
RECORDS_EXPLAIN_SESSION="SET jit = off; SET synchronous_commit = off; SET work_mem = '32MB'; SET effective_cache_size = '4GB'; SET random_page_cost = 1.1; SET cpu_index_tuple_cost = 0.0005; SET cpu_tuple_cost = 0.01; SET enable_seqscan = off; SET pg_trgm.similarity_threshold = 0.40; SET search_path = public, records, pg_catalog;"

# Records (5433): main search (same as pgbench KNN/TRGM path)
explain_records() {
  local port=5433
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/records.txt"
  psql_conn "$port" "$db" -c "
    $RECORDS_EXPLAIN_SESSION
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT * FROM public.search_records_fuzzy_ids(
      '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, 'test', 50::bigint, 0::bigint, 'fast'
    );
  " > "$out" 2>&1 || echo "(explain failed: function or table missing)" >> "$out"
  ok "records -> $out"
}

# Records (5433): count(*) path (exactly what pgbench runs)
explain_records_count() {
  local port=5433
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/records-count.txt"
  psql_conn "$port" "$db" -c "
    $RECORDS_EXPLAIN_SESSION
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT count(*) FROM public.search_records_fuzzy_ids(
      '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, 'test', 50::bigint, 0::bigint, 'fast'
    );
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "records (count) -> $out"
}

# Social (5434): forum post list (bench_forum_list) — schema: forum
explain_social() {
  local port=5434
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/social-forum.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = forum, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, user_id, title, content, flair, upvotes, downvotes, comment_count, created_at
    FROM forum.posts
    ORDER BY created_at DESC
    LIMIT 20;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "social (forum) -> $out"
}

# Social (5434): messages list — schema: messages (schema-to-schema EXPLAIN)
explain_social_messages() {
  local port=5434
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/social-messages.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = messages, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, sender_id, recipient_id, body, created_at
    FROM messages.messages
    ORDER BY created_at DESC
    LIMIT 20;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "social (messages) -> $out"
}

# Listings (5435): listing search (bench_listing_search)
explain_listings() {
  local port=5435
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/listings.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = listings, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, user_id, title, price, currency, listing_type, condition, category, location, is_active, created_at
    FROM listings.listings
    WHERE is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 50;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "listings -> $out"
}

# Shopping (5436): cart get (bench_cart_get)
explain_shopping() {
  local port=5436
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/shopping.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = shopping, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, item_type, item_id, quantity, price, metadata, created_at
    FROM shopping.shopping_cart
    WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    ORDER BY created_at DESC;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "shopping -> $out"
}

# Auth (5437): user lookup
explain_auth() {
  local port=5437
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/auth.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = auth, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, email, created_at FROM users LIMIT 20;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "auth -> $out"
}

# Auction-monitor (5438)
explain_auction() {
  local port=5438
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/auction-monitor.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = auction_monitor, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT item_id, sold_at, price, title FROM auction_monitor.auction_results ORDER BY sold_at DESC LIMIT 50;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "auction-monitor -> $out"
}

# Analytics (5439)
explain_analytics() {
  local port=5439
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/analytics.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = analytics, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT * FROM analytics.price_snapshots ORDER BY recorded_at DESC LIMIT 50;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "analytics -> $out"
}

# Python-ai (5440) — schema ai from 09-python-ai-schema.sql, table ai.inference_log (created_at)
explain_python_ai() {
  local port=5440
  local db="${PORT_DB[$port]}"
  local out="$LOG_DIR/python-ai.txt"
  psql_conn "$port" "$db" -c "
    SET search_path = ai, public, pg_catalog;
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, user_id, created_at FROM ai.inference_log ORDER BY created_at DESC LIMIT 50;
  " > "$out" 2>&1 || echo "(explain failed)" >> "$out"
  ok "python-ai -> $out"
}

explain_records
explain_records_count
explain_social
explain_social_messages
explain_listings
explain_shopping
explain_auth
explain_auction
explain_analytics
explain_python_ai

# --- 6.5 Execution time check (target 8-20ms per query; warn if over 20ms) ---
EXPLAIN_TARGET_MS="${EXPLAIN_TARGET_MS:-20}"
EXPLAIN_FILES=("$LOG_DIR"/records.txt "$LOG_DIR"/records-count.txt "$LOG_DIR"/social-forum.txt "$LOG_DIR"/social-messages.txt "$LOG_DIR"/listings.txt "$LOG_DIR"/shopping.txt "$LOG_DIR"/auth.txt "$LOG_DIR"/auction-monitor.txt "$LOG_DIR"/analytics.txt "$LOG_DIR"/python-ai.txt)
for f in "${EXPLAIN_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    exec_ms=$(grep -oE 'Execution Time: [0-9]+\.?[0-9]* ms' "$f" 2>/dev/null | tail -1 | grep -oE '[0-9]+\.?[0-9]*' || echo "")
    if [[ -n "$exec_ms" ]]; then
      if awk -v m="$exec_ms" -v t="$EXPLAIN_TARGET_MS" 'BEGIN { exit (m+0 > t+0) ? 0 : 1 }' 2>/dev/null; then
        warn "$(basename "$f" .txt): Execution Time ${exec_ms} ms (target ≤${EXPLAIN_TARGET_MS} ms - review plan)"
      else
        ok "$(basename "$f" .txt): Execution Time ${exec_ms} ms (≤${EXPLAIN_TARGET_MS} ms)"
      fi
    fi
  fi
done

# --- 6.6 Bottleneck self-detection (Seq Scan, high shared read, execution time) ---
BOTTLENECK_SUMMARY="$LOG_DIR/bottleneck-summary.txt"
BUFFER_READ_THRESHOLD="${BUFFER_READ_THRESHOLD:-500}"
echo "=== Bottleneck summary (self-detected from EXPLAIN) ===" > "$BOTTLENECK_SUMMARY"
echo "Target: no Seq Scan, Execution Time ≤${EXPLAIN_TARGET_MS} ms, shared read ≤${BUFFER_READ_THRESHOLD} blocks" >> "$BOTTLENECK_SUMMARY"
bottleneck_count=0
for f in "${EXPLAIN_FILES[@]}"; do
  [[ ! -f "$f" ]] && continue
  name=$(basename "$f" .txt)
  issues=()
  if grep -qE "Seq Scan|Sequence Scan" "$f" 2>/dev/null; then
    issues+=( "Seq Scan (prefer index)" )
    bottleneck_count=$((bottleneck_count + 1))
  fi
  exec_ms=$(grep -oE 'Execution Time: [0-9]+\.?[0-9]* ms' "$f" 2>/dev/null | tail -1 | grep -oE '[0-9]+\.?[0-9]*' || echo "")
  if [[ -n "$exec_ms" ]] && awk -v m="$exec_ms" -v t="$EXPLAIN_TARGET_MS" 'BEGIN { exit (m+0 > t+0) ? 0 : 1 }' 2>/dev/null; then
    issues+=( "Execution Time ${exec_ms} ms > ${EXPLAIN_TARGET_MS} ms" )
    bottleneck_count=$((bottleneck_count + 1))
  fi
  read_blks=$(grep -oE 'shared read=[0-9]+' "$f" 2>/dev/null | sed 's/.*=//' | awk '{s+=$1} END {print s+0}' || echo "0")
  if [[ -n "$read_blks" ]] && [[ "$read_blks" -gt "$BUFFER_READ_THRESHOLD" ]] 2>/dev/null; then
    issues+=( "shared read ${read_blks} blocks (cold I/O)" )
    bottleneck_count=$((bottleneck_count + 1))
  fi
  if [[ ${#issues[@]} -gt 0 ]]; then
    echo "" >> "$BOTTLENECK_SUMMARY"
    echo "[$name] ${issues[*]}" >> "$BOTTLENECK_SUMMARY"
    warn "Bottleneck: $name — ${issues[*]}"
  else
    echo "" >> "$BOTTLENECK_SUMMARY"
    echo "[$name] OK" >> "$BOTTLENECK_SUMMARY"
  fi
done
echo "" >> "$BOTTLENECK_SUMMARY"
echo "Total potential bottlenecks: $bottleneck_count (review plans in $LOG_DIR)" >> "$BOTTLENECK_SUMMARY"
if [[ "$bottleneck_count" -gt 0 ]]; then
  info "Bottleneck summary written to $BOTTLENECK_SUMMARY"
else
  ok "No bottlenecks self-detected (see $BOTTLENECK_SUMMARY)"
fi

# --- 7. Optional quick pgbench (pgbench -S per port, target sub-20ms) ---
if [[ "${RUN_QUICK_PGBENCH}" == "1" ]] || [[ "${RUN_QUICK_PGBENCH}" == "true" ]]; then
  info "Running quick pgbench -S per DB (4 clients, 5s) to check latency..."
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    db="${PORT_DB[$port]}"
    name="${PORT_NAME[$port]}"
    if ! psql_conn "$port" "$db" -tAc "SELECT 1" >/dev/null 2>&1; then continue; fi
    lat=$(PGPASSWORD="$PGPASSWORD" pgbench -h "$PGHOST" -p "$port" -U postgres -d "$db" -c 4 -j 2 -T 5 -S 2>/dev/null | awk '/latency average/ {for(i=1;i<=NF;i++) if($i~/^[0-9.]+$/) {print $i; exit}}' || echo "")
    if [[ -n "$lat" ]]; then
      if awk -v l="$lat" 'BEGIN {exit (l+0 > 20) ? 1 : 0}' 2>/dev/null; then
        ok "$name (port $port): latency ${lat} ms (sub-20ms)"
      else
        warn "$name (port $port): latency ${lat} ms (target sub-20ms - review EXPLAIN in $LOG_DIR)"
      fi
    else
      warn "$name (port $port): pgbench skipped or no pgbench"
    fi
  done
fi

# --- 8. Optional: run same 8 pgbench sweeps as run-preflight-scale-and-all-suites.sh (step 8) ---
# PGBENCH_PARALLEL=1 (default): run all 8 sweeps in parallel. PGBENCH_PARALLEL=0: sequential.
if [[ "${RUN_FULL_PGBENCH}" == "1" ]] || [[ "${RUN_FULL_PGBENCH}" == "true" ]]; then
  say "Running all 8 pgbench sweeps (same as preflight step 8; mode=${PGBENCH_MODE})..."
  TS_PGBENCH=$(date +%Y%m%d-%H%M%S)
  PGBENCH_LOG_DIR="${PGBENCH_FULL_LOG_DIR:-$REPO_ROOT/bench_logs/pgbench-full-$TS_PGBENCH}"
  mkdir -p "$PGBENCH_LOG_DIR"
  PGBENCH_FULL_LOG="${PGBENCH_FULL_LOG:-$PGBENCH_LOG_DIR/combined.log}"
  failed_pgbench=0
  export COLD_FIRST=0
  export RUN_COLD_CACHE=false
  PGBENCH_PARALLEL="${PGBENCH_PARALLEL:-1}"

  if [[ "$PGBENCH_PARALLEL" == "1" ]]; then
    say "  Running all 8 sweeps in parallel (logs: $PGBENCH_LOG_DIR/*.log)"
    pids=()
    if [[ -f "$SCRIPT_DIR/run_pgbench_sweep.sh" ]]; then
      ( CHECK_RECORDS_DB="${CHECK_RECORDS_DB:-1}" MODE="$PGBENCH_MODE" "$SCRIPT_DIR/run_pgbench_sweep.sh" 2>&1 | tee "$PGBENCH_LOG_DIR/records.log" ); echo $? > "$PGBENCH_LOG_DIR/records.exit" &
      pids+=( $! )
    fi
    for sweep in run_social_pgbench_sweep run_auth_pgbench_sweep run_shopping_pgbench_sweep run_listings_pgbench_sweep run_analytics_pgbench_sweep run_auction-monitor_pgbench_sweep run_python-ai_pgbench_sweep; do
      if [[ -f "$SCRIPT_DIR/$sweep.sh" ]]; then
        name=$(basename "$sweep" .sh | sed 's/run_//;s/_pgbench_sweep//;s/-/_/g')
        ( MODE="$PGBENCH_MODE" "$SCRIPT_DIR/$sweep.sh" 2>&1 | tee "$PGBENCH_LOG_DIR/$name.log" ); echo $? > "$PGBENCH_LOG_DIR/$name.exit" &
        pids+=( $! )
      fi
    done
    for pid in "${pids[@]}"; do wait "$pid" || true; done
    for f in "$PGBENCH_LOG_DIR"/*.exit; do
      [[ -f "$f" ]] && [[ "$(cat "$f" 2>/dev/null)" != "0" ]] && failed_pgbench=$((failed_pgbench + 1))
    done
    for name in records social auth shopping listings analytics auction_monitor python_ai; do
      [[ -f "$PGBENCH_LOG_DIR/$name.log" ]] && echo "=== $name ===" >> "$PGBENCH_FULL_LOG" && cat "$PGBENCH_LOG_DIR/$name.log" >> "$PGBENCH_FULL_LOG"
    done
  else
    if [[ -f "$SCRIPT_DIR/run_pgbench_sweep.sh" ]]; then
      say "  Records DB (run_pgbench_sweep.sh)..."
      CHECK_RECORDS_DB="${CHECK_RECORDS_DB:-1}" MODE="$PGBENCH_MODE" "$SCRIPT_DIR/run_pgbench_sweep.sh" 2>&1 | tee -a "$PGBENCH_FULL_LOG" || failed_pgbench=$((failed_pgbench + 1))
    fi
    for sweep in run_social_pgbench_sweep run_auth_pgbench_sweep run_shopping_pgbench_sweep run_listings_pgbench_sweep run_analytics_pgbench_sweep run_auction-monitor_pgbench_sweep run_python-ai_pgbench_sweep; do
      if [[ -f "$SCRIPT_DIR/$sweep.sh" ]]; then
        say "  $sweep.sh..."
        MODE="$PGBENCH_MODE" "$SCRIPT_DIR/$sweep.sh" 2>&1 | tee -a "$PGBENCH_FULL_LOG" || failed_pgbench=$((failed_pgbench + 1))
      fi
    done
  fi

  if [[ "$failed_pgbench" -eq 0 ]]; then
    ok "All 8 pgbench sweeps complete (logs: $PGBENCH_LOG_DIR)"
  else
    warn "Some pgbench sweeps had issues (failures: $failed_pgbench); see $PGBENCH_LOG_DIR and PGBENCH_HARDENING.md"
  fi
fi

echo ""
ok "Done. EXPLAIN outputs in: $LOG_DIR"
echo "  Next: review plans in $LOG_DIR; RUN_QUICK_PGBENCH=1 for fast latency check; RUN_FULL_PGBENCH=1 to run same 8 pgbench sweeps as preflight step 8; or run full pipeline: run-preflight-scale-and-all-suites.sh"
