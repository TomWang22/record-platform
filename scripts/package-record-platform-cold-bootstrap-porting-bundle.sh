#!/usr/bin/env bash
# Record Platform cold-bootstrap porting bundle: full RP tree (combed like no-booking bundle)
# WITH reservation-mesh + all K8s manifests. Rewrites: record-platform.test / record-platform.
#
# Output: $HOME/record-platform-rp-cold-bootstrap-porting-bundle-<stamp>.tar.gz
#   RECORD_PLATFORM_COLD_BOOTSTRAP_BUNDLE_DIR=/path
#   RECORD_PLATFORM_COLD_BOOTSTRAP_BUNDLE_KEEP_ALL=1
#
# Usage: bash scripts/package-record-platform-cold-bootstrap-porting-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${RECORD_PLATFORM_COLD_BOOTSTRAP_BUNDLE_DIR:-$HOME}"
[[ -d "$OUT_DIR" ]] || { echo "OUT_DIR not a directory: $OUT_DIR" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
TOP="record-platform-rp-cold-bootstrap-porting-bundle"
BUNDLE="$STAGE/$TOP"
BACKUP_REL="backups/all-8-20260517-152701"

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
  --exclude 'reports/no-booking-bundle-*'
  --exclude 'reports/record-platform-cold-bootstrap-*'
  --exclude '.build-cache'
  --exclude '.reissue-tmp.*'
  --exclude '.venv-kafka-alignment-report'
  --exclude '.k6-build'
  --exclude '.xk6-build'
  --exclude '.DS_Store'
  --exclude '.env'
)

copy_repo_tree() {
  echo "→ rsync full RP tree (all services + infra + webapp)…"
  rsync -a "${RSYNC_EXCLUDES[@]}" --delete "$ROOT/" "$BUNDLE/"
}

copy_repo_tree

_record_platform_rewrites() {
  local d="$1"
  find "$d" -type f \( \
    -name '*.sh' -o -name '*.py' -o -name '*.mjs' -o -name '*.yaml' -o -name '*.yml' \
    -name '*.txt' -o -name '*.json' -o -name '*.mts' -o -name '*.md' -o -name '*.ts' \
    -o -name '*.tsx' -o -name 'Makefile' -o -name 'pnpm-lock.yaml' -o -name 'Caddyfile' \
  \) ! -path '*/node_modules/*' -print0 2>/dev/null | while IFS= read -r -d '' f; do
    perl -pi -e 's/record-platform\.test/record-platform.test/g' "$f"
    perl -pi -e 's/record-platform/record-platform/g' "$f"
    perl -pi -e 's/record-platform-quic/record-platform-quic/g' "$f"
    perl -pi -e 's/\(RP: record\.test/(Record Platform: record-platform.test/g' "$f"
  done
}

_record_platform_rewrites "$BUNDLE"

if [[ -f "$ROOT/scripts/lib/no-booking-bundle-ports-warning.txt" ]]; then
  sed \
    -e 's/RP platform bundle/Record Platform cold-bootstrap porting bundle/g' \
    -e 's/record-platform/record-platform/g' \
    "$ROOT/scripts/lib/no-booking-bundle-ports-warning.txt" \
    >"$BUNDLE/PORTS_AND_CONFLICTS.txt"
fi

cat >"$BUNDLE/README_BUNDLE.txt" <<'EOF'
Record Platform — RP cold-bootstrap porting bundle (full comb)
=============================================================

Ported defaults: record-platform.test (edge) / record-platform (Kubernetes namespace).
Includes ALL RP folders: services (incl. booking), webapp, scripts, infra/k8s, docker,
monitoring, observability, backups/all-8-20260517-152701 (8 DBs), CI workflows.

Core services + manifests (verify with check-record-platform-cold-bootstrap-bundle.sh)
--------------------------------------------------------------------------------------
  services/auth-service/          infra/k8s/base/auth-service/
  services/listings-service/      infra/k8s/base/listings-service/
  services/messaging-service/     infra/k8s/base/messaging-service/
  services/trust-service/         infra/k8s/base/trust-service/
  services/media-service/         infra/k8s/base/media-service/
  services/reservation-mesh/       infra/k8s/base/reservation-mesh/
  services/api-gateway/           infra/k8s/base/api-gateway/
  services/notification-service/  infra/k8s/base/notification-service/
  services/analytics-service/     infra/k8s/base/analytics-service/
  webapp/                         infra/k8s/base/webapp/

Also: infra/db/, infra/k8s/kafka-kraft-metallb/, infra/k8s/kafka-certs/, scripts/coverage/,
docker/caddy-with-tcpdump, tools/kafka-contract/, .github/workflows/ (ci.yml, docker-build.yml, …).

backups/all-8-20260517-152701/
  Full 8-DB restore (5441–5448 including bookings 5443). Makefile COLD_BOOTSTRAP_DEFAULT_RESTORE.

Ports
-----
  See PORTS_AND_CONFLICTS.txt (RP host Postgres 5441–5448, Redis 6380, Kafka 9092/9093/9094).

Quick start (Record Platform)
-----------------------------
  tar -xzf record-platform-rp-cold-bootstrap-porting-bundle-<stamp>.tar.gz -C /path/to/record-platform
  cd record-platform-rp-cold-bootstrap-porting-bundle
  export HOUSING_NS=record-platform
  pnpm install && pnpm run build
  COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap

Regenerate: bash scripts/package-record-platform-cold-bootstrap-porting-bundle.sh
EOF

( cd "$BUNDLE" && find . -type f | sed 's|^\./||' | sort ) >"$BUNDLE/MANIFEST.txt"

OUT="$OUT_DIR/${TOP}-${STAMP}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$STAGE" "$TOP"
shasum -a 256 "$OUT" >"${OUT}.sha256"

if [[ "${RECORD_PLATFORM_COLD_BOOTSTRAP_BUNDLE_KEEP_ALL:-0}" != "1" ]]; then
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

_verify_core_paths() {
  local missing=0
  echo
  echo "→ verify core services + k8s manifests in tarball…"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue
    if tar -tzf "$OUT" | grep -Fq "${TOP}/${line}"; then
      echo "  OK $line"
    else
      echo "  MISSING $line" >&2
      missing=$((missing + 1))
    fi
  done <"$ROOT/scripts/lib/record-platform-cold-bootstrap-required-paths.txt"
  for dir in \
    services/auth-service services/listings-service services/messaging-service \
    services/trust-service services/media-service services/reservation-mesh \
    webapp infra/k8s/base/auth-service infra/k8s/base/messaging-service \
    infra/k8s/base/trust-service infra/k8s/base/media-service infra/k8s/base/listings-service \
    infra/k8s/base/webapp; do
    if tar -tzf "$OUT" | grep -q "${TOP}/${dir}/"; then
      echo "  OK dir $dir/"
    else
      echo "  MISSING dir $dir/" >&2
      missing=$((missing + 1))
    fi
  done
  if [[ "$missing" -gt 0 ]]; then
    echo "FAIL: $missing required paths missing from bundle" >&2
    exit 1
  fi
  echo "PASS: core Record Platform cold-bootstrap paths present"
}

_verify_core_paths
