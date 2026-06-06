#!/usr/bin/env bash
# Materialize hybrid RP runtime backup: copy extensions, pg_settings, dump, sql.gz into
# backups/hybrid-rp-och/materialized-rp-runtime/ with RP runtime port filenames (5433–5443).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

LEGACY_SOURCE_ALL8_DIR="${LEGACY_SOURCE_ALL8_DIR:-${OCH_ALL8_DIR:-$REPO_ROOT/backups/all-8-20260517-152701}}"
RP_ALL8_DIR="${RP_ALL8_DIR:-$REPO_ROOT/backups/all-8-20260312-091418}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/backups/hybrid-rp-och/materialized-rp-runtime}"
DRY_RUN="${DRY_RUN:-0}"

log() { printf '%s\n' "$*"; }
run() { [[ "$DRY_RUN" == "1" ]] && log "[dry-run] $*" || "$@"; }

# runtime_port:service:source_kind:source_port:source_name:policy_key:note
ASSIGNMENTS=(
  "5433:records:rp:5433:records:rp_records_5433_to_runtime_5433:rp-records"
  "5434:messaging:legacy:5444:messaging:legacy_messaging_5444_to_runtime_5434:legacy-messaging"
  "5435:listings:legacy:5442:listings:legacy_listings_5442_to_runtime_5435:legacy-listings-hybrid-base"
  "5436:shopping:rp:5436:shopping:rp_shopping_5436_to_runtime_5436:rp-shopping"
  "5437:auth:rp:5437:auth:rp_auth_5437_to_runtime_5437:rp-auth"
  "5438:auction_monitor_core:rp:5438:postgres:rp_postgres_5438_to_runtime_5438:auction-monitor-core"
  "5439:analytics:legacy:5447:analytics:legacy_analytics_5447_to_runtime_5439:legacy-analytics"
  "5440:python_ai:rp:5440:python_ai:rp_python_ai_5440_to_runtime_5440:rp-python-ai"
  "5441:notification:legacy:5445:notification:legacy_notification_5445_to_runtime_5441:legacy-notification"
  "5442:trust:legacy:5446:trust:legacy_trust_5446_to_runtime_5442:legacy-trust"
  "5443:media:legacy:5448:media:legacy_media_5448_to_runtime_5443:legacy-media"
)

src_dir_for() {
  case "$1" in
    rp) printf '%s' "$RP_ALL8_DIR" ;;
    legacy) printf '%s' "$LEGACY_SOURCE_ALL8_DIR" ;;
    *) return 1 ;;
  esac
}

copy_artifact() {
  local src="$1" dest="$2"
  [[ -f "$src" ]] || return 1
  run mkdir -p "$(dirname "$dest")"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] cp -a '$src' '$dest'"
  else
    cp -a "$src" "$dest"
  fi
}

[[ -d "$LEGACY_SOURCE_ALL8_DIR" ]] || { log "ERROR: missing LEGACY_SOURCE_ALL8_DIR=$LEGACY_SOURCE_ALL8_DIR"; exit 1; }
[[ -d "$RP_ALL8_DIR" ]] || { log "ERROR: missing RP_ALL8_DIR=$RP_ALL8_DIR"; exit 1; }

if [[ "$DRY_RUN" != "1" ]]; then
  run rm -rf "$OUT_DIR"
fi
run mkdir -p "$OUT_DIR"

log "Materializing hybrid backup → $OUT_DIR"

MANIFEST_ROWS=()
for row in "${ASSIGNMENTS[@]}"; do
  IFS=':' read -r tport svc src_kind sport sname pkey note <<<"$row"
  src_root="$(src_dir_for "$src_kind")"
  base="${sport}-${sname}"
  db_slug="$svc"
  [[ "$svc" == "auction_monitor_core" || "$svc" == "postgres_core" ]] && db_slug="postgres"
  runtime_base="${tport}-${db_slug}"
  copied=0
  has_restore=0

  for kind in extensions pg_settings; do
    if copy_artifact "$src_root/${base}-${kind}.tsv" "$OUT_DIR/${runtime_base}-${kind}.tsv"; then
      copied=$((copied + 1))
    fi
  done
  for ext in dump sql.gz; do
    if copy_artifact "$src_root/${base}.${ext}" "$OUT_DIR/${runtime_base}.${ext}"; then
      copied=$((copied + 1))
      has_restore=1
    fi
  done

  if [[ "$has_restore" -eq 0 ]]; then
    log "ERROR: no dump/sql.gz for $svc (source $base in $src_root)"
    exit 1
  fi

  primary="$OUT_DIR/${runtime_base}.dump"
  [[ -f "$primary" ]] || primary="$OUT_DIR/${runtime_base}.sql.gz"
  MANIFEST_ROWS+=("${svc}|${src_root}/${base}|${sport}|${tport}|${db_slug}|${pkey}|${note}|${primary}")
  log "  ${runtime_base} ← ${base} (${copied} files, src=${src_kind})"
done

overlay_base="5435-listings"
if [[ -f "$RP_ALL8_DIR/${overlay_base}.dump" ]]; then
  copy_artifact "$RP_ALL8_DIR/${overlay_base}.dump" "$OUT_DIR/listings-rp-overlay-${overlay_base}.dump" || true
  copy_artifact "$RP_ALL8_DIR/${overlay_base}.sql.gz" "$OUT_DIR/listings-rp-overlay-${overlay_base}.sql.gz" || true
  log "  listings-rp-overlay reference ← ${overlay_base} (post-restore SQL hook only)"
