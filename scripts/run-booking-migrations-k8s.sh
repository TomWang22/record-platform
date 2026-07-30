#!/usr/bin/env bash
# Run Prisma migrate deploy inside the running reservation-mesh pod (uses cluster POSTGRES_URL_BOOKINGS).
# Prereq: kubectl context, namespace, deployment Ready.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Match prisma devDependency in services/reservation-mesh/package.json
PRISMA_CLI_VERSION="${PRISMA_CLI_VERSION:-6.17.1}"

NAMESPACE="${K8S_NS:-${HOUSING_NS:-record-platform}}"
DEPLOY="${BOOKING_DEPLOYMENT:-deployment/reservation-mesh}"

echo "[run-booking-migrations-k8s] ns=$NAMESPACE target=$DEPLOY prisma@$PRISMA_CLI_VERSION"

kubectl -n "$NAMESPACE" exec "$DEPLOY" -- sh -ec "
  set -euo pipefail
  cd /app/services/reservation-mesh
  if ! command -v npx >/dev/null 2>&1; then
    echo 'npx not found in container' >&2
    exit 1
  fi
  npx --yes prisma@${PRISMA_CLI_VERSION} migrate deploy
"

echo "✅ Booking Prisma migrations applied in-cluster"
