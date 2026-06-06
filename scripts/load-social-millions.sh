#!/usr/bin/env bash
# Load millions of rows into social DB (port 5434): forum.posts, forum.comments, messages.groups, messages.messages.
# Respects schema and FK order. Uses short title/content for fast inserts (GIN trigram indexes on posts).
# Usage: TARGET_POSTS=500000 TARGET_MESSAGES=500000 ./scripts/load-social-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
#   SOCIAL_POSTS_BATCH_SIZE=10000 — smaller batches for forum.posts (default 10k; 50k with long content ~2.5h/batch)
#   STATEMENT_TIMEOUT=3600 — per-statement timeout in seconds (default 1h); prevents runaway inserts
#   SOCIAL_DROP_GIN_DURING_LOAD=1 — drop GIN indexes on forum.posts during load, recreate after (much faster)
#   LOAD_PROGRESS_INTERVAL=30 — seconds between "still inserting..." progress lines (default 30)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${SOCIAL_DB_HOST:-localhost}"
DB_PORT="${SOCIAL_DB_PORT:-5434}"
DB_USER="${SOCIAL_DB_USER:-postgres}"
DB_NAME="${SOCIAL_DB_NAME:-records}"
DB_PASS="${SOCIAL_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

TARGET_POSTS="${TARGET_POSTS:-800000}"
TARGET_COMMENTS="${TARGET_COMMENTS:-1200000}"
TARGET_GROUPS="${TARGET_GROUPS:-50000}"
TARGET_MESSAGES="${TARGET_MESSAGES:-500000}"
BATCH_SIZE="${BATCH_SIZE:-50000}"
# forum.posts has GIN trigram indexes on title/content; long content makes inserts ~2.5h per 50k rows.
# Use smaller batches and short content so each batch finishes in minutes.
SOCIAL_POSTS_BATCH_SIZE="${SOCIAL_POSTS_BATCH_SIZE:-10000}"
# Per-statement timeout (seconds); prevents runaway inserts. Default 1 hour.
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-3600}"
# If set to 1, drop GIN indexes on forum.posts before loading posts and recreate after (much faster bulk load).
SOCIAL_DROP_GIN_DURING_LOAD="${SOCIAL_DROP_GIN_DURING_LOAD:-0}"
# Progress heartbeat interval (seconds) while a batch is running
LOAD_PROGRESS_INTERVAL="${LOAD_PROGRESS_INTERVAL:-30}"

echo "$(ts) === Load social DB (port $DB_PORT): forum.posts, forum.comments, messages.* ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

# Ensure DB and schemas (run migrations first if tables missing)
_psql_connect postgres "SELECT 1 FROM pg_database WHERE datname = 'records';" >/dev/null 2>&1 || \
  _psql_connect postgres "CREATE DATABASE records;" 2>/dev/null || true

# Check tables exist (schema from 04-social-schema.sql)
if ! psql -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'forum' AND table_name = 'posts';" 2>/dev/null | grep -q 1; then
  echo "$(ts) forum.posts missing. Run social migrations first (e.g. infra/db/04-social-schema.sql)." >&2
  exit 1
fi

# 1) forum.posts — short title/content to avoid GIN trigram index blow-up (~2.5h per 50k with long content)
# Schema has idx_posts_title_trgm and idx_posts_content_trgm (GIN); short content = fast inserts.
# Optional: SOCIAL_DROP_GIN_DURING_LOAD=1 drops those indexes during load and recreates after (much faster).
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM forum.posts;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) forum.posts: $CURRENT (target $TARGET_POSTS) [batch size ${SOCIAL_POSTS_BATCH_SIZE}, statement_timeout=${STATEMENT_TIMEOUT}s]"
if [[ "$CURRENT" -lt "$TARGET_POSTS" ]]; then
  if [[ "${SOCIAL_DROP_GIN_DURING_LOAD}" == "1" ]]; then
    echo "$(ts)   Dropping GIN indexes on forum.posts for faster bulk load (will recreate after)..."
    psql -d records -c "DROP INDEX IF EXISTS forum.idx_posts_title_trgm; DROP INDEX IF EXISTS forum.idx_posts_content_trgm;" >/dev/null 2>&1 || true
  fi
  NEED=$(( TARGET_POSTS - CURRENT ))
  BATCH=0
  while [[ $NEED -gt 0 ]]; do
    THIS=$(( SOCIAL_POSTS_BATCH_SIZE < NEED ? SOCIAL_POSTS_BATCH_SIZE : NEED ))
    BATCH=$(( BATCH + 1 ))
    echo "$(ts)   posts batch $BATCH: inserting $THIS rows (timeout ${STATEMENT_TIMEOUT}s)..." >&2
    _sql_file=$(mktemp)
    cat <<EOSQL > "$_sql_file"
SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO forum.posts (user_id, title, content, flair, upload_type, upvotes, downvotes, comment_count)
SELECT
  gen_random_uuid(),
  'Post ' || g.n || ' ' || substr(md5(g.n::text), 1, 8) || ' vinyl',
  'Content ' || g.n || ' records and collecting. ' || substr(md5(g.n::text), 1, 12),
  (ARRAY['Discussion','Question','Showcase','For Sale','Want to Buy','News','Meta'])[1 + (g.n % 7)],
  (ARRAY['text','text','text','link','image'])[1 + (g.n % 5)],
  (random() * 500)::int,
  (random() * 20)::int,
  0
FROM generate_series(1, $THIS) AS g(n);
EOSQL
    psql -d records -f "$_sql_file" >/dev/null 2>&1 &
    _pid=$!
    while kill -0 "$_pid" 2>/dev/null; do
      echo "$(ts)   ... still inserting batch $BATCH ($THIS rows)..." >&2
      sleep "$LOAD_PROGRESS_INTERVAL"
    done
    wait "$_pid"
    _rc=$?
    rm -f "$_sql_file"
    if [[ $_rc -ne 0 ]]; then
      echo "$(ts)   posts batch $BATCH failed (exit $_rc). Try smaller SOCIAL_POSTS_BATCH_SIZE or higher STATEMENT_TIMEOUT." >&2
      break
    fi
    CURRENT=$(psql -d records -tAc "SELECT count(*) FROM forum.posts;" 2>/dev/null | tr -d ' ')
    NEED=$(( TARGET_POSTS - CURRENT ))
    echo "$(ts)   posts batch $BATCH done: count=$CURRENT"
  done
  if [[ "${SOCIAL_DROP_GIN_DURING_LOAD}" == "1" ]]; then
    echo "$(ts)   Recreating GIN indexes on forum.posts..."
    psql -d records -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_title_trgm ON forum.posts USING gin(title gin_trgm_ops); CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_content_trgm ON forum.posts USING gin(content gin_trgm_ops);" >/dev/null 2>&1 || \
    psql -d records -c "CREATE INDEX IF NOT EXISTS idx_posts_title_trgm ON forum.posts USING gin(title gin_trgm_ops); CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON forum.posts USING gin(content gin_trgm_ops);" >/dev/null 2>&1 || true
    echo "$(ts)   GIN indexes recreated."
  fi
fi

# 2) forum.comments — sample post_id once per batch (avoid ORDER BY random() per row = full scan per row)
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM forum.comments;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) forum.comments: $CURRENT (target $TARGET_COMMENTS) [statement_timeout=${STATEMENT_TIMEOUT}s]"
if [[ "$CURRENT" -lt "$TARGET_COMMENTS" ]]; then
  NEED=$(( TARGET_COMMENTS - CURRENT ))
  BATCH=0
  while [[ $NEED -gt 0 ]]; do
    THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
    BATCH=$(( BATCH + 1 ))
    echo "$(ts)   comments batch $BATCH: inserting $THIS rows..." >&2
    psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
