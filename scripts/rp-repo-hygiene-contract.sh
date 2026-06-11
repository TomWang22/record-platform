#!/usr/bin/env bash
# Repo root hygiene contract — no loose certs, pcaps, or build artifacts at repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT="${REPORT:-$REPORT_DIR/t13-repo-hygiene-contract.md}"
FAIL=0

_ok() { echo "  OK $*"; }
_bad() { echo "  FAIL $*" >&2; FAIL=1; }

mkdir -p "$REPORT_DIR"

echo "=== rp-repo-hygiene-contract ==="

# --- Root clutter: forbidden filenames ---
FORBIDDEN_ROOT=(
  record.local.pem record.local-key.pem record.local.crt record.local.key
  record.pcapng vm.pcap certs.bak
)
for f in "${FORBIDDEN_ROOT[@]}"; do
  if [[ -e "$REPO_ROOT/$f" ]]; then
    _bad "root file present: $f"
  else
    _ok "no root $f"
  fi
done

# --- Root glob patterns ---
for pattern in '*.pem' '*.key' '*.pcap' '*.pcapng'; do
  matches=()
  while IFS= read -r -d '' m; do matches+=("$m"); done < <(find "$REPO_ROOT" -maxdepth 1 -name "$pattern" -print0 2>/dev/null)
  if [[ ${#matches[@]} -gt 0 ]]; then
    _bad "root matches $pattern: ${matches[*]#$REPO_ROOT/}"
  else
    _ok "no root $pattern"
  fi
done

# --- Tracked cert/pcap in git index ---
tracked="$(git -C "$REPO_ROOT" ls-files | grep -E '(^|/)(record\.local|certs\.bak|\.pcapng$|\.pcap$|\.pem$|\.key$)' || true)"
if [[ -n "$tracked" ]]; then
  _bad "tracked cert/pcap in git index:"
  echo "$tracked" | sed 's/^/    /' >&2
else
  _ok "git ls-files: no tracked cert/pcap/pem/key"
fi

# --- gitignore coverage ---
for path in webapp/.next/ record.pcapng vm.pcap certs/legacy/ certs/_archive/; do
  if git -C "$REPO_ROOT" check-ignore -q "$path" 2>/dev/null; then
    _ok "gitignore: $path"
  else
    _bad "not gitignored: $path"
  fi
done

# --- Stable root entrypoints present ---
REQUIRED=(
  README.md Makefile package.json pnpm-lock.yaml pnpm-workspace.yaml
  Caddyfile docker-compose.yml tsconfig.base.json
)
for f in "${REQUIRED[@]}"; do
  [[ -f "$REPO_ROOT/$f" ]] && _ok "entrypoint $f" || _bad "missing entrypoint $f"
done

# --- Relocated configs (not at root) ---
RELOCATED=(
  docs/Runbook.md
  scripts/deploy.sh
  infra/kind/kind-h3.yaml
  infra/transport/transport-config.yaml
)
for f in "${RELOCATED[@]}"; do
  [[ -f "$REPO_ROOT/$f" ]] && _ok "relocated $f" || _bad "missing relocated $f"
done

# --- Forbidden at root (moved in R1–R5) ---
LEGACY_ROOT=(Runbook.md deploy.sh kind-h3.yaml transport-config.yaml Dockerfile.k6-strict-tls)
for f in "${LEGACY_ROOT[@]}"; do
  [[ -e "$REPO_ROOT/$f" ]] && _bad "legacy root file still present: $f" || _ok "no legacy root $f"
done

# --- git status (informational) ---
status_lines="$(git -C "$REPO_ROOT" status --short 2>/dev/null | wc -l | tr -d ' ')"

{
  echo "# T13 repo hygiene contract"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "SHA: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo ""
  echo "## git status lines: $status_lines"
  echo ""
  echo '```'
  git -C "$REPO_ROOT" status --short 2>/dev/null | head -20 || true
  echo '```'
  echo ""
  if [[ "$FAIL" -eq 0 ]]; then
    echo "**PASS** — root hygiene contract satisfied."
  else
    echo "**FAIL** — see stderr."
  fi
} >"$REPORT"

if [[ "$FAIL" -eq 0 ]]; then
  echo "rp-repo-hygiene-contract PASS — $REPORT"
  exit 0
fi
echo "rp-repo-hygiene-contract FAIL — $REPORT" >&2
exit 1
