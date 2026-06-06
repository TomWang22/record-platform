#!/usr/bin/env bash
# OCH platform tarball: entire repo tree (all top-level folders + root files) EXCEPT booking-service
# and booking-only assets. For forked products: cold-bootstrap once without shipping booking.
#
# Includes: scripts, services (no booking-service), webapp, infra (k8s, db, grafana, observability, …),
# docker/ (caddy-with-tcpdump, envoy-with-tcpdump), monitoring/, observability/, testd/, tests/,
# tools/, proto/ (+ events; no booking.proto), k8s/, docs/, certs/, diagrams/, backups/ (7 DBs),
# .github/, Makefile, compose files, etc.
#
# Output: $HOME/och-platform-no-booking-bundle-<stamp>.tar.gz
#   OCH_NO_BOOKING_BUNDLE_DIR=/path
#   OCH_NO_BOOKING_BUNDLE_KEEP_ALL=1
#
# Usage: bash scripts/package-och-platform-no-booking-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OCH_NO_BOOKING_BUNDLE_DIR:-$HOME}"
[[ -d "$OUT_DIR" ]] || { echo "OUT_DIR not a directory: $OUT_DIR" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
TOP="och-platform-no-booking-bundle"
BUNDLE="$STAGE/$TOP"

cleanup() { rm -rf "${STAGE:-}"; }
trap cleanup EXIT

mkdir -p "$BUNDLE"

# Never ship local caches, VCS, or huge log trees.
RSYNC_GLOBAL_EXCLUDES=(
  --exclude '.git'
  --exclude 'node_modules'
  --exclude '.next'
  --exclude 'dist'
  # Vitest/Istanbul output under services/* only — do NOT exclude scripts/coverage/ (CI tooling).
  --exclude 'services/*/coverage'
  --exclude 'webapp/coverage'
  --exclude '.turbo'
  --exclude '__pycache__'
  --exclude 'bench_logs'
  --exclude 'reports/no-booking-bundle-*'
  --exclude '.build-cache'
  --exclude '.reissue-tmp.*'
  --exclude '.venv-kafka-alignment-report'
  --exclude '.k6-build'
  --exclude '.xk6-build'
  --exclude '.DS_Store'
  --exclude '.env'
)

# Booking product slice (any path segment named booking-service or bookings dump prefix).
RSYNC_BOOKING_EXCLUDES=(
  --exclude 'booking-service'
  --exclude '5443-bookings*'
  --exclude 'booking.proto'
  --exclude 'events/booking.proto'
  --exclude '01-booking-schema.sql'
  --exclude '02-booking-state-machine.sql'
  --exclude '03-booking-outbox.sql'
  --exclude '04-booking-search-history.sql'
  --exclude '05-booking-prisma-columns.sql'
  --exclude '06-booking-processed-events.sql'
  --exclude '19-booking-search-history-alerts.sql'
  --exclude '20-booking-tenant-username-snapshot.sql'
  --exclude '25-notification-booking-context-read.sql'
  --exclude '27-notification-backfill-booking-context-read-and-dedupe.sql'
  --exclude '27-notification-booking-identity-backfill.md'
  --exclude '29-notification-booking-dedupe-cleanup.sql'
  --exclude '30-notification-booking-read-state-normalize.sql'
  --exclude '30-notification-booking-read-siblings.sql'
  --exclude 'booking-analytics.contract.test.ts'
  --exclude 'bookings.json'
  --exclude 'bookings.svg'
  --exclude 'bookings.dot'
  --exclude 'BOOKING_SERVICE_EXPANSION_NO_DB.md'
  --exclude 'docs/api/booking-service.md'
  --exclude 'docs/lld/booking-service.md'
  --exclude 'docs/checklists/booking-service-branch-checklist.md'
)

RSYNC_ALL=("${RSYNC_GLOBAL_EXCLUDES[@]}" "${RSYNC_BOOKING_EXCLUDES[@]}")

# Top-level dirs we always skip (not part of the portable platform).
SKIP_TOP_DIRS=(
  .git
  node_modules
  bench_logs
  .build-cache
)

copy_repo_tree() {
  echo "→ rsync full OCH tree (excluding booking + caches)…"
  rsync -a "${RSYNC_ALL[@]}" \
    --delete \
    "$ROOT/" "$BUNDLE/"
}

copy_repo_tree

# Top-level dirs/files explicitly documented for README (verify presence).
REQUIRED_TOP=(
  Makefile package.json pnpm-workspace.yaml pnpm-lock.yaml
  scripts services webapp infra docker monitoring observability
  testd tests tools proto k8s docs certs diagrams schemas
  backups .github
  docker-compose.yml docker-compose.local.yml Caddyfile BUILD.md README.md
)
missing=0
for p in "${REQUIRED_TOP[@]}"; do
  [[ -e "$BUNDLE/$p" ]] || { echo "warn: expected missing in bundle: $p" >&2; missing=$((missing + 1)); }
done
[[ "$missing" -eq 0 ]] || echo "($missing optional paths missing — may be ok)"

copy_one() {
  local rel="$1"
  [[ -f "$ROOT/$rel" ]] && mkdir -p "$BUNDLE/$(dirname "$rel")" && cp -f "$ROOT/$rel" "$BUNDLE/$rel"
}
copy_one "scripts/package-och-platform-no-booking-bundle.sh"

_patch_bundle_for_no_booking() {
  local kust="$BUNDLE/infra/k8s/base/kustomization.yaml"
  [[ -f "$kust" ]] && perl -pi -e 's/^\s*-\s*booking-service\s*\n//m' "$kust"

  local bootstrap="$BUNDLE/scripts/bootstrap-all-dbs.sh"
  [[ -f "$bootstrap" ]] && perl -pi -e 's/^bootstrap_bookings$/# bootstrap_bookings — excluded (och-platform-no-booking bundle)/m' "$bootstrap"

  local ci="$BUNDLE/.github/workflows/ci.yml"
  if [[ -f "$ci" ]]; then
    perl -pi -e 's/booking-service\s*//g' "$ci"
    perl -pi -e 's/,\s*,/,/g; s/\(\s*,/(/g; s/,\s*\)/)/g' "$ci"
  fi

  local pkg="$BUNDLE/package.json"
  if [[ -f "$pkg" ]]; then
    perl -pi -e 's/\s*--filter booking-service//g' "$pkg"
    perl -pi -e 's/pnpm -C services\/booking-service run test:integration && //g' "$pkg"
  fi

  rm -f \
    "$BUNDLE/proto/booking.proto" \
    "$BUNDLE/proto/events/booking.proto" \
    "$BUNDLE/infra/k8s/base/config/proto/booking.proto" \
    2>/dev/null || true
}

_patch_bundle_for_no_booking

cat >"$BUNDLE/README_BUNDLE.txt" <<'EOF'
OCH platform bundle (complete repo minus booking)
=================================================

Full Off-Campus-Housing-Tracker tree for forked platforms: every top-level folder except
booking-service and booking-only SQL/proto/dumps. Run cold-bootstrap once on a fresh machine.

Top-level directories included
------------------------------
  scripts/           Full automation (bootstrap, preflight, verify, CI helpers, packet capture, …)
  services/          All microservices EXCEPT services/booking-service/
  webapp/            Next.js frontend
  infra/             db/, k8s/, grafana/, monitoring/, observability/, docker/, nginx/, slo/, …
  docker/            caddy-with-tcpdump, envoy-with-tcpdump (edge capture images)
  monitoring/        Prometheus rules, SLO yaml at repo root
  observability/     Repo-root observability helpers
  testd/             Diagram / physical test fixtures (bookings.* fixtures omitted)
  tests/             System + workspace tests (booking contract test omitted)
  tools/             kafka-contract and other workspace tools
  proto/             Service protos + proto/events/ (no booking.proto)
  k8s/               Additional k8s assets at repo root
  docs/              Engineering docs
  certs/             Cert README + templates (no private keys committed)
  diagrams/          Architecture diagrams
  schemas/           JSON schemas
  backups/           Restore sets; canonical 7-DB set under all-8-20260517-152701 (no 5443-bookings.*)
  .github/workflows/ CI matrix (booking-service stripped from integration batch)
  reports/ artifacts/  When present in source tree

Root files
----------
  Makefile, package.json, pnpm-lock.yaml, docker-compose*.yml, Caddyfile,
  BUILD.md, README.md, Runbook.md, ENGINEERING.md, vitest.*.config.*, tsconfig.base.json, …

Excluded (by design)
--------------------
  services/booking-service/
  infra/k8s/base/booking-service/
  proto/booking.proto, proto/events/booking.proto, infra/.../config/proto/booking.proto
  infra/db/*booking*.sql
  backups/**/5443-bookings.*
  testd/physical/bookings.*, tests/system/booking-analytics.contract.test.ts
  Local-only: .git, node_modules, bench_logs, .build-cache, .reissue-tmp.*, .venv-*

Docker / CI / Kafka (verified by check-no-booking-bundle-required-files.sh)
---------------------------------------------------------------------------
  docker-compose.yml, docker-compose.local.yml, .github/workflows/docker-build.yml
  Per-service Dockerfiles (no booking-service), docker/caddy-with-tcpdump, docker/envoy-with-tcpdump
  3-broker KRaft: infra/k8s/kafka-kraft-metallb/, infra/k8s/kafka-certs/
  Certs + alignment: scripts/dev-generate-certs.sh, scripts/kafka-ssl-from-dev-root.sh,
  scripts/tests/kafka-alignment-suite.sh, scripts/kafka-runtime-sync.sh, scripts/check-kafka-config-drift.sh
  scripts/coverage/ — CI coverage matrix tooling (included)

Port conflicts (RP vs OCH on same laptop)
-----------------------------------------
  Read PORTS_AND_CONFLICTS.txt — OCH Postgres host 5441–5448, Redis 6380, Kafka 9092/9093/9094.
  Record Platform legacy often used 5433–5440. Check ports before docker compose up.

Cold start
----------
  pnpm install && pnpm run build
  COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap

Regenerate: bash scripts/package-och-platform-no-booking-bundle.sh
EOF

( cd "$BUNDLE" && find . -type f | sed 's|^\./||' | sort ) >"$BUNDLE/MANIFEST.txt"

cp -f "$ROOT/scripts/lib/no-booking-bundle-ports-warning.txt" "$BUNDLE/PORTS_AND_CONFLICTS.txt"

cat >"$BUNDLE/EXCLUDED.txt" <<'EOF'
services/booking-service/
infra/k8s/base/booking-service/
proto/booking.proto, proto/events/booking.proto, infra/k8s/base/config/proto/booking.proto
infra/db/*booking*.sql
backups/**/5443-bookings.*
testd/physical/bookings.{json,svg,dot}
tests/system/booking-analytics.contract.test.ts
BOOKING_SERVICE_EXPANSION_NO_DB.md
Caches: .git, node_modules, bench_logs, .build-cache, .reissue-tmp.*, .venv-*
EOF

OUT="$OUT_DIR/${TOP}-${STAMP}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$STAGE" "$TOP"
shasum -a 256 "$OUT" >"${OUT}.sha256"

if [[ "${OCH_NO_BOOKING_BUNDLE_KEEP_ALL:-0}" != "1" ]]; then
  shopt -s nullglob
  for f in "$OUT_DIR"/${TOP}-*.tar.gz; do
    [[ "$f" == "$OUT" ]] && continue
    rm -f "$f" "${f}.sha256"
  done
  shopt -u nullglob
fi

echo "$OUT"
ls -lh "$OUT"
cat "${OUT}.sha256"

echo
echo "→ verify bundle paths…"
bash "$ROOT/scripts/check-no-booking-bundle.sh" "$OUT"

echo
echo "→ verify recursive folder parity (all directory levels)…"
bash "$ROOT/scripts/compare-bundle-folder-counts.sh" "$OUT" all

echo
echo "→ write flat file-list parity report (reports/no-booking-bundle-parity.txt)…"
bash "$ROOT/scripts/check-no-booking-bundle-parity.sh" "$OUT"

echo
echo "→ verify required infrastructure files (Dockerfiles, kafka, compose, coverage)…"
bash "$ROOT/scripts/check-no-booking-bundle-required-files.sh" "$OUT"
