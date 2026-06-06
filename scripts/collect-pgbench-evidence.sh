#!/usr/bin/env bash
# Collect all artifacts requested by PostgreSQL GPT for tuning analysis.
# Run after a pgbench run (preflight step 8) and optionally after apply-tune-and-explain-all-dbs.sh.
#
# Usage:
#   ./scripts/collect-pgbench-evidence.sh
#   PGBENCH_LOG_DIR=/tmp/pgbench-preflight-YYYYMMDD-HHMMSS ./scripts/collect-pgbench-evidence.sh
#   EXPLAIN_DIR=$REPO_ROOT/bench_logs/explain-all-YYYYMMDDHHMMSS ./scripts/collect-pgbench-evidence.sh
#
# Output: bench_logs/evidence-pack-<ts>/ with logs, plans, data summaries, and SQL outputs.
# Then open bench_logs/evidence-pack-<ts>/SEND-TO-POSTGRESQL-GPT.md for the checklist.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
RECORDS_PORT="${RECORDS_DB_PORT:-5433}"

TS=$(date +%Y%m%d-%H%M%S)
EVIDENCE_DIR="${EVIDENCE_DIR:-$REPO_ROOT/bench_logs/evidence-pack-$TS}"
mkdir -p "$EVIDENCE_DIR"

ok()  { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "📋 $*"; }
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

psql_records() {
  psql -h "$PGHOST" -p "$RECORDS_PORT" -U postgres -d records -X -P pager=off "$@"
}

# Resolve optional dirs (use env or find latest)
if [[ -z "${PGBENCH_LOG_DIR:-}" ]]; then
  PGBENCH_LOG_DIR=$(ls -td /tmp/pgbench-preflight-* 2>/dev/null | head -1 || true)
fi
if [[ -z "${EXPLAIN_DIR:-}" ]]; then
  EXPLAIN_DIR=$(ls -td "$REPO_ROOT/bench_logs/explain-all-"* 2>/dev/null | head -1 || true)
fi
if [[ -z "${RECORDS_BENCH_LOG_DIR:-}" ]]; then
  RECORDS_BENCH_LOG_DIR=$(ls -td "$REPO_ROOT/bench_logs/20"* 2>/dev/null | head -1 || true)
fi

say "Collecting evidence into: $EVIDENCE_DIR"

# --- 1A. pgbench logs (combined, all 8 per-DB logs, diagnostics) ---
info "1A. pgbench logs (combined, all 8 DBs, diagnostics)..."
if [[ -n "${PGBENCH_LOG_DIR:-}" ]] && [[ -d "$PGBENCH_LOG_DIR" ]]; then
  if [[ -f "$PGBENCH_LOG_DIR/combined.log" ]]; then
    cp "$PGBENCH_LOG_DIR/combined.log" "$EVIDENCE_DIR/" && ok "  combined.log"
  else
    # Build combined from per-DB logs when preflight didn't write it (e.g. run interrupted before concat)
    combined_built=0
    for name in records social auth shopping listings analytics auction_monitor python_ai; do
      if [[ -f "$PGBENCH_LOG_DIR/$name.log" ]]; then
        if [[ "$combined_built" -eq 0 ]]; then : > "$EVIDENCE_DIR/combined.log"; combined_built=1; fi
        echo "=== $name ===" >> "$EVIDENCE_DIR/combined.log" && cat "$PGBENCH_LOG_DIR/$name.log" >> "$EVIDENCE_DIR/combined.log"
      fi
    done
    [[ "$combined_built" -eq 1 ]] && ok "  combined.log (built from per-DB logs)" || warn "  combined.log not found and no per-DB logs to build from"
  fi
  if [[ -f "$PGBENCH_LOG_DIR/diagnostics-records.log" ]]; then
    cp "$PGBENCH_LOG_DIR/diagnostics-records.log" "$EVIDENCE_DIR/" && ok "  diagnostics-records.log"
  else
    warn "  diagnostics-records.log not found in $PGBENCH_LOG_DIR"
  fi
  # All 8 per-DB logs when present (records, social, auth, shopping, listings, analytics, auction_monitor, python_ai)
  for name in records social auth shopping listings analytics auction_monitor python_ai; do
    if [[ -f "$PGBENCH_LOG_DIR/$name.log" ]]; then
      cp "$PGBENCH_LOG_DIR/$name.log" "$EVIDENCE_DIR/" && ok "  $name.log"
    fi
  done
else
  warn "  PGBENCH_LOG_DIR not set or missing. Set it to the preflight pgbench log dir (e.g. /tmp/pgbench-preflight-*)."
fi

# --- 1B. Query plans: records full analysis + all 8 EXPLAIN (ANALYZE, BUFFERS) ---
info "1B. Query plans (records + all 8 DBs/schemas)..."
if [[ -n "${RECORDS_BENCH_LOG_DIR:-}" ]] && [[ -d "$RECORDS_BENCH_LOG_DIR" ]]; then
  for f in "$RECORDS_BENCH_LOG_DIR"/query_plan_full_analysis_*.txt; do
    [[ -e "$f" ]] && cp "$f" "$EVIDENCE_DIR/" && ok "  $(basename "$f")" && break
  done
