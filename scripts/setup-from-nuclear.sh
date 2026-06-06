#!/usr/bin/env bash
# Run the full setup from scratch (after nuclear option / fresh Colima).
# See docs/SETUP-FROM-SCRATCH.md for the manual checklist.
#
# Usage: ./scripts/setup-from-nuclear.sh
#   SKIP_COLIMA=1     — Colima already running; only run 6443
#   SKIP_CERTS=1      — reissue + kafka-ssl already done
#   SKIP_INFRA=1      — Docker Compose (8 DBs, redis, kafka) already up
#   SKIP_SCHEMAS=1    — ensure-all-schemas-and-tuning already run
#   SKIP_K8S=1        — do not apply k8s base or patch kafka-external
#   RESTORE_BACKUP_DIR — if set, restore all 8 DBs from this bundle after schemas (e.g. backups/all-8-20260226-223226).
#                        Set to empty to skip restore. Default: backups/all-8-20260226-223226 (restore that bundle).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

# --- 1. Colima + 6443 ---
if [[ "${SKIP_COLIMA:-0}" != "1" ]]; then
  say "1. Colima + API tunnel (6443)"
  if command -v colima >/dev/null 2>&1; then
    if ! colima status 2>&1 | grep -q "colima is running"; then
      warn "Colima not running. Start it first, e.g.:"
      echo "  colima start --network-address --kubernetes --cpu 12 --memory 16 --disk 256"
      echo "  Then re-run this script, or run with SKIP_COLIMA=1 if Colima is already up."
      exit 1
    fi
    ok "Colima running"
  fi
  if [[ -x "$SCRIPT_DIR/colima-forward-6443.sh" ]]; then
    "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
    if nc -z 127.0.0.1 6443 2>/dev/null; then
      ok "127.0.0.1:6443 reachable"
    else
      warn "6443 not reachable; run: ./scripts/colima-forward-6443.sh"
      exit 1
    fi
  else
    warn "colima-forward-6443.sh not found"
    exit 1
  fi
else
  say "1. Skipping Colima (SKIP_COLIMA=1); ensuring 6443..."
  "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
fi

# --- 2. Cert chain ---
if [[ "${SKIP_CERTS:-0}" != "1" ]]; then
  say "2. Cert chain (reissue + Kafka SSL)"
  KAFKA_SSL=1 "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh" || { warn "reissue failed"; exit 1; }
  "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" || { warn "kafka-ssl-from-dev-root failed"; exit 1; }
  ok "Certs and kafka-ssl-secret ready"
else
  say "2. Skipping certs (SKIP_CERTS=1)"
fi

# --- 3. External infra ---
if [[ "${SKIP_INFRA:-0}" != "1" ]]; then
  say "3. External infra (8 Postgres, Redis, Zookeeper, Kafka)"
  "$SCRIPT_DIR/bring-up-external-infra.sh" || { warn "bring-up-external-infra failed"; exit 1; }
  ok "External infra up"
else
  say "3. Skipping infra (SKIP_INFRA=1)"
fi

# Brief wait for Postgres to accept connections (containers may show "health: starting" right after bring-up)
if [[ "${SKIP_SCHEMAS:-0}" != "1" ]] && [[ "${SKIP_INFRA:-0}" != "1" ]]; then
  echo "  Waiting 15s for Postgres to accept connections..."
  sleep 15
fi

# --- 4. Schemas ---
if [[ "${SKIP_SCHEMAS:-0}" != "1" ]]; then
  say "4. Schemas and tuning (all 8 DBs)"
  "$SCRIPT_DIR/ensure-all-schemas-and-tuning.sh" || { warn "ensure-all-schemas-and-tuning failed"; exit 1; }
  ok "Schemas applied"
else
  say "4. Skipping schemas (SKIP_SCHEMAS=1)"
fi

# --- 4b. Restore from backup bundle (all-8-*) ---
RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-backups/all-8-20260226-223226}"
if [[ -n "$RESTORE_BACKUP_DIR" ]] && [[ -d "$REPO_ROOT/$RESTORE_BACKUP_DIR" ]]; then
  say "4b. Restore all 8 DBs from $RESTORE_BACKUP_DIR"
  BACKUP_DIR="$REPO_ROOT/$RESTORE_BACKUP_DIR" "$SCRIPT_DIR/restore-all-8-from-backup.sh" || { warn "restore-all-8-from-backup failed (non-fatal)"; }
  ok "Restore from bundle done"
  # 4c. Re-apply schemas after restore so migrations add any tables/columns the dump doesn't have (dead-on with baseline).
  say "4c. Re-apply schemas after restore (migrations on top of dump)"
  "$SCRIPT_DIR/ensure-all-schemas-and-tuning.sh" || { warn "ensure-all-schemas after restore failed (non-fatal)"; }
  ok "Schemas re-applied after restore"
elif [[ -n "$RESTORE_BACKUP_DIR" ]]; then
  warn "RESTORE_BACKUP_DIR=$RESTORE_BACKUP_DIR not found; skip restore"
else
  say "4b. Skipping restore (RESTORE_BACKUP_DIR empty)"
fi

# --- 5. K8s apply + kafka-external ---
if [[ "${SKIP_K8S:-0}" != "1" ]]; then
  say "5. K8s apply + kafka-external patch"
  kubectl apply -k infra/k8s/base || { warn "kubectl apply failed"; exit 1; }
  "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>/dev/null || warn "patch-kafka-external-host failed (non-fatal)"
  if [[ -x "$SCRIPT_DIR/strict-tls-bootstrap.sh" ]] && [[ -f "$REPO_ROOT/certs/record.local.crt" ]]; then
    "$SCRIPT_DIR/strict-tls-bootstrap.sh" 2>/dev/null || true
  fi
  ok "K8s base applied"
else
  say "5. Skipping K8s (SKIP_K8S=1)"
fi

say "Setup complete."
echo "  Next: kubectl get pods -n record-platform"
echo "  Preflight: ./scripts/ensure-ready-for-preflight.sh --run  (see scripts/RUN-PREFLIGHT.md)"
