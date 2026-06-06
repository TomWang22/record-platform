#!/usr/bin/env bash
# Build (if needed) and load infra/required_images.json into Colima VM Docker.
# Env: REPO_ROOT, VERIFY_REQUIRED_IMAGES_JSON, RP_SKIP_REQUIRED_IMAGE_BUILD=1 (caller already built).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
JSON="${VERIFY_REQUIRED_IMAGES_JSON:-$ROOT/infra/required_images.json}"

# shellcheck source=lib/rp-colima-running.sh
source "$SCRIPT_DIR/lib/rp-colima-running.sh"

if ! rp_colima_is_running; then
  echo "ℹ️  Colima not running — skipping required-image build/load"
  exit 0
fi

if [[ "${RP_SKIP_REQUIRED_IMAGE_BUILD:-0}" != "1" ]]; then
  REPO_ROOT="$ROOT" bash "$SCRIPT_DIR/rp-build-required-images.sh"
fi

echo "  ▶ load required images into Colima VM Docker"

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
    echo "❌ host Docker does not have $img after build step" >&2
    exit 1
  fi
  if colima ssh -- docker image inspect "$img" >/dev/null 2>&1; then
    echo "  ✅ ${img} present in Colima"
    continue
  fi
  echo "  ▶ loading ${img} into Colima VM Docker…"
  docker save "$img" | colima ssh -- docker load
  colima ssh -- docker image inspect "$img" >/dev/null 2>&1 || {
    echo "❌ ${img} missing in Colima after docker load" >&2
    exit 1
  }
  echo "  ✅ ${img} present in Colima"
done

echo "✅ required images present in Colima VM Docker"
