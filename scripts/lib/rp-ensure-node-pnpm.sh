#!/usr/bin/env bash
# Canonical RP toolchain: Node 22.x (>=22.13 <23) + pnpm@11.1.3 via corepack.
# Source from cold-bootstrap, host-deps, Makefile pnpm targets.
#
# Usage: source scripts/lib/rp-ensure-node-pnpm.sh && rp_ensure_node_pnpm [REPO_ROOT]
#
# Env (set by caller or here):
#   CI=true
#   COREPACK_ENABLE_DOWNLOAD_PROMPT=0
rp_ensure_node_pnpm() {
  local repo="${1:-${REPO_ROOT:-${RP_CB_REPO_ROOT:-}}}"
  [[ -n "$repo" ]] || return 1

  export CI="${CI:-true}"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT="${COREPACK_ENABLE_DOWNLOAD_PROMPT:-0}"

  local want_node_major="22"
  local want_pnpm="11.1.3"
  local nvmrc_ver=""
  if [[ -f "$repo/.nvmrc" ]]; then
    nvmrc_ver="$(tr -d '[:space:]' <"$repo/.nvmrc")"
  fi
  [[ -n "$nvmrc_ver" ]] || nvmrc_ver="$want_node_major"
  # Contract is Node 22 — never honor legacy .nvmrc "20" (regression guard).
  if [[ "$nvmrc_ver" != "$want_node_major" ]]; then
    echo "ℹ️  .nvmrc=${nvmrc_ver} overridden to Node ${want_node_major} (RP toolchain contract)" >&2
    nvmrc_ver="$want_node_major"
  fi

  if command -v fnm >/dev/null 2>&1; then
    # shellcheck disable=SC1090
    eval "$(fnm env)"
    fnm install "$nvmrc_ver" >/dev/null 2>&1 || true
    fnm use "$nvmrc_ver" >/dev/null 2>&1 || fnm use --install-if-missing "$nvmrc_ver"
  elif [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm install "$nvmrc_ver" >/dev/null 2>&1 || true
    nvm use "$nvmrc_ver" >/dev/null 2>&1
  else
    local nv0
    nv0="$(node -v 2>/dev/null || true)"
    if ! _rp_node_version_in_contract "$nv0"; then
      echo "❌ Node 22.x (>=22.13 <23) required for pnpm@11.1.3 (got ${nv0:-none})." >&2
      echo "   Install fnm: https://github.com/Schniz/fnm — then: fnm install 22 && fnm use 22" >&2
      echo "   Or nvm: https://github.com/nvm-sh/nvm — then: nvm install 22 && nvm use 22" >&2
      return 1
    fi
  fi

  local nv
  nv="$(node -v 2>/dev/null || true)"
  if ! _rp_node_version_in_contract "$nv"; then
    echo "❌ Node 22.x (>=22.13 <23) required (got ${nv:-none}). fnm/nvm could not activate .nvmrc ($nvmrc_ver)." >&2
    return 1
  fi

  command -v corepack >/dev/null 2>&1 || {
    echo "❌ corepack not found (bundled with Node 22+). Reinstall Node or enable corepack." >&2
    return 1
  }
  corepack enable >/dev/null 2>&1 || true
  corepack prepare "pnpm@${want_pnpm}" --activate

  local pv got_pm
  pv="$(pnpm --version 2>/dev/null | tr -d '[:space:]' || true)"
  got_pm="$(node -e "const p=require('$repo/package.json'); process.stdout.write(p.packageManager||'')" 2>/dev/null || true)"
  if [[ "$pv" != "$want_pnpm" ]]; then
    echo "❌ pnpm version mismatch (want ${want_pnpm}, got ${pv:-none})" >&2
    return 1
  fi
  if [[ "$got_pm" != "pnpm@${want_pnpm}" ]]; then
    echo "❌ package.json packageManager must be pnpm@${want_pnpm} (got ${got_pm:-empty})" >&2
    return 1
  fi

  printf '✅ toolchain: node %s (%s) pnpm %s (%s)\n' \
    "$nv" "$(command -v node)" "$pv" "$(command -v pnpm)"
  return 0
}

_rp_node_version_in_contract() {
  local nv="${1#v}"
  local major minor
  IFS=. read -r major minor _ <<<"$nv"
  [[ "${major:-}" == "22" ]] || return 1
  [[ "${minor:-0}" -ge 13 ]] 2>/dev/null || return 1
  return 0
}
