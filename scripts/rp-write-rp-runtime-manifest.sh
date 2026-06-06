#!/usr/bin/env bash
# Write manifest.json (port contract v3) for an RP-native backup directory (rp-all-11-* or materialized).
# Usage: bash scripts/rp-write-rp-runtime-manifest.sh /path/to/backups/rp-all-11-YYYYMMDD-HHMMSS
set -euo pipefail

BACKUP_DIR="${1:-}"
[[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]] || {
  echo "Usage: $0 <backup-dir>" >&2
  exit 1
}
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
OUT="${BACKUP_DIR}/manifest.json"

python3 - "$BACKUP_DIR" "$OUT" <<'PY'
import json, os, sys
from datetime import datetime, timezone

backup_dir, out_path = sys.argv[1], sys.argv[2]

# service_key, target_port, db_name, filename slug (without port prefix)
SERVICES = [
    ("records", 5433, "records", "records"),
    ("messaging", 5434, "messaging", "messaging"),
    ("listings", 5435, "listings", "listings"),
    ("shopping", 5436, "shopping", "shopping"),
    ("auth", 5437, "auth", "auth"),
    ("postgres_core", 5438, "postgres", "postgres"),
    ("analytics", 5439, "analytics", "analytics"),
    ("python_ai", 5440, "python_ai", "python-ai"),
    ("notification", 5441, "notification", "notification"),
    ("trust", 5442, "trust", "trust"),
    ("media", 5443, "media", "media"),
]

assignments = []
for svc, port, db, slug in SERVICES:
    dumps = sorted(
        f for f in os.listdir(backup_dir) if f.startswith(f"{port}-") and f.endswith(".dump")
    )
    if not dumps:
        raise SystemExit(f"missing .dump for port {port} ({svc}) under {backup_dir}")
    dump_name = dumps[0]
    dump = os.path.join(backup_dir, dump_name)
    base = dump_name.replace(".dump", "")

    artifacts = []
    for bn in (
        f"{base}-extensions.tsv",
        f"{base}-pg_settings.tsv",
        f"{base}.dump",
        f"{base}.sql.gz",
    ):
        path = os.path.join(backup_dir, bn)
        if os.path.isfile(path):
            artifacts.append({"basename": bn, "path": path})

    assignments.append({
        "service": svc,
        "source_path": dump,
        "source_backup_port": port,
        "target_port": port,
        "target_database": db,
        "policy_key": f"rp_{svc}_{port}",
        "note": f"rp-{svc}",
        "active": True,
        "materialized_path": dump,
        "link_path": dump,
        "artifacts": artifacts,
    })

doc = {
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "port_contract_version": 3,
    "source_layout": "rp-all-11",
    "materialization": "native",
    "runtime_model": "RP native backup — 11 databases on host ports 5433–5443",
    "output_dir": backup_dir,
    "restore_order": [
        "auth", "records", "listings", "messaging", "shopping",
        "postgres_core", "analytics", "python_ai", "notification", "trust", "media",
    ],
    "excluded_services": ["bookings", "social"],
    "skipped": {
        "bookings": {"active": False, "reason": "not part of RP runtime contract"},
        "social": {"active": False, "reason": "messaging uses port 5434 at runtime"},
    },
    "policy_flags": {
        "bookings": "skipped",
        "social": "skipped",
    },
    "assignments": assignments,
}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
print(out_path)
PY

echo "✅ wrote $OUT"
