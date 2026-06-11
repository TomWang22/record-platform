#!/usr/bin/env bash
# Rollback plan dry-run: git revert feasibility, K8s rollout undo commands, backup artifact check.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-active-image-targets.sh
source "$SCRIPT_DIR/lib/rp-active-image-targets.sh"

NS="${RP_K8S_NS:-record-platform}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT="${REPORT:-$REPORT_DIR/t14-rollback-restore-contract.md}"
RELEASE_SHA="${1:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
BACKUP_DIR="${BACKUP_DIR:-}"

mkdir -p "$REPORT_DIR"
if [[ -z "$BACKUP_DIR" ]]; then
  BACKUP_DIR="$(ls -dt "$REPO_ROOT"/backups/rp-all-11-* 2>/dev/null | head -1 || true)"
fi

{
  echo "# Release rollback plan (dry-run)"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Release SHA: \`$RELEASE_SHA\`"
  echo "Backup dir: \`${BACKUP_DIR:-none}\`"
  echo ""
} >"$REPORT"

echo "=== rp-release-rollback-plan ==="

echo "## Git revert dry-run" >>"$REPORT"
if git -C "$REPO_ROOT" revert --no-commit "$RELEASE_SHA" 2>/tmp/rp-revert-dry.log; then
  echo "git revert --no-commit $RELEASE_SHA → **clean apply**" >>"$REPORT"
  git -C "$REPO_ROOT" revert --abort 2>/dev/null || git -C "$REPO_ROOT" reset --hard HEAD >/dev/null 2>&1
else
  echo "git revert --no-commit $RELEASE_SHA → **conflicts or error**" >>"$REPORT"
  echo '```' >>"$REPORT"
  cat /tmp/rp-revert-dry.log >>"$REPORT" 2>/dev/null || true
  echo '```' >>"$REPORT"
  git -C "$REPO_ROOT" revert --abort 2>/dev/null || git -C "$REPO_ROOT" reset --hard HEAD >/dev/null 2>&1
fi

echo "" >>"$REPORT"
echo "## Kubernetes image rollback commands" >>"$REPORT"
{
  echo '```bash'
  for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
    echo "kubectl -n $NS rollout undo deployment/$svc"
  done
  echo '```'
} >>"$REPORT"

echo "" >>"$REPORT"
echo "## Git rollback command" >>"$REPORT"
{
  echo '```bash'
  echo "git revert $RELEASE_SHA"
  echo '```'
} >>"$REPORT"

echo "" >>"$REPORT"
echo "## DB backup artifacts (11 DBs)" >>"$REPORT"

declare -A PORT_DB=(
  [5433]=records [5434]=messaging [5435]=listings [5436]=shopping [5437]=auth
  [5438]=postgres [5439]=analytics [5440]=python_ai [5441]=notification [5442]=trust [5443]=media
)
declare -A PORT_LABEL=([5438]=auction-monitor-core [5440]=python-ai)
PORTS=(5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443)

artifact_ok=0
artifact_fail=0
if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
  for port in "${PORTS[@]}"; do
    label="${PORT_LABEL[$port]:-${PORT_DB[$port]}}"
    file_label="${port}-${label}"
    ok=1
    for ext in .dump .sql.gz -extensions.tsv -pg_settings.tsv -schemas.tsv -table-counts.tsv; do
      f="$BACKUP_DIR/${file_label}${ext}"
      if [[ ! -s "$f" ]]; then
        echo "- FAIL missing: \`$f\`" >>"$REPORT"
        ok=0
      fi
    done
    if [[ "$ok" -eq 1 ]]; then
      echo "- PASS \`$label\` artifacts readable" >>"$REPORT"
      artifact_ok=$((artifact_ok + 1))
    else
      artifact_fail=$((artifact_fail + 1))
    fi
  done
else
  echo "FAIL: no backup directory found" >>"$REPORT"
  artifact_fail=11
fi

echo "" >>"$REPORT"
echo "Artifact summary: $artifact_ok/11 readable" >>"$REPORT"

echo "" >>"$REPORT"
echo "## Restore smoke (isolated DBs)" >>"$REPORT"

if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
  if bash "$SCRIPT_DIR/restore-rp-postgres-backup-smoke.sh" "$BACKUP_DIR" >>"$REPORT" 2>&1; then
    echo "" >>"$REPORT"
    echo "**Restore smoke: PASS** (11/11 isolated rp_restore_smoke_* DBs)" >>"$REPORT"
    echo "rp-release-rollback-plan PASS — $REPORT"
    exit 0
  fi
  echo "" >>"$REPORT"
  echo "**Restore smoke: FAIL**" >>"$REPORT"
fi

echo "rp-release-rollback-plan FAIL — $REPORT" >&2
exit 1
