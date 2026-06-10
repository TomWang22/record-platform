#!/usr/bin/env bash
# Bundle Extraction Protocol v1 — deterministic, forensic-grade extract (never repo root).
# Usage: RP_REPO_ROOT=/path/to/repo BUNDLE_STAGING_ROOT=... ./extract_bundle_v1.sh /path/to/archive.tar.gz
#
# Phases: 0 checksum + record → 1 index-only validate → 2 extract → 3 manifest match →
#         4 per-file SHA256 → 5 case collision → 6 freeze (chmod -R a-w).
#
# Prohibitions: never mutates tarball; never -P; never extracts into repo; never git add.

set -euo pipefail

usage() {
  echo "Usage: $0 /path/to/archive.tar.gz" >&2
  exit 2
}

[[ "${1:-}" ]] || usage
ARCHIVE_IN="$1"
[[ -f "$ARCHIVE_IN" ]] || { echo "Archive not found: $ARCHIVE_IN" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="$(cd "$(dirname "$ARCHIVE_IN")" && pwd)/$(basename "$ARCHIVE_IN")"
STEM="$(basename "$ARCHIVE" .tar.gz)"
STAGING_ROOT="${BUNDLE_STAGING_ROOT:-$HOME/bundle-staging}"
REPO_ROOT="${RP_REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DOCS_BUNDLES="$REPO_ROOT/docs/bundles"
PROTO_META="$STAGING_ROOT/.protocol/$STEM"
STAGING="$STAGING_ROOT/$STEM"

mkdir -p "$PROTO_META" "$DOCS_BUNDLES" "$STAGING_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Bundle Extraction Protocol v1 — $STEM"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# --- Phase 0: immutable archive verification ---
echo "== Phase 0: SHA256 + CHECKSUM_RECORD =="

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

ACTUAL="$(sha256_file "$ARCHIVE")"
EXPECTED=""
SIDE_SRC="none"
for s in "$(dirname "$ARCHIVE")/${STEM}.sha256" "$DOCS_BUNDLES/${STEM}.sha256"; do
  if [[ -f "$s" ]]; then
    EXPECTED="$(head -1 "$s" | awk '{print $1}')"
    SIDE_SRC="$s"
    break
  fi
done

if [[ -n "$EXPECTED" && "$EXPECTED" != "$ACTUAL" ]]; then
  echo "ERROR: SHA256 mismatch (refuse to extract)." >&2
  echo "  expected: $EXPECTED (from $SIDE_SRC)" >&2
  echo "  actual:   $ACTUAL" >&2
  exit 1
fi

if [[ -f "${ARCHIVE}.sha256" ]]; then
  echo "Verifying adjacent sidecar with shasum -c …"
  (cd "$(dirname "$ARCHIVE")" && shasum -a 256 -c "${STEM}.sha256") || {
    echo "ERROR: shasum -c failed for ${ARCHIVE}.sha256" >&2
    exit 1
  }
fi

TS="$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).isoformat())')"
{
  echo "ARCHIVE_SHA256=$ACTUAL"
  echo "ARCHIVE_PATH=$ARCHIVE"
  echo "SIDECAR_PATH=$SIDE_SRC"
  echo "SIDECAR_HASH_EXPECTED=$EXPECTED"
  echo "RECORDED_AT_UTC=$TS"
  echo "PROTOCOL=bundle_extraction_v1"
} >"$DOCS_BUNDLES/CHECKSUM_RECORD_${STEM}.txt"

echo "Wrote $DOCS_BUNDLES/CHECKSUM_RECORD_${STEM}.txt"

# --- Phase 1: safe index inspection (no extract) ---
echo "== Phase 1: validate_bundle_v1.py (index-only) =="

MANIFEST_TAR="$PROTO_META/manifest.tar.files.txt"
python3 "$SCRIPT_DIR/validate_bundle_v1.py" "$ARCHIVE" \
  --emit-manifest-files "$MANIFEST_TAR" \
  --json-out "$PROTO_META/integrity.pre.json"

# Belt-and-suspenders: reject obvious bad paths in raw tar listing
RAW_LIST="$PROTO_META/manifest.raw.all.txt"
tar -tzf "$ARCHIVE" | LC_ALL=C sort >"$RAW_LIST"
if grep -E '(^|/)\.\.(/|$)|^/' "$RAW_LIST" >/dev/null 2>&1; then
  echo "ERROR: raw tar listing contains absolute or traversal paths." >&2
  exit 1
fi

# --- Phase 2: controlled staging extract ---
echo "== Phase 2: controlled extract (staging only) =="

chmod u+rwX "$STAGING_ROOT" 2>/dev/null || true
if [[ -d "$STAGING" ]] && [[ -n "$(ls -A "$STAGING" 2>/dev/null)" ]]; then
  chmod -R u+rwX "$STAGING" 2>/dev/null || true
  bak="${STAGING}.bak.$(date +%Y%m%d%H%M%S)"
  echo "Versioning existing staging -> $bak"
  if ! mv "$STAGING" "$bak"; then
    echo "ERROR: could not rename frozen staging to $bak (check permissions on $STAGING_ROOT)." >&2
    exit 1
  fi
fi
mkdir -p "$STAGING"

tar -xzf "$ARCHIVE" -C "$STAGING" --no-same-owner --no-same-permissions

# --- Phase 3: post-extract structural validation ---
echo "== Phase 3: extracted file list vs tar file index =="

MANIFEST_EXT="$PROTO_META/manifest.extracted.files.txt"
export MANIFEST_EXT_PATH="$MANIFEST_EXT"
export BUNDLE_DISK_MANIFEST_STAGING="$STAGING"
PYTHONPATH="$SCRIPT_DIR" python3 -c "
from pathlib import Path
import os
from bundle_audit_lib import disk_regular_files_sorted
p = Path(os.environ['BUNDLE_DISK_MANIFEST_STAGING'])
lines = disk_regular_files_sorted(p)
Path(os.environ['MANIFEST_EXT_PATH']).write_text(
    '\n'.join(lines) + ('\n' if lines else ''), encoding='utf-8'
)
"

if ! cmp -s "$MANIFEST_TAR" "$MANIFEST_EXT"; then
  echo "ERROR: extracted files do not match tar file index (lossless contract failed)." >&2
  diff -u "$MANIFEST_TAR" "$MANIFEST_EXT" | head -120 >&2 || true
  exit 1
fi
echo "Manifest match OK ($(wc -l <"$MANIFEST_TAR" | tr -d ' ') files)."

# --- Phase 4: per-file SHA256 inventory ---
echo "== Phase 4: MANIFEST.sha256.txt in staging =="

(
  cd "$STAGING"
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    shasum -a 256 "$f"
  done <"$MANIFEST_EXT"
) >"$STAGING/MANIFEST.sha256.txt"

# --- Phase 5: case-insensitive collision detection (macOS) ---
echo "== Phase 5: case collision check =="

export BUNDLE_CASECHECK_STAGING="$STAGING"
if ! PYTHONPATH="$SCRIPT_DIR" python3 -c "
import os, sys
from collections import Counter
from pathlib import Path
from bundle_audit_lib import disk_regular_files_sorted
lines = disk_regular_files_sorted(Path(os.environ['BUNDLE_CASECHECK_STAGING']))
low = [x.lower() for x in lines]
dups = [k for k, v in Counter(low).items() if v > 1]
if dups:
    print('\n'.join(dups))
    sys.exit(1)
"; then
  echo "ERROR: case-insensitive filename collision (see lines above)." >&2
  exit 1
fi

ROOT_JSON="$(python3 -c "import json; print(json.dumps(json.load(open('$PROTO_META/integrity.pre.json')).get('root_layout')))")"
echo "Root layout (record only): $ROOT_JSON"

# --- Phase 6: freeze staging ---
echo "== Phase 6: freeze staging (chmod -R a-w) =="

chmod -R a-w "$STAGING"

# --- Integrity record (machine-readable) ---
python3 - "$PROTO_META" "$STEM" "$STAGING" "$DOCS_BUNDLES" "$ARCHIVE" "$ACTUAL" <<'PY'
import json, pathlib, sys, datetime

proto, stem, staging, docs, archive, sha = sys.argv[1:7]
pre = json.loads(pathlib.Path(proto, "integrity.pre.json").read_text(encoding="utf-8"))
out = {
    "bundle_extraction_protocol": "v1",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "archive": archive,
    "archive_sha256": sha,
    "staging_path": staging,
    "archive_root_layout": pre.get("root_layout"),
    "pre_extract": {k: pre.get(k) for k in ("safe", "issues", "warnings", "file_member_count")},
    "post_extract": {
        "manifest_tar_equals_find": True,
        "file_count": pre.get("file_member_count"),
        "case_collision_free": True,
        "staging_frozen_read_only": True,
        "apple_double_neutral_manifest": True,
    },
    "explicit_non_actions": [
        "tarball_not_mutated",
        "no_line_endings_normalized",
        "no_top_level_strip_rewrite",
        "no_repo_copy",
        "no_git_add",
    ],
}
pathlib.Path(docs, f"INTEGRITY_{stem}.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
print(pathlib.Path(docs, f"INTEGRITY_{stem}.json"))
PY

echo "Protocol v1 complete."
echo "Staging: $STAGING (read-only)"
echo "Meta:    $PROTO_META"
