#!/usr/bin/env bash
# Report what is using disk (Docker, repo, pcaps, caches). Same categories as emergency-disk-cleanup.
# Usage: ./scripts/storage-report.sh [--json]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

JSON=false
[[ "${1:-}" == "--json" ]] && JSON=true

report() {
  if [[ "$JSON" == "true" ]]; then
    echo "$1"
  else
    echo "$1" | sed 's/^/  /'
  fi
}

if [[ "$JSON" == "true" ]]; then
  echo '{"storage_report":{'
fi

echo "=== Storage report ==="
echo ""

# Docker
echo "--- Docker ---"
if command -v docker >/dev/null 2>&1; then
  docker system df -v 2>/dev/null | head -30 || docker system df 2>/dev/null
else
  report "docker not available"
fi
echo ""

# Repo / workspace
echo "--- Workspace (repo) ---"
for dir in bench_logs test-results webapp/.next backups node_modules .pnpm-store; do
  if [[ -d "$ROOT/$dir" ]]; then
    sz=$(du -sh "$ROOT/$dir" 2>/dev/null | awk '{print $1}' || echo "?")
    echo "  $dir: $sz"
  fi
done
# Per-service node_modules can add up
if [[ -d "$ROOT/node_modules" ]]; then
  echo "  node_modules: $(du -sh "$ROOT/node_modules" 2>/dev/null | awk '{print $1}')"
fi
echo ""

# Transport / pcap (what we fixed earlier with -s 256 -c 10000)
echo "--- Captures / transport ---"
for base in "$ROOT" /tmp; do
  for pattern in "*.pcap" "*.pcapng"; do
    found=$(find "$base" -maxdepth 4 -type f -name "$pattern" 2>/dev/null | head -20)
    if [[ -n "$found" ]]; then
      count=$(echo "$found" | wc -l | tr -d ' ')
      sz=$(echo "$found" | xargs du -ch 2>/dev/null | tail -1 | awk '{print $1}' || echo "?")
      echo "  $base $pattern: $count file(s), $sz"
    fi
  done
done
shopt -s nullglob 2>/dev/null || true
for d in /tmp/rotation-wire-*; do
  [[ -d "$d" ]] && echo "  $d: $(du -sh "$d" 2>/dev/null | awk '{print $1}')"
done
[[ -d /tmp/transport-captures ]] && echo "  /tmp/transport-captures: $(du -sh /tmp/transport-captures 2>/dev/null | awk '{print $1}')"
echo ""

# Large files in repo (top 15, skip .git)
echo "--- Largest files in repo (top 15, >5MB) ---"
find "$ROOT" -type f -size +5M -not -path "*/.git/*" 2>/dev/null | while read -r f; do
  du -k "$f" 2>/dev/null | awk -v p="$f" '{print $1"\t"p}'
done | sort -rn 2>/dev/null | head -15 | while IFS=$'\t' read -r k path; do
  [[ -n "$k" ]] && echo "  ${k}K  $path"
done
echo ""

# /tmp
echo "--- /tmp (common large dirs) ---"
for d in /tmp/preflight /tmp/suite-logs /tmp/transport-captures /tmp/vm-capture; do
  [[ -d "$d" ]] && echo "  $d: $(du -sh "$d" 2>/dev/null | awk '{print $1}')"
done
ls -d /tmp/rotation-wire-* 2>/dev/null | head -1 | grep -q . && echo "  /tmp/rotation-wire-*: $(du -ch /tmp/rotation-wire-* 2>/dev/null | tail -1 | awk '{print $1}')"
echo ""

# Colima / k3s (if present)
if command -v colima >/dev/null 2>&1 && colima list 2>/dev/null | grep -q running; then
  echo "--- Colima disk ---"
  colima list 2>/dev/null || true
  du -sh ~/.colima 2>/dev/null | while read -r size path; do echo "  ~/.colima: $size"; done || true
fi

echo ""
echo "Tip: ./scripts/emergency-disk-cleanup.sh --dry-run  # see what cleanup would remove"
echo "     Limit pcap size: capture uses -s 256 -c 10000 (see transport-config.yaml)"
