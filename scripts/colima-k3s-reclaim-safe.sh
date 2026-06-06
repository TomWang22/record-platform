#!/usr/bin/env bash
# Safe reclaim for Colima + k3s: build cache, stopped containers, dangling images only.
# Does NOT remove volumes or tagged images unless you pass --aggressive.
# See docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md
#
# Usage:
#   ./scripts/colima-k3s-reclaim-safe.sh --dry-run   # show what would be run
#   ./scripts/colima-k3s-reclaim-safe.sh --execute   # run safe prune (no prompt)
#   ./scripts/colima-k3s-reclaim-safe.sh             # prompt then run safe prune
#   ./scripts/colima-k3s-reclaim-safe.sh --execute --aggressive  # also prune unused tagged images

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
EXECUTE=0
AGGRESSIVE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --execute)   EXECUTE=1 ;;
    --aggressive) AGGRESSIVE=1 ;;
  esac
done

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
info() { echo "  $*"; }

say "Colima/k3s safe reclaim"
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not reachable (Colima down?). Start Colima first."
  exit 1
fi

echo "Current docker system df:"
docker system df
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
  say "Dry run — would run:"
  info "docker builder prune -af"
  info "docker container prune -f"
  info "docker image prune -f"
  [[ $AGGRESSIVE -eq 1 ]] && info "docker image prune -a -f  # (--aggressive)"
  echo ""
  exit 0
fi

if [[ $EXECUTE -ne 1 ]]; then
  echo "Run with --execute to perform safe reclaim, or --dry-run to only print commands."
  echo "Safe reclaim: build cache + stopped containers + dangling images (no volumes, no tagged images)."
  read -p "Proceed? (yes/no): " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

say "Running safe reclaim..."
echo "  (builder prune can take 1–2 min; output suppressed)"
docker builder prune -af >/dev/null 2>&1 || true
docker container prune -f
docker image prune -f

if [[ $AGGRESSIVE -eq 1 ]]; then
  say "Aggressive: pruning unused tagged images (next run may re-pull)."
  docker image prune -a -f
fi

say "Done. docker system df:"
docker system df
echo ""
echo "See docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md for full plan and stabilize steps."
