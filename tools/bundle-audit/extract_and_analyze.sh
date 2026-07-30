#!/usr/bin/env bash
# Controlled bundle ingestion: verify checksum, extract to ~/bundle-staging, analyze vs repo.
# See docs/bundles/BUNDLE_INGESTION_POLICY.md
#
# Env:
#   BUNDLE_STAGING_ROOT  default: $HOME/bundle-staging
#   BUNDLE_ARCHIVE_DIR   default: $HOME (scanned for lab tarballs)
#   BUNDLE_TARBALLS      space-separated list (skips discovery)
#   RP_REPO_ROOT         default: two levels up from this script (repo root)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RP_REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STAGING_ROOT="${BUNDLE_STAGING_ROOT:-$HOME/bundle-staging}"
ARCHIVE_SCAN="${BUNDLE_ARCHIVE_DIR:-$HOME}"
DOCS_BUNDLES="$REPO_ROOT/docs/bundles"

discover_tarballs() {
  if [[ -n "${BUNDLE_TARBALLS:-}" ]]; then
    # shellcheck disable=SC2086
    for f in $BUNDLE_TARBALLS; do
      [[ -f "$f" ]] || { echo "Not a file: $f" >&2; return 1; }
      echo "$f"
    done
    return 0
  fi
  shopt -s nullglob
  local f b
  local -a hits=()
  for f in \
    "$ARCHIVE_SCAN"/record-platform*.tar.gz \
    "$ARCHIVE_SCAN"/preflight-cluster-quic*.tar.gz \
    "$ARCHIVE_SCAN"/kafka-kraft*.tar.gz \
    "$ARCHIVE_SCAN"/rp-preflight*.tar.gz \
    "$ARCHIVE_SCAN"/record.test*.tar.gz; do
    [[ -f "$f" ]] || continue
    b=$(basename "$f")
    case "$b" in
      *20260409*|*20260410*|*20260411*|*20260412*|*20260413*|*20260414*|*20260415*|*20260416*|*20260417*|*20260418*)
        hits+=("$f")
        ;;
    esac
  done
  shopt -u nullglob
  if [[ ${#hits[@]} -eq 0 ]]; then
    echo "No tarballs matched under $ARCHIVE_SCAN (expected *20260409* … *20260418*)." >&2
    echo "Set BUNDLE_TARBALLS to a space-separated list of paths." >&2
    return 1
  fi
  printf '%s\n' "${hits[@]}" | sort -u
}

process_one() {
  local tar="$1"
  local stem abs out_md tmp_hdr mech_tmp integrity_path checksum_path
  stem=$(basename "$tar" .tar.gz)
  abs=$(cd "$(dirname "$tar")" && pwd)/$(basename "$tar")
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Bundle: $stem"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  mkdir -p "$STAGING_ROOT" "$DOCS_BUNDLES"
  RP_REPO_ROOT="$REPO_ROOT" BUNDLE_STAGING_ROOT="$STAGING_ROOT" \
    "$SCRIPT_DIR/extract_bundle_v1.sh" "$abs"

  out_md="$DOCS_BUNDLES/BUNDLE_ANALYSIS_${stem}.md"
  mech_tmp=$(mktemp "/tmp/mechanical_${stem}.XXXXXX")
  python3 "$SCRIPT_DIR/mechanical_parity_tar_vs_repo.py" "$abs" --repo "$REPO_ROOT" | tee "$mech_tmp" >/dev/null
  python3 "$SCRIPT_DIR/bundle_ingestion_analyze.py" \
    --staging "$STAGING_ROOT/$stem" \
    --repo "$REPO_ROOT" \
    --tarball "$abs" \
    --output "$out_md"

  integrity_path="$DOCS_BUNDLES/INTEGRITY_${stem}.json"
  checksum_path="$DOCS_BUNDLES/CHECKSUM_RECORD_${stem}.txt"

  tmp_hdr=$(mktemp)
  {
    echo "## Bundle Extraction Protocol v1"
    echo ""
    echo "Extraction used \`tools/bundle-audit/extract_bundle_v1.sh\` (verify → index validate → extract → manifest match → per-file SHA256 → case check → freeze)."
    echo ""
    echo "- **CHECKSUM_RECORD:** \`$checksum_path\`"
    echo "- **INTEGRITY (machine):** \`$integrity_path\`"
    echo ""
    if [[ -f "$integrity_path" ]]; then
      echo "### INTEGRITY summary"
      echo ""
      echo '```json'
      sed -n '1,80p' "$integrity_path"
      if [[ $(wc -l <"$integrity_path") -gt 80 ]]; then
        echo "... (truncated)"
      fi
      echo '```'
      echo ""
    fi
    echo "## Mechanical parity (tar index vs repo)"
    echo ""
    echo '```text'
    sed -n '1,120p' "$mech_tmp"
    if [[ $(wc -l <"$mech_tmp") -gt 120 ]]; then
      echo "... (truncated; re-run mechanical_parity_tar_vs_repo.py for full list)"
    fi
    echo '```'
    echo ""
    echo "---"
    echo ""
  } >"$tmp_hdr"
  cat "$tmp_hdr" "$out_md" >"${out_md}.new"
  mv "${out_md}.new" "$out_md"
  rm -f "$tmp_hdr" "$mech_tmp"
  echo "→ Report: $out_md"
  echo "→ Staging: $STAGING_ROOT/$stem (read-only)"
}

main() {
  # Not `local`: EXIT trap runs after main returns and must still see this path.
  listf=$(mktemp)
  trap 'rm -f "$listf"' EXIT
  if ! discover_tarballs >"$listf"; then
    exit 1
  fi
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    process_one "$t" || exit 1
  done <"$listf"
  echo ""
  echo "Done. Staging root: $STAGING_ROOT"
  echo "Reports: $DOCS_BUNDLES/BUNDLE_ANALYSIS_*.md"
}

main "$@"
