#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "RESTORE_FAILED ❌ at: $BASH_COMMAND" >&2' ERR
shopt -s nullglob

DB="${1:?missing DB}"
CLEAN="${2:-0}"

# Accept either a directory (/tmp/pg_bundle) or an archive (/tmp/pg_bundle.pkg)
BPKG_DIR=/tmp/pg_bundle
BPKG_ARC=/tmp/pg_bundle.pkg
WORK=/tmp/restore

psql_base="psql -X -v ON_ERROR_STOP=1 -U postgres -d $DB"

extract_bundle() {
  rm -rf "$WORK" && mkdir -p "$WORK"

  if [ -d "$BPKG_DIR" ]; then
    # Directory already copied into the pod
    cp -a "$BPKG_DIR"/. "$WORK"/
  elif [ -f "$BPKG_ARC" ]; then
    if tar -tzf "$BPKG_ARC" >/dev/null 2>&1; then
      tar -xzf "$BPKG_ARC" -C "$WORK"
    elif command -v unzip >/dev/null 2>&1; then
      unzip -q "$BPKG_ARC" -d "$WORK"
    else
      echo "ERROR: unknown archive format; provide a .tgz or .zip, or copy a directory to $BPKG_DIR" >&2
      exit 2
    fi
  else
    echo "ERROR: neither $BPKG_DIR nor $BPKG_ARC exists in the pod." >&2
    exit 2
  fi

  # If exactly one top-level dir, cd into it, otherwise stay at $WORK
  local dcount
  dcount=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | wc -l)
  local fcount
  fcount=$(find "$WORK" -mindepth 1 -maxdepth 1 -type f | wc -l)
  if [ "$dcount" -eq 1 ] && [ "$fcount" -eq 0 ]; then
    cd "$(find "$WORK" -mindepth 1 -maxdepth 1 -type d)"
  else
    cd "$WORK"
  fi
}

# Remove UTF-8 BOM and delete ANY line that begins with a backslash (after optional whitespace)
strip_backslash_meta() {
  # sed: strip BOM on first line, then drop backslash-meta lines
  sed -E $'1s/^\xEF\xBB\xBF//; /^[[:space:]]*\\/d'
}

