#!/usr/bin/env bash
# Clean RP/housing strings from RP seed/test data (not schema migrations).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/domain-comb}"
REPORT="${REPORT:-$REPORT_DIR/rp-rp-cleanup-report.md}"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

mkdir -p "$REPORT_DIR"

_run_psql() {
  local port="$1" db="$2" sql="$3"
  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -c "$sql" 2>&1
  else
    docker run --rm -e PGPASSWORD \
      postgres:16-alpine psql -h host.docker.internal -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -c "$sql" 2>&1
  fi
}

_try() {
  local port="$1" db="$2" sql="$3" label="$4"
  if _run_psql "$port" "$db" "SELECT 1" >/dev/null 2>&1; then
    if out="$(_run_psql "$port" "$db" "$sql" 2>&1)"; then
      echo "- $label: $out" >>"$REPORT"
      return 0
    fi
    echo "- $label: SKIP ($out)" >>"$REPORT"
  fi
}

{
  echo "# RP/RP DB cleanup report"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Changes"
} >"$REPORT"

_try 5435 listings \
  "UPDATE listings.listings SET residence_type = 'other' WHERE residence_type IS NOT NULL AND residence_type <> 'other';" \
  "listings.listings residence_type → other"

_try 5435 listings \
  "UPDATE listings.listings SET
    description = regexp_replace(COALESCE(description,''), 'off[- ]campus|housing|landlord|tenant|apartment|furnished|\\\\mOCH\\\\M', ' ', 'gi'),
    title = regexp_replace(COALESCE(title,''), 'off[- ]campus|housing|furnished|apartment|\\\\mOCH\\\\M', ' ', 'gi'),
    search_norm = regexp_replace(COALESCE(search_norm,''), 'off[- ]campus|housing|furnished|apartment', ' ', 'gi'),
    username_display = NULL
  WHERE description ~* 'off[- ]campus|housing|landlord|tenant|apartment|furnished|\\\\mOCH\\\\M'
     OR title ~* 'off[- ]campus|housing|furnished|apartment|\\\\mOCH\\\\M'
     OR search_norm ~* 'furnished|apartment'
     OR username_display ~* 'landlord';" \
  "listings.listings text fields scrubbed"

_try 5435 listings \
  "DELETE FROM listings.listing_revisions WHERE snapshot::text ~* 'apartment|landlord|furnished|off[- ]campus|housing';" \
  "listings.listing_revisions legacy snapshots removed"

_try 5435 listings \
  "UPDATE listings.community_posts SET title = 'Community update', flair = 'general'
   WHERE title ~* 'apartment|rent|housing' OR flair ~* 'landlord';" \
  "listings.community_posts scrubbed"

_try 5435 listings \
  "UPDATE listings.community_post_images SET image_url = regexp_replace(image_url, 'record-platform\\.test', 'record-platform.test', 'gi')
   WHERE image_url ~* 'off-campus|housing';" \
  "listings.community_post_images URLs rewritten"

_try 5434 messaging \
  "DELETE FROM messages.messages WHERE message_type ILIKE '%booking%' OR content ~* 'Booking request|Send in RP|off[- ]campus|housing';" \
  "messages.messages booking/RP rows removed"

_try 5434 messaging \
  "UPDATE messages.external_contacts SET
    subject = 'Marketplace',
    provider_message_id = regexp_replace(provider_message_id::text, 'record-platform', 'record-platform', 'gi')
  WHERE subject ~* 'RP|housing' OR provider_message_id::text ~* 'off-campus|housing';" \
  "messages.external_contacts scrubbed"

_try 5441 notification \
  "DELETE FROM notification.notifications WHERE event_type ILIKE '%booking%' OR dedupe_key ILIKE '%booking%';" \
  "notification.notifications booking events removed"

_try 5441 notification \
  "DELETE FROM notification.notifications WHERE payload::text ~* 'apartment|furnished|landlord|off[- ]campus|housing|\\\\mOCH\\\\M';" \
  "notification.notifications legacy kafka payloads removed"

_try 5439 analytics \
  "DELETE FROM analytics.listing_feel_cache WHERE analysis_text ~* 'apartment|landlord|tenant|guest|off[- ]campus|housing|booking'
   OR audience ~* 'landlord';" \
  "analytics.listing_feel_cache legacy cache removed"

_try 5443 media \
  "UPDATE media.media_files SET filename = regexp_replace(filename, 'apartment', 'listing', 'gi')
   WHERE filename ~* 'apartment';" \
  "media.media_files filename scrubbed"

{
  echo ""
  echo "## Summary"
  echo ""
  echo "Re-run: \`bash scripts/rp-db-domain-comb.sh\`"
} >>"$REPORT"

echo "DB cleanup report — $REPORT"
