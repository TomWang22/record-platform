#!/usr/bin/env bash
# Resolve RESTORE_BACKUP_DIR for RP cold-bootstrap (materialized or raw all-8 → materialized).
#
# Usage: eval "$(bash scripts/resolve-rp-restore-backup-dir.sh backups/all-8-20260517-152701)"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/rp-restore-resolve.sh
source "$SCRIPT_DIR/lib/rp-restore-resolve.sh"

rp_resolve_restore_backup_dir "${1:-${RESTORE_BACKUP_DIR:-latest}}" || exit 1

echo "export RESTORE_BACKUP_DIR=${RESTORE_BACKUP_DIR_REL}"
echo "export RESTORE_BACKUP_DIR_REL=${RESTORE_BACKUP_DIR_REL}"
echo "export RESTORE_BACKUP_DIR_ABS=${RESTORE_BACKUP_DIR_ABS}"
echo "export RP_RESTORE_LAYOUT=${RP_RESTORE_LAYOUT}"
echo "export RP_MATERIALIZED_DIR=${RP_MATERIALIZED_DIR}"
echo "export RP_RESTORE_SOURCE_INPUT=${RP_RESTORE_SOURCE_INPUT}"
