#!/usr/bin/env bash
# Verify rp-platform-no-booking-bundle tarball layout and exclusions (no extract required).
# Handles archives whose paths are prefixed with rp-platform-no-booking-bundle/.
#
# Usage: bash scripts/check-no-booking-bundle.sh [/path/to/bundle.tar.gz]
set -euo pipefail

TARBALL="${1:-}"
if [[ -z "$TARBALL" ]]; then
  TARBALL="$(ls -t "$HOME"/rp-platform-no-booking-bundle-*.tar.gz 2>/dev/null | head -1 || true)"
fi
if [[ -z "$TARBALL" || ! -f "$TARBALL" ]]; then
  echo "ERROR: tarball not found (pass path or place rp-platform-no-booking-bundle-*.tar.gz in \$HOME)" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
LIST_FILE="$WORKDIR/tar-list.txt"
STRIPPED="$WORKDIR/stripped-list.txt"

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "== Tarball =="
ls -lh "$TARBALL"

echo
echo "== SHA-256 =="
shasum -a 256 "$TARBALL"

echo
echo "== Listing archive =="
tar -tzf "$TARBALL" >"$LIST_FILE"
wc -l "$LIST_FILE"

# Detect bundle prefix (first path component when all entries share one root dir).
BUNDLE_PREFIX=""
mapfile -t TOP_DIRS < <(awk -F/ '{print $1}' "$LIST_FILE" | sort -u)
if [[ ${#TOP_DIRS[@]} -eq 1 ]]; then
  BUNDLE_PREFIX="${TOP_DIRS[0]}"
fi

if [[ -n "$BUNDLE_PREFIX" ]]; then
  echo
  echo "== Bundle prefix: $BUNDLE_PREFIX/ =="
  sed "s|^${BUNDLE_PREFIX}/||" "$LIST_FILE" >"$STRIPPED"
else
  echo
  echo "== Bundle prefix: (none — paths at archive root) =="
  cp "$LIST_FILE" "$STRIPPED"
fi

echo
echo "== Top-level entries (inside bundle) =="
awk -F/ 'NF==1{print} NF>=2 && $2==""{print $1}' "$STRIPPED" | sort -u | head -40

path_ok() {
  local rel="$1"
  grep -qE "^${rel}(/|$)" "$STRIPPED"
}

file_ok() {
  local rel="$1"
  grep -qx "$rel" "$STRIPPED"
}

echo
echo "== Required top-level folders =="
required_dirs=(
  .github artifacts certs diagrams docker docs infra k8s monitoring observability
  proto reports schemas scripts services testd tests tools webapp backups
)
missing=0
for dir in "${required_dirs[@]}"; do
  if path_ok "$dir"; then
    echo "OK: $dir"
  else
    echo "MISSING: $dir"
    missing=1
  fi
done

echo
echo "== Required root files =="
required_files=(
  Makefile package.json pnpm-lock.yaml Caddyfile BUILD.md Runbook.md ENGINEERING.md
  README_BUNDLE.txt EXCLUDED.txt MANIFEST.txt
)
for file in "${required_files[@]}"; do
  if file_ok "$file"; then
    echo "OK: $file"
  else
    echo "MISSING: $file"
    missing=1
  fi
done

echo
echo "== Key paths (docker / infra) =="
for p in \
  docker/caddy-with-tcpdump \
  docker/envoy-with-tcpdump \
  infra/k8s \
  infra/db \
  infra/grafana \
  infra/observability \
  infra/monitoring \
  monitoring/prometheus-rules \
  backups/all-8-20260517-152701; do
  if path_ok "$p"; then echo "OK: $p"; else echo "MISSING: $p"; missing=1; fi
done

echo
echo "== Forbidden runnable booking paths =="
forbidden_patterns=(
  '^services/reservation-mesh(/|$)'
  '^infra/k8s/base/reservation-mesh(/|$)'
  '^proto/booking\.proto$'
  '^proto/events/booking\.proto$'
  '^infra/k8s/base/config/proto/booking\.proto$'
  '^infra/db/.*booking.*\.sql$'
  '5443-bookings'
  '^testd/physical/bookings\.'
  '^tests/system/booking-analytics\.contract\.test\.ts$'
)
bad=0
for pattern in "${forbidden_patterns[@]}"; do
  if grep -Ei "$pattern" "$STRIPPED"; then
    echo "FORBIDDEN MATCH: $pattern"
    bad=1
  else
    echo "OK excluded: $pattern"
  fi
done

echo
echo "== Forbidden local/cache paths =="
local_patterns=(
  '(^|/)\.git(/|$)'
  '(^|/)node_modules(/|$)'
  '(^|/)bench_logs(/|$)'
  '(^|/)\.build-cache(/|$)'
  '(^|/)\.reissue-tmp\.'
  '(^|/)\.venv-'
)
for pattern in "${local_patterns[@]}"; do
  if grep -Ei "$pattern" "$STRIPPED"; then
    echo "FORBIDDEN LOCAL MATCH: $pattern"
    bad=1
  else
    echo "OK excluded: $pattern"
  fi
done

echo
echo "== Inspect patched files (extract) =="
if [[ -n "$BUNDLE_PREFIX" ]]; then
  tar -xzf "$TARBALL" -C "$WORKDIR" \
    "${BUNDLE_PREFIX}/README_BUNDLE.txt" \
    "${BUNDLE_PREFIX}/EXCLUDED.txt" \
    "${BUNDLE_PREFIX}/MANIFEST.txt" \
    "${BUNDLE_PREFIX}/scripts/bootstrap-all-dbs.sh" \
    "${BUNDLE_PREFIX}/infra/k8s/base/kustomization.yaml" 2>/dev/null || true
  DOC_ROOT="$WORKDIR/$BUNDLE_PREFIX"
else
  tar -xzf "$TARBALL" -C "$WORKDIR" \
    README_BUNDLE.txt EXCLUDED.txt MANIFEST.txt \
    scripts/bootstrap-all-dbs.sh infra/k8s/base/kustomization.yaml 2>/dev/null || true
  DOC_ROOT="$WORKDIR"
fi

echo "--- bootstrap-all-dbs.sh (bookings call) ---"
grep -n bootstrap_bookings "$DOC_ROOT/scripts/bootstrap-all-dbs.sh" 2>/dev/null || echo "(file missing)"

echo "--- kustomization.yaml (reservation-mesh resource) ---"
grep -n reservation-mesh "$DOC_ROOT/infra/k8s/base/kustomization.yaml" 2>/dev/null || echo "(no reservation-mesh line — OK)"

echo
echo "== Booking path report (documentation vs runnable) =="
echo "--- Runnable leftovers (must be empty) ---"
grep -Ei '^(services/infra/k8s/base/proto/booking\.proto|proto/events/booking\.proto|infra/db/.*booking.*\.sql|.*5443-bookings)' "$STRIPPED" || echo "(none)"

echo "--- Docs / text mentioning booking (informational only) ---"
grep -Ei 'booking' "$STRIPPED" | grep -Ei '^docs/|^README|^Runbook|BOOKING' | head -20 || echo "(none in first 20 doc hits)"

echo
echo "== Deep scan (runnable reservation-mesh paths only) =="
if grep -Ei '^(services/infra/k8s/base/proto/booking\.proto|proto/events/booking\.proto|.*5443-bookings)' "$STRIPPED"; then
  echo "WARNING: runnable booking paths still in archive."
  bad=1
else
  echo "OK: no runnable reservation-mesh path leftovers."
fi

echo
echo "== Result =="
if [[ "$missing" -ne 0 || "$bad" -ne 0 ]]; then
  echo "FAIL: bundle is missing required content or includes forbidden booking/cache paths."
  exit 1
fi
echo "PASS: bundle path verifier passed"
