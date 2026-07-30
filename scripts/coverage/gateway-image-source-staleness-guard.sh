#!/usr/bin/env bash
# Warn if local api-gateway:dev image was built before the latest commit touching
# route coverage middleware or gateway server (stale image → no /tmp/rp-routes-hit.jsonl).
# Exit 0 always (warnings only). SKIP_GATEWAY_IMAGE_STALENESS_GUARD=1 skips.
# GATEWAY_STALENESS_GUARD_STRICT=1 → exit 1 when stale (CI / operator opt-in).
set -euo pipefail

if [[ "${SKIP_GATEWAY_IMAGE_STALENESS_GUARD:-0}" == "1" ]]; then
  echo "gateway-image-source-staleness-guard: skipped (SKIP_GATEWAY_IMAGE_STALENESS_GUARD=1)"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FILES=(
  "services/api-gateway/src/route-coverage-middleware.ts"
  "services/api-gateway/src/server.ts"
)

if ! command -v git >/dev/null 2>&1; then
  echo "gateway-image-source-staleness-guard: git not on PATH — skip" >&2
  exit 0
fi

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "gateway-image-source-staleness-guard: not a git repo — skip" >&2
  exit 0
fi

GIT_TS="$(git -C "$ROOT" log -1 --format=%ct -- "${FILES[@]}" 2>/dev/null || echo 0)"
if [[ -z "$GIT_TS" || "$GIT_TS" == "0" ]]; then
  echo "gateway-image-source-staleness-guard: could not resolve git timestamp for gateway sources — skip" >&2
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "gateway-image-source-staleness-guard: docker not on PATH — skip" >&2
  exit 0
fi

if ! docker image inspect api-gateway:dev >/dev/null 2>&1; then
  echo "⚠️  Gateway image freshness: no local api-gateway:dev image (build with: make rebuild-api-gateway)" >&2
  exit 0
fi

CREATED_RAW="$(docker image inspect api-gateway:dev --format '{{.Created}}' 2>/dev/null || true)"
if [[ -z "$CREATED_RAW" ]]; then
  echo "gateway-image-source-staleness-guard: docker inspect produced empty Created — skip" >&2
  exit 0
fi

# RFC3339 / Docker: 2026-05-01T12:34:56.123456789Z
IMG_TS="$(
  CREATED_RAW="$CREATED_RAW" python3 <<'PY'
import os
from datetime import datetime, timezone

def parse_created(raw: str) -> int:
    raw = raw.strip()
    if not raw:
        return 0
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        try:
            dt = datetime.fromisoformat(raw[:19] + "+00:00")
        except ValueError:
            return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())

try:
    print(parse_created(os.environ.get("CREATED_RAW", "")))
except Exception:
    print(0)
PY
)"

if [[ "$IMG_TS" == "0" ]]; then
  echo "gateway-image-source-staleness-guard: could not parse image Created time — skip" >&2
  exit 0
fi

# Allow small clock / ordering slack (image same minute as commit)
SLACK="${GATEWAY_STALENESS_GUARD_SLACK_SEC:-120}"
if (( IMG_TS + SLACK < GIT_TS )); then
  GIT_ISO="$(git -C "$ROOT" log -1 --format=%ci -- "${FILES[@]}")"
  echo "⚠️  Gateway image older than source tree: api-gateway:dev created ~epoch $IMG_TS but last commit on route-coverage/server is epoch $GIT_TS ($GIT_ISO)." >&2
  echo "    Rebuild: rm -f .build-cache/api-gateway.src.hash && make rebuild-api-gateway   (or TRACE_GUARD_REBUILD_NO_CACHE=1 make rebuild-api-gateway)" >&2
  if [[ "${GATEWAY_STALENESS_GUARD_STRICT:-0}" == "1" ]]; then
    exit 1
  fi
fi

exit 0
