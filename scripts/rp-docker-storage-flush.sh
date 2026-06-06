#!/usr/bin/env bash
# Flush Colima/Docker bloat: build cache, dangling images, stopped containers.
# Safe for dev: keeps images used by running containers (k8s pods).
#
# Usage:
#   bash scripts/rp-docker-storage-flush.sh
#   DRY_RUN=1 bash scripts/rp-docker-storage-flush.sh   # print only
#   PRUNE_VOLUMES=1 bash scripts/rp-docker-storage-flush.sh  # also unused volumes (destructive)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/storage}"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/docker-storage-flush-$(date -u +%Y%m%dT%H%M%SZ).md"

DRY_RUN="${DRY_RUN:-0}"
PRUNE_VOLUMES="${PRUNE_VOLUMES:-0}"

if [[ -S "${HOME}/.colima/default/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
elif [[ -S "${HOME}/.docker/run/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
fi

say() { printf '%s\n' "$*"; }
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    say "  [dry-run] $*"
  else
    say "  ▶ $*"
    eval "$@"
  fi
}

df_before="$(df -h /System/Volumes/Data 2>/dev/null | tail -1 || true)"
colima_before="$(du -sh "${HOME}/.colima" 2>/dev/null | awk '{print $1}' || echo unknown)"

{
  say "# Docker storage flush"
  say ""
  say "- Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  say "- DOCKER_HOST: ${DOCKER_HOST:-default}"
  say "- Data volume before: \`$df_before\`"
  say "- ~/.colima before: \`$colima_before\`"
  say ""
} >"$REPORT"

if ! command -v docker >/dev/null 2>&1; then
  say "docker not on PATH — skip" | tee -a "$REPORT"
  exit 0
fi

say "Before:" | tee -a "$REPORT"
docker system df 2>&1 | tee -a "$REPORT" || true
say "" | tee -a "$REPORT"

run "docker container prune -f"
run "docker network prune -f"
run "docker image prune -f"
run "docker builder prune -af"
run "docker image prune -af"
if [[ "$PRUNE_VOLUMES" == "1" ]]; then
  run "docker volume prune -f"
fi

say "" | tee -a "$REPORT"
say "After:" | tee -a "$REPORT"
docker system df 2>&1 | tee -a "$REPORT" || true

df_after="$(df -h /System/Volumes/Data 2>/dev/null | tail -1 || true)"
colima_after="$(du -sh "${HOME}/.colima" 2>/dev/null | awk '{print $1}' || echo unknown)"
{
  say ""
  say "- Data volume after: \`$df_after\`"
  say "- ~/.colima after: \`$colima_after\`"
  say ""
  say "Report: \`$REPORT\`"
} | tee -a "$REPORT"

say "✅ Docker storage flush done — $REPORT"
