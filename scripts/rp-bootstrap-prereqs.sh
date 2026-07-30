#!/usr/bin/env bash
# RP bootstrap prerequisites: host-disk certs, proto contract, hybrid backup, network audit.
# Does NOT run cold-bootstrap, strict-tls-bootstrap, or kafka broker JKS (cluster/MetalLB phases).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export RP_SKIP_BOOKING_DB="${RP_SKIP_BOOKING_DB:-1}"
export RP_SKIP_RESERVATION_MESH="${RP_SKIP_RESERVATION_MESH:-${RP_SKIP_BOOKING_DB}}"
export RP_SKIP_MESSAGING_LEGACY_PEER="${RP_SKIP_MESSAGING_LEGACY_PEER:-1}"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

step "0/10 rp-verify-compose-contract.sh"
chmod +x "$SCRIPT_DIR/rp-verify-compose-contract.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/rp-verify-compose-contract.sh"

step "1/10 rp-bootstrap-crypto.sh (3-stage PKI + Kafka JKS + strict-tls — same as cold-bootstrap B.crypto)"
bash "$SCRIPT_DIR/rp-bootstrap-crypto.sh"

step "2/10 sync-rp-proto-contract.sh"
bash "$SCRIPT_DIR/sync-rp-proto-contract.sh"

step "3/10 audit-rp-proto-contract.sh"
bash "$SCRIPT_DIR/audit-rp-proto-contract.sh"

if [[ "${RP_SKIP_MATERIALIZE_IN_PREREQS:-0}" == "1" ]]; then
  echo "ℹ️  skip materialize in prereqs (cold-bootstrap will materialize from RESTORE_BACKUP_DIR)"
else
  step "4/10 build-rp-hybrid-runtime-backup.sh"
  bash "$SCRIPT_DIR/build-rp-hybrid-runtime-backup.sh"

  step "5/10 validate materialized RP runtime backup"
  # shellcheck source=scripts/lib/rp-restore-resolve.sh
  source "$SCRIPT_DIR/lib/rp-restore-resolve.sh"
  bash "$REPO_ROOT/backups/hybrid-rp-och/validate-hybrid-backup.sh" "$(rp_restore_materialized_dir)"
fi

if [[ "${RP_SKIP_STATIC_NETWORK_AUDIT:-0}" != "1" ]]; then
  step "8/10 rp-audit-network-contract (static + compose)"
  bash "$SCRIPT_DIR/rp-audit-no-localhost-nodeport.sh"
  bash "$SCRIPT_DIR/rp-verify-compose-contract.sh"
else
  echo "ℹ️  RP_SKIP_STATIC_NETWORK_AUDIT=1 — network audit deferred (cold-bootstrap runs after compose)"
fi

step "9/10 rp-ensure-kube-api (bridge API, embedded in cold-bootstrap)"
if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  bash "$SCRIPT_DIR/rp-ensure-kube-api.sh"
else
  echo "ℹ️  skip Colima kube API guard (colima not running)"
fi

echo ""
echo "✅ rp-bootstrap-prereqs complete — safe to run cold-bootstrap when ready:"
echo "   COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/rp-all-11-YYYYMMDD-HHMMSS make cold-bootstrap"