fi

ROWS_FILE="$(mktemp)"
printf '%s\n' "${MANIFEST_ROWS[@]}" >"$ROWS_FILE"
trap 'rm -f "$ROWS_FILE"' EXIT

MANIFEST="$OUT_DIR/manifest.json"
python3 - "$MANIFEST" "$OUT_DIR" "$LEGACY_SOURCE_ALL8_DIR" "$RP_ALL8_DIR" "$ROWS_FILE" <<'PY'
import json, os, sys, datetime, hashlib

manifest_path, out_dir, legacy_dir, rp_dir, rows_file = sys.argv[1:6]
with open(rows_file, encoding="utf-8") as rf:
    rows_in = [ln for ln in rf.read().splitlines() if ln.strip()]
assignments = []
for line in rows_in:
    if not line.strip():
        continue
    parts = line.split("|")
    svc, src_prefix, sport, tport, tdb, pkey, note, primary = parts[:8]
    tport_i, sport_i = int(tport), int(sport)
    runtime_base = f"{tport_i}-{tdb}"
    artifacts = []
    for suffix in ("-extensions.tsv", "-pg_settings.tsv", ".dump", ".sql.gz"):
        p = os.path.join(out_dir, runtime_base + suffix)
        if not os.path.isfile(p):
            continue
        st = os.stat(p)
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        artifacts.append({
            "path": p,
            "basename": os.path.basename(p),
            "size_bytes": st.st_size,
            "sha256": h.hexdigest(),
        })
    dump_art = next((a for a in artifacts if a["basename"].endswith(".dump")), None)
    sql_art = next((a for a in artifacts if a["basename"].endswith(".sql.gz")), None)
    restore_file = dump_art["path"] if dump_art else sql_art["path"]
    assignments.append({
        "service": svc,
        "source_path": src_prefix,
        "source_backup_port": sport_i,
        "target_port": tport_i,
        "target_database": tdb,
        "policy_key": pkey,
        "note": note,
        "active": True,
        "materialized_path": restore_file,
        "link_path": restore_file,
        "artifacts": artifacts,
        "sha256": dump_art["sha256"] if dump_art else sql_art["sha256"],
        "size_bytes": dump_art["size_bytes"] if dump_art else sql_art["size_bytes"],
    })

skipped = {
    "bookings": {"active": False, "reason": "not part of RP 11-DB contract", "source_glob": "5443-bookings.*"},
    "social": {"active": False, "reason": "messaging uses port 5434 at runtime", "source_glob": "5434-social.*"},
    "legacy_auth_5441": {"active": False, "reason": "auth restored from 5437 only", "source_glob": "5441-auth.*"},
    "old_rp_analytics_5439": {"active": False, "reason": "superseded by runtime 5439 analytics", "source_glob": "5439-analytics.*"},
    "old_rp_listings_5435": {
        "active": False,
        "reason": "overlay reference only; live listings on runtime 5435",
        "post_restore_sql": "backups/hybrid-rp-och/post-restore/5435-listings-rp-overlay.sql",
    },
}

doc = {
    "generated_at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    "port_contract_version": 3,
    "materialization": "copy",
    "runtime_model": "RP contiguous host ports 5433-5443; legacy source dumps materialized to runtime filenames",
    "output_dir": out_dir,
    "restore_order": [
        "auth", "records", "listings", "messaging", "shopping", "auction_monitor_core",
        "analytics", "python_ai", "notification", "trust", "media",
    ],
    "excluded_services": ["bookings", "social"],
    "skipped": skipped,
    "policy_flags": {
        "bookings": "skipped",
        "social": "skipped",
        "legacy_auth_5441": "skipped",
        "old_rp_analytics_5439": "skipped",
        "legacy_analytics_5447_to_runtime_5439": "active",
        "legacy_media_5448_to_runtime_5443": "active",
        "legacy_trust_5446_to_runtime_5442": "active",
        "legacy_notification_5445_to_runtime_5441": "active",
        "legacy_messaging_5444_to_runtime_5434": "active",
        "rp_auth_5437_to_runtime_5437": "active",
    },
    "source_dirs": {"legacy_all8": legacy_dir, "rp_all8": rp_dir},
    "assignments": assignments,
}
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
with open(os.path.join(out_dir, "skipped.json"), "w", encoding="utf-8") as f:
    json.dump(skipped, f, indent=2)
    f.write("\n")
with open(os.path.join(out_dir, "restore-order.txt"), "w", encoding="utf-8") as f:
    for svc in doc["restore_order"]:
        a = next(x for x in assignments if x["service"] == svc)
        f.write(f"{a['target_port']}\t{a['target_database']}\t{os.path.basename(a['materialized_path'])}\n")
ready = os.path.join(out_dir, "restore-ready")
os.makedirs(ready, exist_ok=True)
for a in assignments:
    src = a["materialized_path"]
    ext = ".dump" if src.endswith(".dump") else ".sql.gz"
    dest = os.path.join(ready, f"{a['target_port']}-{a['target_database']}{ext}")
    if os.path.lexists(dest):
        os.remove(dest)
    os.symlink(os.path.abspath(src), dest)
print(manifest_path)
PY

log "Wrote $MANIFEST"
log "Validate: bash backups/hybrid-rp-och/validate-hybrid-backup.sh $OUT_DIR"
