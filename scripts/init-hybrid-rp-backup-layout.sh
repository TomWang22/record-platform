#!/usr/bin/env bash
# Layout backups/hybrid-rp-och/ with source symlinks + materialized runtime (RP ports 5433–5443).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HYBRID="$REPO_ROOT/backups/hybrid-rp-och"
RP_SRC="${RP_ALL8_DIR:-$REPO_ROOT/backups/all-8-20260312-091418}"
OCH_SRC="${OCH_ALL8_DIR:-$REPO_ROOT/backups/all-8-20260517-152701}"

mkdir -p "$HYBRID/sources" "$HYBRID/materialized-rp-runtime" "$HYBRID/post-restore"

link_src() {
  local name="$1" target="$2"
  local link="$HYBRID/sources/$name"
  [[ -d "$target" ]] || { echo "❌ missing source backup: $target" >&2; return 1; }
  rm -f "$link"
  ln -sf "$target" "$link"
  echo "✅ sources/$name → $target"
}

link_src "rp-all-8-$(basename "$RP_SRC")" "$RP_SRC"
link_src "och-all-8-$(basename "$OCH_SRC")" "$OCH_SRC"

export OCH_ALL8_DIR="$OCH_SRC" RP_ALL8_DIR="$RP_SRC"
bash "$SCRIPT_DIR/build-rp-hybrid-runtime-backup.sh"
bash "$HYBRID/validate-hybrid-backup.sh" "$HYBRID/materialized-rp-runtime"

cat >"$HYBRID/README.md" <<EOF
# Hybrid RP/OCH backup layout

OCH \`all-8-*\` folders are **source inputs only** (ports 5441–5448). They must not run as OCH containers.

RP **runtime** restore uses \`materialized-rp-runtime/\` (ports **5433–5443**).

## Sources (read-only)

- \`sources/rp-all-8-*\` — RP snapshot (5433–5440)
- \`sources/och-all-8-*\` — OCH snapshot (5441–5448)

## Materialized runtime

\`materialized-rp-runtime/\` — 11 DBs × 4 artifacts (dump, sql.gz, extensions.tsv, pg_settings.tsv).

Rebuild:

\`\`\`bash
OCH_ALL8_DIR=backups/all-8-20260517-152701 RP_ALL8_DIR=backups/all-8-20260312-091418 \\
  bash scripts/build-rp-hybrid-runtime-backup.sh
\`\`\`

## Cold bootstrap

\`\`\`bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap
\`\`\`

Resolves to \`materialized-rp-runtime\` automatically.
EOF

echo "✅ hybrid-rp-och layout ready under $HYBRID"
