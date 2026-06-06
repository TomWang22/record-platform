#!/usr/bin/env bash
# Verify each image in infra/required_images.json is present in Colima VM Docker (same runtime k3s uses).
# Env: REPO_ROOT, VERIFY_REQUIRED_IMAGES_JSON — overrides.
# Exit 1 if any required image missing.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
JSON="${VERIFY_REQUIRED_IMAGES_JSON:-$ROOT/infra/required_images.json}"

# shellcheck source=lib/rp-colima-running.sh
source "$SCRIPT_DIR/lib/rp-colima-running.sh"

if ! rp_colima_is_running; then
  echo "ℹ️  Colima not running — skipping required-image verify (not applicable)"
  exit 0
fi

missing=0
mapfile -t _rp_required_images < <(JSON="$JSON" python3 <<'PY'
import json
import os
with open(os.environ["JSON"], encoding="utf-8") as fh:
    d = json.load(fh)
for im in d.get("images") or []:
    if isinstance(im, str) and im.strip():
        print(im.strip())
PY
)
for img in "${_rp_required_images[@]}"; do
  [[ -z "$img" ]] && continue
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "❌ missing on host Docker: $img" >&2
    missing=1
    continue
  fi
  echo "✅ $img (host Docker)"
  if colima ssh -- docker image inspect "$img" >/dev/null 2>&1; then
    echo "✅ $img (Colima VM Docker)"
  else
    echo "❌ missing in Colima VM Docker: $img" >&2
    missing=1
  fi
done

exit "$missing"
