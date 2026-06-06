#!/usr/bin/env bash
# Compare OCH 5444-messaging vs RP runtime 5434-messaging dumps (schema + artifacts).
# Fails on unexpected drift. Documented diffs: infra/contracts/messaging-dump-diff-allowlist.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

OCH_DIR="${OCH_DIR:-$REPO_ROOT/backups/all-8-20260517-152701}"
RP_DIR="${RP_DIR:-$REPO_ROOT/backups/hybrid-rp-och/materialized-rp-runtime}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/bench_logs/messaging-dump-compare}"
ALLOWLIST="${ALLOWLIST:-$REPO_ROOT/infra/contracts/messaging-dump-diff-allowlist.json}"
FORCE_DEEP="${FORCE_DEEP:-0}"

OCH_PREFIX="5444-messaging"
RP_PREFIX="5434-messaging"

die() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

mkdir -p "$OUT_DIR"

for f in dump sql.gz; do
  [[ -f "$OCH_DIR/${OCH_PREFIX}.${f}" ]] || die "Missing $OCH_DIR/${OCH_PREFIX}.${f}"
  [[ -f "$RP_DIR/${RP_PREFIX}.${f}" ]] || die "Missing $RP_DIR/${RP_PREFIX}.${f}"
done
for f in extensions.tsv pg_settings.tsv; do
  [[ -f "$OCH_DIR/${OCH_PREFIX}-${f}" ]] || die "Missing $OCH_DIR/${OCH_PREFIX}-${f}"
  [[ -f "$RP_DIR/${RP_PREFIX}-${f}" ]] || die "Missing $RP_DIR/${RP_PREFIX}-${f}"
done

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }

report_json="$OUT_DIR/report.json"
report_md="$OUT_DIR/report.md"
schema_och="$OUT_DIR/schema-och-5444.sql"
schema_rp="$OUT_DIR/schema-rp-5434.sql"
diff_sql="$OUT_DIR/diff.sql"

failures=()
notes=()

add_failure() { failures+=("$1"); }
add_note() { notes+=("$1"); }

# --- artifact parity ---
och_dump_sha="$(sha256_file "$OCH_DIR/${OCH_PREFIX}.dump")"
rp_dump_sha="$(sha256_file "$RP_DIR/${RP_PREFIX}.dump")"
och_gz_sha="$(sha256_file "$OCH_DIR/${OCH_PREFIX}.sql.gz")"
rp_gz_sha="$(sha256_file "$RP_DIR/${RP_PREFIX}.sql.gz")"
och_ext_sha="$(sha256_file "$OCH_DIR/${OCH_PREFIX}-extensions.tsv")"
rp_ext_sha="$(sha256_file "$RP_DIR/${RP_PREFIX}-extensions.tsv")"
och_pg_sha="$(sha256_file "$OCH_DIR/${OCH_PREFIX}-pg_settings.tsv")"
rp_pg_sha="$(sha256_file "$RP_DIR/${RP_PREFIX}-pg_settings.tsv")"

byte_identical_dump=0
[[ "$och_dump_sha" == "$rp_dump_sha" ]] && byte_identical_dump=1 || add_failure "dump sha256 mismatch: OCH=$och_dump_sha RP=$rp_dump_sha"
[[ "$och_gz_sha" == "$rp_gz_sha" ]] || add_failure "sql.gz sha256 mismatch"
diff -q "$OCH_DIR/${OCH_PREFIX}-extensions.tsv" "$RP_DIR/${RP_PREFIX}-extensions.tsv" >/dev/null 2>&1 \
  || add_failure "extensions.tsv content differs"
diff -q "$OCH_DIR/${OCH_PREFIX}-pg_settings.tsv" "$RP_DIR/${RP_PREFIX}-pg_settings.tsv" >/dev/null 2>&1 \
  || add_failure "pg_settings.tsv content differs"

if [[ "$byte_identical_dump" -eq 1 ]]; then
  add_note "5434-messaging.dump is byte-identical to OCH 5444-messaging.dump (materialization = copy)."
fi

