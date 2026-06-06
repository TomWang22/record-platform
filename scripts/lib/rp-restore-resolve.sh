#!/usr/bin/env bash
# Resolve RESTORE_BACKUP_DIR for RP cold-bootstrap (materialized vs raw all-8 source).
# Source only — call rp_resolve_restore_backup_dir from resolve-rp-restore-backup-dir.sh

rp_restore_materialized_dir() {
  local d
  for d in \
    "${REPO_ROOT}/backups/rp-runtime/materialized" \
    "${REPO_ROOT}/backups/hybrid-rp-och/materialized-rp-runtime"; do
    if rp_backup_is_materialized_runtime "$d"; then
      printf '%s' "$d"
      return 0
    fi
  done
  printf '%s' "${REPO_ROOT}/backups/rp-runtime/materialized"
}

rp_backup_is_rp_all11() {
  local dir="$1"
  [[ "$(basename "$dir")" == rp-all-11-* ]] || return 1
  compgen -G "$dir/"'[0-9][0-9][0-9][0-9]-*.dump' >/dev/null 2>&1
}

rp_backup_is_materialized_runtime() {
  local dir="$1"
  [[ -f "$dir/manifest.json" ]] || return 1
  [[ -f "$dir/5433-records.dump" || -f "$dir/5433-records.sql.gz" ]] || return 1
  python3 - "$dir/manifest.json" <<'PY' >/dev/null 2>&1
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    d = json.load(f)
if d.get("port_contract_version") != 3:
    sys.exit(1)
# rp-all-11-* dirs are native backups, not pre-built materialized trees
if d.get("source_layout") == "rp-all-11":
    sys.exit(1)
sys.exit(0)
PY
}

rp_backup_is_rp_native_runtime() {
  local dir="$1"
  rp_backup_is_rp_all11 "$dir" || return 1
  [[ -f "$dir/manifest.json" ]] || return 1
  python3 - "$dir/manifest.json" <<'PY' >/dev/null 2>&1
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    d = json.load(f)
sys.exit(0 if d.get("source_layout") == "rp-all-11" else 1)
PY
}

rp_backup_is_raw_all8() {
  local dir="$1"
  [[ "$(basename "$dir")" == all-8-* ]] || return 1
  compgen -G "$dir/"'*.dump' >/dev/null 2>&1 || compgen -G "$dir/"'*.sql.gz' >/dev/null 2>&1
}

rp_detect_all8_flavor() {
  local dir="$1"
  local has_och=0 has_rp=0
  [[ -f "$dir/5441-auth.dump" || -f "$dir/5441-auth.sql.gz" || -f "$dir/5444-messaging.dump" ]] && has_och=1
  [[ -f "$dir/5437-auth.dump" || -f "$dir/5437-auth.sql.gz" || -f "$dir/5433-records.dump" ]] && has_rp=1
  if [[ "$has_och" == "1" && "$has_rp" == "1" ]]; then
    printf 'mixed\n'
  elif [[ "$has_och" == "1" ]]; then
    printf 'och\n'
  elif [[ "$has_rp" == "1" ]]; then
    printf 'rp\n'
  else
    printf 'unknown\n'
  fi
}

rp_find_partner_all8_dir() {
  local src="$1" want="$2" d flavor
  for d in "$REPO_ROOT"/backups/all-8-*; do
    [[ -d "$d" ]] || continue
    [[ "$d" == "$src" ]] && continue
    flavor="$(rp_detect_all8_flavor "$d")"
    [[ "$flavor" == "$want" ]] || continue
    printf '%s' "$d"
    return 0
  done
  return 1
}

rp_resolve_restore_backup_dir() {
  local input="${1:-${RESTORE_BACKUP_DIR:-latest}}"
  local materialized och_dir rp_dir flavor

  REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  materialized="$(rp_restore_materialized_dir)"

  if [[ -z "$input" || "$input" == "latest" ]]; then
    input="$(ls -d "$REPO_ROOT"/backups/rp-all-11-* 2>/dev/null | sort -r | head -1 || true)"
    if [[ -z "$input" ]] && rp_backup_is_materialized_runtime "$materialized"; then
      input="$materialized"
    elif [[ -z "$input" ]]; then
      input="$(ls -d "$REPO_ROOT"/backups/all-8-* 2>/dev/null | sort -r | head -1 || true)"
      [[ -n "$input" ]] || input="$materialized"
    fi
  fi

  [[ "$input" != /* ]] && input="$REPO_ROOT/$input"
  input="${input%/}"

  RP_RESTORE_LAYOUT="unknown"
  RP_RESTORE_SOURCE_INPUT="$input"
  RP_MATERIALIZED_DIR="$materialized"

  if rp_backup_is_rp_native_runtime "$input" || rp_backup_is_rp_all11 "$input"; then
    if [[ ! -f "$input/manifest.json" ]]; then
      bash "$REPO_ROOT/scripts/rp-write-rp-runtime-manifest.sh" "$input" >&2
    fi
    RP_RESTORE_LAYOUT="rp-all-11"
    RESTORE_BACKUP_DIR_ABS="$input"
    RESTORE_BACKUP_DIR_REL="${RESTORE_BACKUP_DIR_ABS#"$REPO_ROOT"/}"
    return 0
  fi

  if rp_backup_is_materialized_runtime "$input"; then
    RP_RESTORE_LAYOUT="materialized"
    RESTORE_BACKUP_DIR_ABS="$input"
    RESTORE_BACKUP_DIR_REL="${RESTORE_BACKUP_DIR_ABS#"$REPO_ROOT"/}"
    return 0
  fi

  if ! rp_backup_is_raw_all8 "$input"; then
    echo "ERROR: Unrecognized restore dir: $input (need manifest v3, backups/rp-all-11-*, or legacy all-8-* to materialize)" >&2
    return 1
  fi

  RP_RESTORE_LAYOUT="raw-all8"
  flavor="$(rp_detect_all8_flavor "$input")"
  case "$flavor" in
    och)
      och_dir="$input"
      rp_dir="$(rp_find_partner_all8_dir "$input" rp || true)"
      rp_dir="${rp_dir:-$REPO_ROOT/backups/all-8-20260312-091418}"
      ;;
    rp)
      rp_dir="$input"
      och_dir="$(rp_find_partner_all8_dir "$input" och || true)"
      och_dir="${och_dir:-$REPO_ROOT/backups/all-8-20260517-152701}"
      ;;
    mixed)
      och_dir="$input"
      rp_dir="$input"
      ;;
    *)
      echo "ERROR: cannot classify all-8 backup layout under $input" >&2
      return 1
      ;;
  esac

  [[ -d "$och_dir" ]] || { echo "ERROR: legacy all-8 source missing: $och_dir" >&2; return 1; }
  [[ -d "$rp_dir" ]] || { echo "ERROR: RP all-8 source missing: $rp_dir" >&2; return 1; }

  export OCH_ALL8_DIR="$och_dir" RP_ALL8_DIR="$rp_dir" OUT_DIR="$materialized"
  if [[ "${RP_RESTORE_DRY_RUN:-0}" == "1" ]]; then
    echo "DRY-RUN: would materialize legacy all-8 sources → $materialized" >&2
  else
    bash "$REPO_ROOT/scripts/build-rp-hybrid-runtime-backup.sh" >&2
  fi

  RESTORE_BACKUP_DIR_ABS="$materialized"
  RESTORE_BACKUP_DIR_REL="${RESTORE_BACKUP_DIR_ABS#"$REPO_ROOT"/}"
  RP_RESTORE_LAYOUT="materialized-from-legacy-all8"
  return 0
}
