#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

: "${BUNDLE:=pg_bundle.tgz}"    # path on your machine
: "${CLEAN:=0}"

pod="$(get_pod)"
echo "-> using pod: $pod  ns: $NS  db: $DB"

# copy bundle into the pod
echo "-> copying bundle: $BUNDLE"
kubectl -n "$NS" cp "$BUNDLE" "$pod:/tmp/pg_bundle.tgz" -c db

# restore inside the pod
bash_in "
  set -Eeuo pipefail
  DIR=/tmp/pg_bundle_restore
  rm -rf \"\$DIR\" && mkdir -p \"\$DIR\"
  tar -xzf /tmp/pg_bundle.tgz -C \"\$DIR\"
  # flatten single top-level dir if present
  subdirs=\"\$(find \"\$DIR\" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')\"
  if [ \"\$subdirs\" = \"1\" ] && [ ! -f \"\$DIR/schema.sql\" ]; then
    top=\"\$(find \"\$DIR\" -mindepth 1 -maxdepth 1 -type d)\"
    (cd \"\$top\" && tar cf - .) | (cd \"\$DIR\" && tar xf -)
    rm -rf \"\$top\"
  fi
  if [[ '${CLEAN}' = '1' ]]; then
    echo '-> CLEAN=1: dropping schemas'
    psql -X -v ON_ERROR_STOP=1 -U postgres -d \"$DB\" <<'SQL'
DROP SCHEMA IF EXISTS records      CASCADE;
DROP SCHEMA IF EXISTS records_hot  CASCADE;
DROP SCHEMA IF EXISTS records_poc  CASCADE;
DROP SCHEMA IF EXISTS auth         CASCADE;
SQL
  fi
  # Sanitize SQL files: strip psql meta-commands and chatter
  strip_backslash_meta() {
    awk '
      BEGIN { BOM = sprintf(\"%c%c%c\",239,187,191) }
      { gsub(/\r/, \"\") }
      NR==1 { sub(\"^\" BOM, \"\") }
      /^[[:space:]]*\\\\/ { next }
      { print }
    '
  }
  sanitize_psql_transcript() {
    awk '
      BEGIN { BOM = sprintf(\"%c%c%c\", 239,187,191) }
      { sub(\"^\" BOM, \"\") }
      /^(Output format is|Tuples only is|Pager usage is|Expanded display is|Timing is|Null display is|Field separator is|Record separator is|Title is|Footers are)/ { next }
      /^pg_get_functiondef$/                 { next }
      /^psql:/                               { next }
      /^COPY [0-9]+$/                        { next }
      /^\\([0-9]+ rows\\)\\.?$/                 { next }
      /^[^[:space:]]+[=#-] /                 { next }
      /^[-+]{3,}$/                           { next }
      /^[[:space:]]*\\|/                      { next }
      /^[[:space:]]*\\\\/                      { next }
      { print }
    '
  }
  run_if() {
    local f=\"\$1\"
    if [[ -f \"\$DIR/\$f\" ]]; then
      echo \"-> applying \$f\"
      strip_backslash_meta < \"\$DIR/\$f\" | sanitize_psql_transcript | psql -X -v ON_ERROR_STOP=1 -U postgres -d \"$DB\" -f -
    else
      echo \"(skip \$f)\"
    fi
  }
  # order: globals -> functions -> schema (extensions/roles often live in globals.sql)
  run_if globals.sql
  run_if schema.sql
  run_if functions.sql
  echo '-> refresh materialized views (if present)'
  psql -X -v ON_ERROR_STOP=1 -U postgres -d \"$DB\" <<'PSQL'
\set ON_ERROR_STOP on
-- Build REFRESH statements only for MVs that actually exist, then \gexec them.
WITH mvs AS (
  SELECT oid::regclass AS mv
  FROM pg_class
  WHERE oid IN (
    to_regclass('records.aliases_mv'),
    to_regclass('records.search_doc_mv')
  ) AND oid IS NOT NULL
)
SELECT 'REFRESH MATERIALIZED VIEW ' || mv::text || ';'
FROM mvs;
\gexec
ANALYZE;
PSQL
"

echo "-> done."