# Strip psql transcript chatter and ALL backslash meta-commands (lines starting with "\")
sanitize_psql_transcript() {
  awk '
    BEGIN {
      # UTF-8 BOM (0xEF 0xBB 0xBF)
      BOM = sprintf("%c%c%c", 239,187,191)
    }
    {
      # strip BOM if present at start of this line
      sub("^" BOM, "", $0)
    }
    /^(Output format is|Tuples only is|Pager usage is|Expanded display is|Timing is|Null display is|Field separator is|Record separator is|Title is|Footers are)/ { next }
    /^psql:/                               { next }
    /^COPY [0-9]+$/                        { next }
    /^\([0-9]+ rows\)\.?$/                 { next }
    /^[^[:space:]]+[=#-] /                 { next }
    /^[-+]{3,}$/                           { next }
    /^[[:space:]]*\|/                      { next }
    # 🔒 drop ANY psql backslash meta-command (literal "\" at line start after optional whitespace)
    /^[[:space:]]*\\/                      { next }
    { print }
  '
}

soften_create_schema_and_extension() {
  awk 'BEGIN{IGNORECASE=1}
       { line=$0
         if (line ~ /^[[:space:]]*CREATE[[:space:]]+SCHEMA[[:space:]]+/ &&
             line !~ /CREATE[[:space:]]+SCHEMA[[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS/) {
           sub(/CREATE[[:space:]]+SCHEMA[[:space:]]+/, "CREATE SCHEMA IF NOT EXISTS ", line)
         }
         if (line ~ /^[[:space:]]*CREATE[[:space:]]+EXTENSION[[:space:]]+/ &&
             line !~ /CREATE[[:space:]]+EXTENSION[[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS/) {
           sub(/CREATE[[:space:]]+EXTENSION[[:space:]]+/, "CREATE EXTENSION IF NOT EXISTS ", line)
         }
         gsub(/IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS/, "IF NOT EXISTS", line)
         print line
       }'
}

soften_create_table_index_sequence() {
  awk 'BEGIN{IGNORECASE=1}
       { line=$0
         if (line ~ /^[[:space:]]*CREATE([[:space:]]+(GLOBAL|LOCAL))?[[:space:]]+((TEMPORARY|TEMP)[[:space:]]+|UNLOGGED[[:space:]]+)?TABLE[[:space:]]+/ &&
             line !~ /TABLE[[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS/) {
           sub(/TABLE[[:space:]]+/, "TABLE IF NOT EXISTS ", line)
         }
         if (line ~ /^[[:space:]]*CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX([[:space:]]+CONCURRENTLY)?[[:space:]]+/ &&
             line !~ /INDEX([[:space:]]+CONCURRENTLY)?[[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS/) {
           sub(/^[[:space:]]*CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX([[:space:]]+CONCURRENTLY)?[[:space:]]+/,
               "CREATE \\1INDEX\\2 IF NOT EXISTS ", line)
         }
         if (line ~ /^[[:space:]]*CREATE[[:space:]]+SEQUENCE[[:space:]]+/ &&
             line !~ /CREATE[[:space:]]+SEQUENCE[[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS/) {
           sub(/CREATE[[:space:]]+SEQUENCE[[:space:]]+/, "CREATE SEQUENCE IF NOT EXISTS ", line)
         }
         print line
       }'
}

soften_create_function() {
  awk 'BEGIN{IGNORECASE=1}
       { line=$0
         if (line ~ /^[[:space:]]*CREATE[[:space:]]+FUNCTION[[:space:]]+/ &&
             line !~ /CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION/) {
           sub(/CREATE[[:space:]]+FUNCTION[[:space:]]+/, "CREATE OR REPLACE FUNCTION ", line)
         }
         print line
       }'
}

soften_create_view() {
  awk 'BEGIN{IGNORECASE=1}
       { line=$0
         if (line ~ /^[[:space:]]*CREATE([[:space:]]+OR[[:space:]]+REPLACE)?[[:space:]]+VIEW[[:space:]]+/) {
           if (line !~ /CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+VIEW/) {
             sub(/CREATE[[:space:]]+VIEW[[:space:]]+/, "CREATE OR REPLACE VIEW ", line)
           }
         }
         print line
       }'
}

# Guard: ALTER TABLE ... ADD CONSTRAINT / ADD PRIMARY KEY
guard_add_constraint_do() {
  awk '
    BEGIN { IGNORECASE=1 }
    function trim(s){ gsub(/^[ \t\r\n]+|[ \t\r\n]+$/,"",s); return s }
    function unq(s){ gsub(/^"+|"+$/,"",s); return s }
    function dq(s){ return "$q$" s "$q$" }  # dollar-quoted literal to avoid quote hell
    {
      buf = buf $0 "\n"
      if ($0 ~ /;[[:space:]]*$/) {
        stmt = trim(buf); buf = ""
        is_alter = (stmt ~ /^ALTER[[:space:]]+TABLE[[:space:]]+/)
        adds_constraint = (stmt ~ /ADD[[:space:]]+CONSTRAINT[[:space:]]+/)
        has_pk = (stmt ~ /ADD[[:space:]]+PRIMARY[[:space:]]+KEY\b/)
        if (is_alter && (adds_constraint || has_pk)) {
          cname=""; if (adds_constraint && match(stmt,/ADD[[:space:]]+CONSTRAINT[[:space:]]+("?[^"[:space:]]+"?)/,c)) cname = unq(c[1])
          sch=""; tbl=""
          if (match(stmt,/ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?(("?[^".[:space:]]+"?)[.])?("?[^".[:space:]]+"?)/,m)) {
            if (m[3]!="") sch=unq(m[3]); tbl=unq(m[4])
          }
          reg = (tbl!="" ? (sch!="" ? sch "." tbl : tbl) : "")
          if (reg!="") {
            printf "DO $$BEGIN "
            conds=0
            if (has_pk) { printf "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype=''p'' AND conrelid=%s::regclass) ", dq(reg); conds=1 }
            if (cname!="") {
              if (conds==0) printf "IF "; else printf "AND ";
              printf "NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=%s AND conrelid=%s::regclass) ", dq(cname), dq(reg); conds=1
            }
            if (conds==0) { print stmt; next }
            printf "THEN EXECUTE $x$%s$x$; END IF; END$$;\n", stmt
          } else print stmt
        } else print stmt
      }
    }
    END { if (buf != "") print buf }
  '
}

# Guard: CREATE MATERIALIZED VIEW only if missing
guard_create_matview_do() {
  awk '
    function trim(s){ gsub(/^[ \t\r\n]+|[ \t\r\n]+$/,"",s); return s }
    function unq(s){ gsub(/^"+|"+$/,"",s); return s }
    function dq(s){ return "$q$" s "$q$" }
    {
      buf = buf $0 "\n"
      if ($0 ~ /;[[:space:]]*$/) {
        stmt = trim(buf); buf=""
        if (stmt ~ /^CREATE[[:space:]]+MATERIALIZED[[:space:]]+VIEW[[:space:]]+/) {
          reg=""
          if (match(stmt,/CREATE[[:space:]]+MATERIALIZED[[:space:]]+VIEW[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?[^".[:space:]]+"?)[.]("?[^".[:space:]]+"?)/,m)) {
            reg = unq(m[2]) "." unq(m[3])
          } else if (match(stmt,/CREATE[[:space:]]+MATERIALIZED[[:space:]]+VIEW[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?[^[:space:]]+"?)/,n)) {
            reg = unq(n[2])
          }
          if (reg!="") {
            printf "DO $$BEGIN IF to_regclass(%s) IS NULL THEN EXECUTE $x$%s$x$; END IF; END$$;\n", dq(reg), stmt
          } else print stmt
        } else print stmt
      }
    }
    END { if (buf != "") print buf }
  '
}

# Pre-drop PKs only for tables that the incoming file will (re)add a PK for
predrop_primary_keys_from_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  awk '
    BEGIN { IGNORECASE=1 }
    function trim(s){ gsub(/^[ \t\r\n]+|[ \t\r\n]+$/,"",s); return s }
    function unq(s){ gsub(/^"+|"+$/,"",s); return s }
    function dq(s){ return "$q$" s "$q$" }
    {
      buf = buf $0 "\n"
      if ($0 ~ /;[[:space:]]*$/) {
        stmt = trim(buf); buf=""
        if (stmt ~ /^ALTER[[:space:]]+TABLE[[:space:]]+/ && stmt ~ /PRIMARY[[:space:]]+KEY\b/) {
          sch=""; tbl=""
          if (match(stmt,/ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?(("?[^".[:space:]]+"?)[.])?("?[^".[:space:]]+"?)/,m)) {
            if (m[3]!="") sch=unq(m[3]); tbl=unq(m[4])
          }
          reg = (tbl!="" ? (sch!="" ? sch "." tbl : tbl) : "")
          if (reg!="") {
            printf "DO $$DECLARE r regclass := %s::regclass; cname text; BEGIN ", dq(reg)
            printf "SELECT c.conname INTO cname FROM pg_constraint c WHERE c.contype=''p'' AND c.conrelid=r; "
            printf "IF cname IS NOT NULL THEN EXECUTE format($f$ALTER TABLE %%s DROP CONSTRAINT %%I$f$, r::text, cname); END IF; END$$;\n"
          }
        }
      }
    }
    END { if (buf != "") print buf }
  ' "$file" | $psql_base -f -
}

# Ensure DB exists
if ! psql -X -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -qx 1; then
  createdb -U postgres "$DB" || true
fi

extract_bundle
echo "== Bundle contents =="; ls -la

# 0) roles
$psql_base <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='record_owner') THEN CREATE ROLE record_owner; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='record_app')   THEN CREATE ROLE record_app;   END IF;
END$$;
SQL

# A) optional cleanup
if [ "$CLEAN" = "1" ]; then
  $psql_base <<'SQL'
DROP SCHEMA IF EXISTS records_hot     CASCADE;
DROP SCHEMA IF EXISTS records_hot_iso CASCADE;
DROP SCHEMA IF EXISTS records_poc     CASCADE;
DROP SCHEMA IF EXISTS records         CASCADE;
DROP SCHEMA IF EXISTS bench           CASCADE;
DROP SCHEMA IF EXISTS auth            CASCADE;
SQL
fi

# B) extensions
$psql_base <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL

# C) bootstrap auth.users WITHOUT PK/UNIQUE
$psql_base <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id            uuid DEFAULT gen_random_uuid(),
  email         citext,
  password_hash text,
  settings      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_pkey';
    EXECUTE 'ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_email_key';
    EXECUTE 'DROP INDEX IF EXISTS auth.users_pkey';
    EXECUTE 'DROP INDEX IF EXISTS auth.users_email_key';
  END IF;
END$$;
SQL

# Detect functions in schema.sql
schema_has_funcs=0
if [ -f schema.sql ] && grep -Eiq '^[[:space:]]*CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]' schema.sql; then
  schema_has_funcs=1
fi

# D) functions: only if not present in schema.sql
if [ -f functions.sql ] && [ "$schema_has_funcs" -eq 0 ]; then
  strip_backslash_meta < functions.sql \
    | sanitize_psql_transcript \
    | soften_create_function \
    | $psql_base -f -
fi

# D0) drop existing MVs in app schema
$psql_base <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, matviewname FROM pg_matviews WHERE schemaname='records' LOOP
    EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %I.%I CASCADE', r.schemaname, r.matviewname);
  END LOOP;
END$$;
SQL

# D1.5) pre-drop PKs for tables that schema.sql will (re)add a PK for
predrop_primary_keys_from_file "schema.sql"

# E) schema: sanitize + soften + DO-guards (no backslash commands)
if [ -f schema.sql ]; then
  strip_backslash_meta < schema.sql \
    | sanitize_psql_transcript \
    | soften_create_schema_and_extension \
    | soften_create_function \
    | soften_create_view \
    | soften_create_table_index_sequence \
    | guard_add_constraint_do \
    | guard_create_matview_do \
    | $psql_base -f -
fi

# F) other *.sql with same pipeline (+ per-file PK pre-drop)
for f in *.sql; do
  case "$f" in schema.sql|functions.sql|globals.sql) continue;; esac
  echo ">> applying $f"
  predrop_primary_keys_from_file "$f"
  strip_backslash_meta < "$f" \
    | sanitize_psql_transcript \
    | soften_create_schema_and_extension \
    | soften_create_function \
    | soften_create_view \
    | soften_create_table_index_sequence \
    | guard_add_constraint_do \
    | guard_create_matview_do \
    | $psql_base -f -
done

# G) refresh MVs
$psql_base <<'SQL'
DO $$
BEGIN
  IF to_regclass('records.aliases_mv')    IS NOT NULL THEN EXECUTE 'REFRESH MATERIALIZED VIEW records.aliases_mv';    END IF;
  IF to_regclass('records.search_doc_mv') IS NOT NULL THEN EXECUTE 'REFRESH MATERIALIZED VIEW records.search_doc_mv'; END IF;
END$$;
SQL

# H) grants
$psql_base <<'SQL'
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
           WHERE nspname IN ('public','auth','records','records_hot','records_poc','records_hot_iso')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO record_app', s);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA %I TO record_app', s);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO record_app', s);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='public')  THEN EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public  TO record_app'; END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='records') THEN EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA records TO record_app'; END IF;

  FOR s IN SELECT nspname FROM pg_namespace
           WHERE nspname IN ('public','auth','records','records_hot','records_poc','records_hot_iso')
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA %I GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO record_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO record_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres     IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO record_app', s);
  END LOOP;
END$$;
SQL

echo "RESTORE_DONE_OK ✅"
