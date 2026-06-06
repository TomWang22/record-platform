#!/usr/bin/env bash
# Write frozen per-service expected source SHA plan (run after finalizing rp-compute-source-sha.sh).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-active-image-targets.sh
source "$SCRIPT_DIR/lib/rp-active-image-targets.sh"

OUT="${RP_SOURCE_SHA_PLAN:-$REPO_ROOT/bench_logs/image-freshness/source-sha-plan.tsv}"
mkdir -p "$(dirname "$OUT")"

{
  printf 'service\texpected_sha\tinputs_summary\n'
  for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
    sha="$(bash "$SCRIPT_DIR/lib/rp-compute-source-sha.sh" "$svc")"
    summary="$(bash "$SCRIPT_DIR/lib/rp-source-sha-inputs-summary.sh" "$svc")"
    printf '%s\t%s\t%s\n' "$svc" "$sha" "$summary"
  done
} >"$OUT"

echo "✅ wrote $OUT ($(wc -l <"$OUT" | tr -d ' ') lines)"