fi
if [[ -n "${EXPLAIN_DIR:-}" ]] && [[ -d "$EXPLAIN_DIR" ]]; then
  # All 8: records, records-count, social-forum, social-messages, listings, shopping, auth, auction-monitor, analytics, python-ai
  for f in records.txt records-count.txt social-forum.txt social-messages.txt listings.txt shopping.txt auth.txt auction-monitor.txt analytics.txt python-ai.txt; do
    [[ -f "$EXPLAIN_DIR/$f" ]] && cp "$EXPLAIN_DIR/$f" "$EVIDENCE_DIR/explain-$f" && ok "  explain-$f"
  done
  # Unused indexes report for all 8 DBs
  for f in "$EXPLAIN_DIR"/unused-indexes-*.txt; do
    [[ -e "$f" ]] && cp "$f" "$EVIDENCE_DIR/" && ok "  $(basename "$f")"
  done
  # Bottleneck summary if present
  [[ -f "$EXPLAIN_DIR/bottleneck-summary.txt" ]] && cp "$EXPLAIN_DIR/bottleneck-summary.txt" "$EVIDENCE_DIR/" && ok "  bottleneck-summary.txt"
fi

# --- 1C. Data summaries ---
info "1C. Data summaries (all 8 DBs)..."
if [[ -n "${EXPLAIN_DIR:-}" ]] && [[ -d "$EXPLAIN_DIR" ]]; then
  for f in "$EXPLAIN_DIR"/data-summary-*.txt; do
    [[ -e "$f" ]] && cp "$f" "$EVIDENCE_DIR/" && ok "  $(basename "$f")"
  done
fi

# --- 2A. Postgres settings (records) ---
info "2A. Postgres settings (records DB)..."
if psql_records -tAc "SELECT 1" >/dev/null 2>&1; then
  psql_records -c "
    SELECT name, setting, unit, context, source
    FROM pg_settings
    WHERE name IN (
      'max_connections','shared_buffers','effective_cache_size','work_mem',
      'maintenance_work_mem','effective_io_concurrency','random_page_cost',
      'seq_page_cost','jit','synchronous_commit','wal_compression',
      'checkpoint_timeout','checkpoint_completion_target','max_wal_size',
      'min_wal_size','wal_buffers','bgwriter_lru_maxpages','bgwriter_lru_multiplier',
      'autovacuum','autovacuum_max_workers','autovacuum_work_mem',
      'autovacuum_vacuum_scale_factor','autovacuum_analyze_scale_factor',
      'autovacuum_vacuum_cost_limit','autovacuum_vacuum_cost_delay',
      'track_io_timing','shared_preload_libraries'
    )
    ORDER BY name;
  " > "$EVIDENCE_DIR/pg_settings_records.txt" 2>&1 && ok "  pg_settings_records.txt"

  psql_records -c "SHOW server_version;" >> "$EVIDENCE_DIR/pg_settings_records.txt" 2>&1
  psql_records -c "SELECT * FROM pg_stat_bgwriter;" >> "$EVIDENCE_DIR/pg_settings_records.txt" 2>&1
  psql_records -c "SELECT * FROM pg_stat_checkpointer;" >> "$EVIDENCE_DIR/pg_settings_records.txt" 2>&1
else
  warn "  Cannot connect to records ($PGHOST:$RECORDS_PORT); skip pg_settings."
fi

# --- 2B. Hardware/container template ---
info "2B. Hardware/container snippet..."
{
  echo "=== Hardware/container (fill or run manually) ==="
  echo "CPU cores available to Postgres: (e.g. docker inspect or kubectl describe node)"
  echo "RAM available: (e.g. docker stats or kubectl top node)"
  echo "Storage: (e.g. local SSD, Colima disk, network)"
  echo "Runtime: (e.g. k3s/Colima, Postgres in Docker with limits?)"
  echo ""
  CONTAINER=$(docker ps --filter "publish=$RECORDS_PORT" --format "{{.Names}}" 2>/dev/null | head -1)
  if [[ -n "$CONTAINER" ]]; then
    echo "--- Docker container (publish $RECORDS_PORT): $CONTAINER ---"
    docker inspect "$CONTAINER" --format '{{.HostConfig.NanoCpus}} nanocpus, {{.HostConfig.Memory}} memory limit' 2>/dev/null || true
    docker stats "$CONTAINER" --no-stream 2>/dev/null || true
  fi
} > "$EVIDENCE_DIR/hardware-container.txt" 2>&1
ok "  hardware-container.txt"