WITH posts_sample AS (
  SELECT id, row_number() OVER () AS rn FROM (SELECT id FROM forum.posts ORDER BY random() LIMIT 1000) t
),
series AS (SELECT g.n FROM generate_series(1, $THIS) AS g(n))
INSERT INTO forum.comments (post_id, user_id, parent_id, content, upvotes, downvotes)
SELECT
  p.id,
  gen_random_uuid(),
  NULL,
  'Comment ' || s.n || ' reply ' || substr(md5(s.n::text), 1, 12),
  (random() * 50)::int,
  (random() * 5)::int
FROM series s
JOIN posts_sample p ON p.rn = 1 + (s.n % (SELECT count(*) FROM posts_sample));" >/dev/null 2>&1 || { echo "$(ts) comments batch $BATCH failed" >&2; break; }
    CURRENT=$(psql -d records -tAc "SELECT count(*) FROM forum.comments;" 2>/dev/null | tr -d ' ')
    NEED=$(( TARGET_COMMENTS - CURRENT ))
    echo "$(ts)   comments batch $BATCH: count=$CURRENT"
  done
fi

# 3) messages.groups
CURRENT=$(psql -tAc "SELECT count(*) FROM messages.groups;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) messages.groups: $CURRENT (target $TARGET_GROUPS) [statement_timeout=${STATEMENT_TIMEOUT}s]"
if [[ "$CURRENT" -lt "$TARGET_GROUPS" ]]; then
  NEED=$(( TARGET_GROUPS - CURRENT ))
  BATCH=0
  while [[ $NEED -gt 0 ]]; do
    THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
    BATCH=$(( BATCH + 1 ))
    psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO messages.groups (name, description, created_by)
SELECT
  'Group ' || g.n || ' ' || substr(md5(random()::text), 1, 8),
  'Description for group ' || g.n,
  gen_random_uuid()
FROM generate_series(1, $THIS) AS g(n);" >/dev/null 2>&1 || { echo "$(ts) groups batch $BATCH failed" >&2; break; }
    CURRENT=$(psql -d records -tAc "SELECT count(*) FROM messages.groups;" 2>/dev/null | tr -d ' ')
    NEED=$(( TARGET_GROUPS - CURRENT ))
    echo "$(ts)   groups batch $BATCH: count=$CURRENT"
  done
fi

# 4) messages.messages — sample group_id once per batch (avoid ORDER BY random() per row)
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM messages.messages;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) messages.messages: $CURRENT (target $TARGET_MESSAGES) [statement_timeout=${STATEMENT_TIMEOUT}s]"
if [[ "$CURRENT" -lt "$TARGET_MESSAGES" ]]; then
  NEED=$(( TARGET_MESSAGES - CURRENT ))
  BATCH=0
  while [[ $NEED -gt 0 ]]; do
    THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
    BATCH=$(( BATCH + 1 ))
    echo "$(ts)   messages batch $BATCH: inserting $THIS rows..." >&2
    psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
WITH grp AS (SELECT id, row_number() OVER () AS rn FROM (SELECT id FROM messages.groups ORDER BY random() LIMIT 500) t),
     series AS (SELECT g.n FROM generate_series(1, $THIS) AS g(n))
INSERT INTO messages.messages (sender_id, recipient_id, group_id, message_type, subject, content, is_read)
SELECT
  gen_random_uuid(),
  CASE WHEN s.n % 2 = 0 THEN gen_random_uuid() ELSE NULL END,
  CASE WHEN s.n % 2 = 1 THEN (SELECT id FROM grp WHERE rn = 1 + (s.n % (SELECT count(*) FROM grp))) ELSE NULL END,
  'General',
  'Subject ' || s.n || ' ' || substr(md5(s.n::text), 1, 8),
  'Message ' || s.n,
  (random() > 0.5)
FROM series s;" >/dev/null 2>&1 || { echo "$(ts) messages batch $BATCH failed" >&2; break; }
    CURRENT=$(psql -d records -tAc "SELECT count(*) FROM messages.messages;" 2>/dev/null | tr -d ' ')
    NEED=$(( TARGET_MESSAGES - CURRENT ))
    echo "$(ts)   messages batch $BATCH: count=$CURRENT"
  done
fi

echo "$(ts) Done. Run run_social_pgbench_sweep.sh for benchmarking."
