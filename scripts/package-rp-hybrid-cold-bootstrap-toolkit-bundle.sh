#!/usr/bin/env bash
# Record Platform hybrid cold-bootstrap toolkit (NOT rp-cold-bootstrap-toolkit-*).
#
# Output: record-platform-hybrid-cold-bootstrap-toolkit-<stamp>.tar.gz
#
# Env:
#   RP_HYBRID_TOOLKIT_INCLUDE_DUMPS=0|1  (default 0 — manifest + README only)
#   RP_HYBRID_TOOLKIT_OUT_DIR=$HOME
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${RP_HYBRID_TOOLKIT_OUT_DIR:-$HOME}"
INCLUDE_DUMPS="${RP_HYBRID_TOOLKIT_INCLUDE_DUMPS:-0}"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
TOP="record-platform-hybrid-cold-bootstrap-toolkit"
BUNDLE="$STAGE/$TOP"
ARCHIVE="$OUT_DIR/${TOP}-${STAMP}.tar.gz"

cleanup() { rm -rf "${STAGE:-}"; }
trap cleanup EXIT

mkdir -p "$BUNDLE"

RSYNC_EXCLUDES=(
  --exclude '.git'
  --exclude 'node_modules'
  --exclude '.next'
  --exclude 'dist'
  --exclude 'services/*/coverage'
  --exclude 'webapp/coverage'
  --exclude '.turbo'
  --exclude '__pycache__'
  --exclude 'bench_logs'
  --exclude '.build-cache'
  --exclude '.reissue-tmp.*'
  --exclude '.DS_Store'
  --exclude '.env'
  --exclude 'docker-compose.external-rp.yml'
  --exclude 'services/reservation-mesh'
  --exclude 'services/messaging-service'
  --exclude 'proto/events/booking.proto'
  --exclude 'proto/events/social.proto'
  --exclude 'infra/k8s/base/reservation-mesh'
  --exclude 'infra/k8s/base/messaging-service'
  --exclude 'toolkit-reference'
  --exclude 'reports/rp-cold-bootstrap-*'
  --exclude 'reports/record-platform-rp-*'
)

echo "→ rsync RP hybrid toolkit tree…"
rsync -a "${RSYNC_EXCLUDES[@]}" \
  --exclude 'backups/all-8-*' \
  --exclude 'backups/hybrid-rp-och/materialized-rp-runtime/*.dump' \
  --exclude 'backups/hybrid-rp-och/materialized-rp-runtime/*.sql.gz' \
  --exclude 'backups/hybrid-rp-och/materialized-rp-runtime/*-extensions.tsv' \
  --exclude 'backups/hybrid-rp-och/materialized-rp-runtime/*-pg_settings.tsv' \
  "$ROOT/" "$BUNDLE/"

if [[ "$INCLUDE_DUMPS" == "1" ]]; then
  echo "→ including materialized runtime dumps (large)…"
  mkdir -p "$BUNDLE/backups/hybrid-rp-och/materialized-rp-runtime"
  rsync -a \
    "$ROOT/backups/hybrid-rp-och/materialized-rp-runtime/" \
    "$BUNDLE/backups/hybrid-rp-och/materialized-rp-runtime/"
else
  mkdir -p "$BUNDLE/backups/hybrid-rp-och/materialized-rp-runtime"
  for f in manifest.json skipped.json restore-order.txt; do
    [[ -f "$ROOT/backups/hybrid-rp-och/materialized-rp-runtime/$f" ]] && \
      cp -a "$ROOT/backups/hybrid-rp-och/materialized-rp-runtime/$f" \
        "$BUNDLE/backups/hybrid-rp-och/materialized-rp-runtime/"
  done
fi

cat >"$BUNDLE/README_HYBRID_TOOLKIT.txt" <<'EOF'
Record Platform — hybrid cold-bootstrap toolkit (startup DAG)
=============================================================

NOT rp-cold-bootstrap-toolkit-*. RP runtime: Postgres 5433–5443, namespace record-platform,
host record-platform.test, k3s KRaft Kafka only (no booking/social/RP compose ports).

One command (from extracted tree):

  COLD_BOOTSTRAP_CONFIRM=yes \
  RESTORE_BACKUP_DIR=backups/hybrid-rp-och/materialized-rp-runtime \
  make cold-bootstrap

Or pin a source dump (materializes to hybrid-rp-och/materialized-rp-runtime):

  COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap

Phase order (scripts/cold-bootstrap.sh — P0 before workspace):
  P0.hard_reset → Z.colima_clean → P1.host_deps → A.workspace → B.crypto → C.infra
  → D.backup_materialization → E.restore → C.metrics → C.images → C.image_contract → F.cluster_deploy
  → G.app_runtime → H.observability → I.transport → J.final_contract

Default exits 2 INCOMPLETE at I.transport (not success). Finish with:
  COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap-post-hosts
Or one shot: HOSTS_AUTO=1 COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap

Nested make bootstrap (F.cluster_deploy) → bench_logs/bootstrap-cluster.log (BOOTSTRAP_QUIET=1).
C.infra compose → bench_logs/command-logs/C.infra/compose-up.log (not streamed).
One-shot finish: HOSTS_AUTO=1 COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap

For RP comparison: read STARTUP_FOR_OCH_REVIEW.md in this tree.

After cold-bootstrap + /etc/hosts for record-platform.test:

  make preflight-lab

See docs/porting/RP_PREFLIGHT_LAB.md (Kafka alignment suite, QUIC capture, k6 lab grid).

Verify: bash scripts/check-rp-hybrid-cold-bootstrap-toolkit.sh <archive.tar.gz>
Regenerate: bash scripts/package-rp-hybrid-cold-bootstrap-toolkit-bundle.sh
EOF

if [[ -f "$ROOT/STARTUP_FOR_OCH_REVIEW.md" ]]; then
  cp -a "$ROOT/STARTUP_FOR_OCH_REVIEW.md" "$BUNDLE/"
else
  echo "⚠️  STARTUP_FOR_OCH_REVIEW.md missing in repo — packaging without it" >&2
fi

cp -a "$ROOT/scripts/lib/rp-hybrid-toolkit-bootstrap-paths.txt" "$BUNDLE/scripts/lib/" 2>/dev/null || true

echo "→ verify bootstrap paths in bundle…"
MISS=0
while IFS= read -r rel || [[ -n "$rel" ]]; do
  [[ -z "$rel" || "$rel" =~ ^# ]] && continue
  if [[ ! -e "$BUNDLE/$rel" ]]; then
    echo "❌ bundle missing: $rel" >&2
    MISS=1
  fi
done <"$ROOT/scripts/lib/rp-hybrid-toolkit-bootstrap-paths.txt"
[[ "$MISS" -eq 0 ]] || { echo "❌ packaging aborted — fix missing paths above" >&2; exit 1; }

( cd "$BUNDLE" && find . -type f | sed 's|^\./||' | sort ) >"$BUNDLE/MANIFEST.txt"

echo "→ tar.gz …"
tar -czf "$ARCHIVE" -C "$STAGE" "$TOP"
shasum -a 256 "$ARCHIVE" >"${ARCHIVE}.sha256"

echo "✅ $ARCHIVE"
echo "   sha256: $(cut -d' ' -f1 "${ARCHIVE}.sha256")"
echo "   RP_HYBRID_TOOLKIT_INCLUDE_DUMPS=$INCLUDE_DUMPS"
