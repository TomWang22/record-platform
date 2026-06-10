#!/usr/bin/env bash
# Phase B–E: explicit tarball list → Protocol v1 + extract_and_analyze → OCH rewrite scans →
# BUNDLE_CLASSIFICATION_SUMMARY.md (regenerated). Does not mutate repo or staging content beyond protocol.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RP_REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DOCS="$REPO_ROOT/docs/bundles"
HOME_DIR="${HOME:?}"
STAGING_ROOT="${BUNDLE_STAGING_ROOT:-$HOME_DIR/bundle-staging}"

STEMS=(
  kafka-kraft-3broker-chaos-suite-bundle-20260418-022748
  och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502
  preflight-cluster-quic-scripts-20260418-165316
  preflight-cluster-quic-scripts-20260418-165326
  preflight-cluster-quic-scripts-20260418-165415
  record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410
  record-platform-kafka-kraft-3broker-kafka-certs-20260410
  record-platform-kafka-metallb-tls-reference-20260409
  record-platform-kafka-observability-proto-reference-20260410
  record-platform-kafka-ops-certs-alignment-cron-preflight-20260410
  record-platform-makefile-golden-snapshot-kafka-chaos-20260410
  record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410
  record-platform-och-full-scripts-infra-reference-20260410-1245
  record-platform-och-preflight-cert-kafka-bundle-20260418-025117
  record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409
  record-platform-och-preflight-scale-transport-v7b-20260418-011819
  record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410
  record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409
  record-platform-quic-transport-porting-bundle-20260416-192801
  record.test-och-housing-20260418-161510
)

BUNDLE_TARBALLS=""
missing=0
for stem in "${STEMS[@]}"; do
  f="$HOME_DIR/${stem}.tar.gz"
  if [[ ! -f "$f" ]]; then
    echo "MISSING: $f" >&2
    missing=1
  fi
  BUNDLE_TARBALLS+=" $f"
done
if [[ "$missing" -ne 0 ]]; then
  echo "Abort: one or more archives missing under $HOME_DIR" >&2
  exit 1
fi

echo "=== Phase B: Protocol v1 + analysis (explicit list) ==="
export BUNDLE_TARBALLS
export RP_REPO_ROOT="$REPO_ROOT"
export BUNDLE_STAGING_ROOT="$STAGING_ROOT"
"$SCRIPT_DIR/extract_and_analyze.sh"

echo ""
echo "=== Phase C: OCH → RP rewrite scan per staging tree ==="
CLASS_TMP="$(mktemp)"
trap 'rm -f "$CLASS_TMP"' EXIT
for stem in "${STEMS[@]}"; do
  stage="$STAGING_ROOT/$stem"
  if [[ ! -d "$stage" ]]; then
    echo "ERROR: staging missing for $stem ($stage)" >&2
    exit 1
  fi
  out_md="$DOCS/OCH_TO_RP_REWRITE_${stem}.md"
  python3 "$SCRIPT_DIR/och_to_rp_rewrite_scan.py" \
    --staging "$stage" \
    --stem "$stem" \
    --output "$out_md" \
    --print-classification >>"$CLASS_TMP"
done

echo ""
echo "=== Phase C2: OCH → RP unified-diff patches (generated only; not applied) ==="
MATRIX="$DOCS/OCH_TO_RP_CONVERSION_MATRIX.md"
for stem in "${STEMS[@]}"; do
  stage="$STAGING_ROOT/$stem"
  patch_out="$DOCS/OCH_TO_RP_PATCH_${stem}.patch"
  python3 "$SCRIPT_DIR/generate_namespace_patch_v1.py" \
    --staging-dir "$stage" \
    --conversion-matrix "$MATRIX" \
    --output "$patch_out"
done

echo ""
echo "=== Phase D: classification summary ==="
python3 - "$REPO_ROOT" "$CLASS_TMP" <<'PY'
import pathlib, sys, datetime as dt

repo, tmp = sys.argv[1:3]
docs = pathlib.Path(repo) / "docs" / "bundles"
rows = []
for line in pathlib.Path(tmp).read_text(encoding="utf-8").splitlines():
    if not line.startswith("CLASSIFICATION\t"):
        continue
    _, stem, cat, total = line.split("\t", 3)
    note = ""
    if stem in (
        "preflight-cluster-quic-scripts-20260418-165316",
        "preflight-cluster-quic-scripts-20260418-165326",
    ):
        note = "Superseded for QUIC closure comparison by `preflight-cluster-quic-scripts-20260418-165415`."
    rows.append((stem, cat, total, note))

ts = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
lines = [
    "# Bundle classification summary (controlled conversion sweep)",
    "",
    f"**Generated:** {ts}",
    "",
    "Deterministic sweep: explicit `~/` tarballs → Protocol v1 → `och_to_rp_rewrite_scan.py`.",
    "No repo or staging content was auto-rewritten.",
    "",
    "| Archive stem | Category | OCH scan hits (text) | Notes |",
    "|--------------|----------|----------------------:|-------|",
]
for stem, cat, total, note in rows:
    esc = note.replace("|", "\\|")
    lines.append(f"| `{stem}` | {cat} | {total} | {esc} |")
lines += [
    "",
    "## Category meanings",
    "",
    "| Category | Meaning |",
    "|----------|---------|",
    "| RP-native (no OCH strings in scanned text) | Scanned text files show no OCH namespace/SNI/och-* tokens in this pass. |",
    "| Mostly RP-native | Few hits; likely cosmetic or isolated docs. |",
    "| OCH-configured | Many hits; expect namespace/SNI/secret rewrites using the conversion matrix. |",
    "| Golden snapshot | Large combined reference tree — not a wholesale import target. |",
    "| Packaging-heavy / golden Makefile tree | Makefile / chaos / golden packaging — usually ignore except targeted scripts. |",
    "",
    "## Related outputs",
    "",
    "- `OCH_TO_RP_REWRITE_<stem>.md` — per-bundle hit mapping",
    "- `OCH_TO_RP_PATCH_<stem>.patch` — unified diff from matrix (review; never auto-applied)",
    "- `BUNDLE_ANALYSIS_<stem>.md` — parity + buckets",
    "- `INTEGRITY_<stem>.json` / `CHECKSUM_RECORD_<stem>.txt` — protocol artifacts",
    "- `OCH_TO_RP_CONVERSION_MATRIX.md` — canonical string replacements",
    "",
]
path = docs / "BUNDLE_CLASSIFICATION_SUMMARY.md"
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Wrote {path}")
PY

echo ""
echo "=== Phase E: conversion matrix ==="
echo "Reference: $DOCS/OCH_TO_RP_CONVERSION_MATRIX.md (committed; edit there when RP naming evolves)."

echo ""
echo "Done."
echo "  Staging: $STAGING_ROOT (frozen per bundle)"
echo "  Reports:  $DOCS/OCH_TO_RP_REWRITE_*.md"
echo "  Patches:  $DOCS/OCH_TO_RP_PATCH_*.patch"
echo "  Summary:  $DOCS/BUNDLE_CLASSIFICATION_SUMMARY.md"