# --- 3. Schema/index reality check (records) ---
info "3. Records schema/index and dead tuples..."
if psql_records -tAc "SELECT 1" >/dev/null 2>&1; then
  psql_records -c "
    -- table/index sizes
    SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS total
    FROM pg_class
    WHERE relname IN ('records','records_hot')
    ORDER BY pg_total_relation_size(oid) DESC;
  " > "$EVIDENCE_DIR/records_table_index_sizes.txt" 2>&1

  psql_records -c "
    -- index list + sizes for the hot table
    SELECT
      i.relname AS index_name,
      pg_size_pretty(pg_relation_size(i.oid)) AS size,
      ix.indisunique, ix.indisprimary,
      pg_get_indexdef(i.oid) AS def
    FROM pg_class t
    JOIN pg_index ix ON ix.indrelid = t.oid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'records'
    WHERE t.relname = 'records'
    ORDER BY pg_relation_size(i.oid) DESC;
  " >> "$EVIDENCE_DIR/records_table_index_sizes.txt" 2>&1

  psql_records -c "
    -- dead tuples / bloat signal
    SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
    FROM pg_stat_user_tables
    WHERE relname IN ('records','records_hot');
  " >> "$EVIDENCE_DIR/records_table_index_sizes.txt" 2>&1

  ok "  records_table_index_sizes.txt"
else
  warn "  Skipped records schema/index (DB not reachable)."
fi

# --- One thing to send first ---
info "Worst EXPLAIN (single file for quick send)..."
if [[ -f "$EVIDENCE_DIR/explain-records-count.txt" ]]; then
  cp "$EVIDENCE_DIR/explain-records-count.txt" "$EVIDENCE_DIR/ONE-EXPLAIN-worst-pgbench-query.txt" && ok "  ONE-EXPLAIN-worst-pgbench-query.txt"
elif [[ -f "$EVIDENCE_DIR/explain-records.txt" ]]; then
  cp "$EVIDENCE_DIR/explain-records.txt" "$EVIDENCE_DIR/ONE-EXPLAIN-worst-pgbench-query.txt" && ok "  ONE-EXPLAIN-worst-pgbench-query.txt"
elif compgen -G "$EVIDENCE_DIR/query_plan_full_analysis_*.txt" >/dev/null 2>&1; then
  worst=$(ls "$EVIDENCE_DIR"/query_plan_full_analysis_*.txt 2>/dev/null | head -1)
  [[ -n "$worst" ]] && cp "$worst" "$EVIDENCE_DIR/ONE-EXPLAIN-worst-pgbench-query.txt" && ok "  ONE-EXPLAIN-worst-pgbench-query.txt"
fi

# --- Checklist for PostgreSQL GPT ---
cat > "$EVIDENCE_DIR/SEND-TO-POSTGRESQL-GPT.md" << 'CHECKLIST'
# What to send to PostgreSQL GPT (evidence pack)

All 8 DBs (ports 5433–5440), run in parallel. Records target: 5k+ TPS.

## 1) Most important (send these first)

### A. Pgbench logs (all 8)
- `combined.log`, `records.log`, `social.log`, `auth.log`, `shopping.log`, `listings.log`, `analytics.log`, `auction_monitor.log`, `python_ai.log`
- `diagnostics-records.log` – from diagnose-performance-regression.sh

### B. Query plans (all 8 DBs/schemas)
- `explain-records.txt`, `explain-records-count.txt`, `explain-social-forum.txt`, `explain-social-messages.txt`, `explain-listings.txt`, `explain-shopping.txt`, `explain-auth.txt`, `explain-auction-monitor.txt`, `explain-analytics.txt`, `explain-python-ai.txt` (EXPLAIN ANALYZE, BUFFERS)
- `query_plan_full_analysis_*.txt` (if present)
- Quick send: `ONE-EXPLAIN-worst-pgbench-query.txt`

### C. Data scale (all 8)
- `data-summary-*.txt` for records, social, listings, shopping, auth, auction-monitor, analytics, python-ai

## 2) Config + environment

### A. Postgres settings (records)
- `pg_settings_records.txt` (server_version, pg_stat_bgwriter, pg_stat_checkpointer)

### B. Hardware/container
- `hardware-container.txt` – fill CPU/RAM/storage/runtime if not auto-filled

## 3) Schema/index (all 8)

- `records_table_index_sizes.txt` (records: table sizes, index list + defs, dead tuples)
- `unused-indexes-*.txt` for all 8 DBs (from explain-all-<ts>)
- `bottleneck-summary.txt` (if present)

## If you can only send ONE thing
Send `diagnostics-records.log` + `ONE-EXPLAIN-worst-pgbench-query.txt`.

---
Pipe repo context: `cat POSTGRESQL_GPT_CONTEXT.md` (from repo root). Full checklist: SEND-TO-POSTGRESQL-GPT.md in repo root.
CHECKLIST

say "Done. Evidence pack: $EVIDENCE_DIR"
info "Open: $EVIDENCE_DIR/SEND-TO-POSTGRESQL-GPT.md"
echo ""
echo "Optional: copy context for GPT:"
echo "  cat $REPO_ROOT/POSTGRESQL_GPT_CONTEXT.md | pbcopy"
echo "  # then paste + attach evidence-pack files"