# --- optional deep schema extract (pg_restore -l + docker restore) ---
schema_diff_lines=0
if [[ "$FORCE_DEEP" == "1" ]] || [[ "$byte_identical_dump" -eq 0 ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker not available; skipping deep schema restore compare"
  else
    och_cid="msg-cmp-och-$$"
    rp_cid="msg-cmp-rp-$$"
    cleanup() {
      docker rm -f "$och_cid" "$rp_cid" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT
    docker run -d --name "$och_cid" -e POSTGRES_PASSWORD=postgres postgres:16-alpine >/dev/null
    docker run -d --name "$rp_cid" -e POSTGRES_PASSWORD=postgres postgres:16-alpine >/dev/null
    for _ in $(seq 1 60); do
      docker exec "$och_cid" pg_isready -U postgres >/dev/null 2>&1 && docker exec "$rp_cid" pg_isready -U postgres >/dev/null 2>&1 && break
      sleep 1
    done
    docker exec "$och_cid" psql -U postgres -c "CREATE DATABASE och5444;" >/dev/null
    docker exec "$rp_cid" psql -U postgres -c "CREATE DATABASE rp5434;" >/dev/null
    docker cp "$OCH_DIR/${OCH_PREFIX}.dump" "$och_cid:/tmp/m.dump"
    docker cp "$RP_DIR/${RP_PREFIX}.dump" "$rp_cid:/tmp/m.dump"
    docker exec "$och_cid" pg_restore -U postgres -d och5444 --no-owner --no-acl /tmp/m.dump >/dev/null 2>&1 || true
    docker exec "$rp_cid" pg_restore -U postgres -d rp5434 --no-owner --no-acl /tmp/m.dump >/dev/null 2>&1 || true
    docker exec "$och_cid" pg_dump -U postgres -d och5444 --schema-only --no-owner --no-privileges \
      | sed -E 's/^--.*$//; /^$/d' >"$schema_och"
    docker exec "$rp_cid" pg_dump -U postgres -d rp5434 --schema-only --no-owner --no-privileges \
      | sed -E 's/^--.*$//; /^$/d' >"$schema_rp"
    if ! diff -u "$schema_och" "$schema_rp" >"$diff_sql" 2>&1; then
      schema_diff_lines="$(wc -l <"$diff_sql" | tr -d ' ')"
      if [[ -f "$ALLOWLIST" ]] && command -v python3 >/dev/null 2>&1; then
        python3 - "$ALLOWLIST" "$diff_sql" <<'PY' || add_failure "schema diff not fully allowlisted (see diff.sql)"
import json, re, sys
allow_path, diff_path = sys.argv[1], sys.argv[2]
with open(allow_path) as f:
    allow = json.load(f)
patterns = [re.compile(p) for p in allow.get("diff_line_patterns", [])]
with open(diff_path) as f:
    lines = [ln for ln in f if ln.startswith("+") or ln.startswith("-")]
    if not lines:
        sys.exit(0)
    if not patterns:
        print("unallowlisted schema diff lines:", len(lines), file=sys.stderr)
        sys.exit(1)
    for ln in lines:
        if not any(p.search(ln) for p in patterns):
            print("unallowlisted:", ln[:120], file=sys.stderr)
            sys.exit(1)
sys.exit(0)
PY
      else
        add_failure "schema diff ($schema_diff_lines lines) — set allowlist or fix materialization"
      fi
    else
      : >"$diff_sql"
      ok "Deep schema-only dumps match after normalization"
    fi
  fi
else
  echo "-- byte-identical custom-format dumps; deep pg_restore schema extract skipped (set FORCE_DEEP=1 to run)" >"$schema_och"
  cp "$schema_och" "$schema_rp"
  : >"$diff_sql"
  ok "Skipped docker deep compare (byte-identical dumps)"
fi

# --- row counts from pg_restore -l (TOC) when dumps match ---
if [[ "$byte_identical_dump" -eq 1 ]]; then
  pg_restore -l "$OCH_DIR/${OCH_PREFIX}.dump" 2>/dev/null | awk '/TABLE DATA/ {print}' | sort >"$OUT_DIR/toc-table-data.txt" || true
fi

# --- reports ---
status="pass"
[[ ${#failures[@]} -gt 0 ]] && status="fail"

{
  echo "# Messaging dump compare"
  echo ""
  echo "Generated: $(date -Iseconds 2>/dev/null || date)"
  echo ""
  echo "| Artifact | OCH sha256 | RP sha256 | Match |"
  echo "|----------|------------|-----------|-------|"
  echo "| dump | \`${och_dump_sha:0:16}…\` | \`${rp_dump_sha:0:16}…\` | $([[ $byte_identical_dump -eq 1 ]] && echo yes || echo no) |"
  echo "| sql.gz | \`${och_gz_sha:0:16}…\` | \`${rp_gz_sha:0:16}…\` | $([[ $och_gz_sha == $rp_gz_sha ]] && echo yes || echo no) |"
  echo "| extensions.tsv | \`${och_ext_sha:0:16}…\` | \`${rp_ext_sha:0:16}…\` | $([[ $och_ext_sha == $rp_ext_sha ]] && echo yes || echo no) |"
  echo "| pg_settings.tsv | \`${och_pg_sha:0:16}…\` | \`${rp_pg_sha:0:16}…\` | $([[ $och_pg_sha == $rp_pg_sha ]] && echo yes || echo no) |"
  echo ""
  echo "Status: **$status**"
  if [[ ${#failures[@]} -gt 0 ]]; then
    echo ""
    echo "## Failures"
    for f in "${failures[@]}"; do echo "- $f"; done
  fi
  if [[ ${#notes[@]} -gt 0 ]]; then
    echo ""
    echo "## Notes"
    for n in "${notes[@]}"; do echo "- $n"; done
  fi
} >"$report_md"

python3 - <<PY
import json, pathlib
out = pathlib.Path("$report_json")
out.write_text(json.dumps({
  "status": "$status",
  "och_dir": "$OCH_DIR",
  "rp_dir": "$RP_DIR",
  "byte_identical_dump": bool($byte_identical_dump),
  "sha256": {"och_dump": "$och_dump_sha", "rp_dump": "$rp_dump_sha"},
  "failures": $(printf '%s\n' "${failures[@]:-}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))'),
  "notes": $(printf '%s\n' "${notes[@]:-}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))'),
  "schema_diff_lines": int("${schema_diff_lines:-0}"),
}, indent=2) + "\n")
PY

echo ""
echo "Report: $report_md"
echo "JSON:   $report_json"

if [[ "$status" == "fail" ]]; then
  die "Messaging dump compare failed (${#failures[@]} issue(s))"
fi
ok "Messaging dumps are equivalent (OCH 5444 → RP 5434 lineage verified)"
