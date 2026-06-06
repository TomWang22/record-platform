#!/usr/bin/env bash
# Validate external-infra compose contract used by cold-bootstrap.
# The compose file may include app services; this contract only enforces
# the external-infra subset needed by RP bootstrap.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.yml}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; FAIL=1; }

FAIL=0

if [[ ! -f "$COMPOSE_FILE" ]]; then
  bad "missing compose file: $COMPOSE_FILE"
  exit 1
fi

cd "$REPO_ROOT"
if ! docker compose -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
  bad "docker compose config failed for $COMPOSE_FILE"
  docker compose -f "$COMPOSE_FILE" config 2>&1 | tail -20 >&2 || true
  exit 1
fi

mapfile -t SERVICES < <(docker compose -f "$COMPOSE_FILE" config --services 2>/dev/null | sort)

EXTERNAL_SERVICES=(
  jaeger mailpit minio redis
  postgres-records postgres-messaging postgres-listings postgres-shopping postgres-auth
  postgres-auction-monitor-core postgres-analytics postgres-python-ai
  postgres-notification postgres-trust postgres-media
  postgres-backup
)
REQUIRED_EXTERNAL_SERVICE_GROUPS=(
  "redis"
  "postgres,postgres-records"
  "postgres-listings"
  "postgres-shopping"
  "postgres-auth"
  "postgres-analytics"
  "postgres-python-ai"
)

say "=== RP compose contract (services) ==="
echo "services: ${SERVICES[*]}"

for group in "${REQUIRED_EXTERNAL_SERVICE_GROUPS[@]}"; do
  _found=0
  IFS=',' read -r -a _candidates <<< "$group"
  for req in "${_candidates[@]}"; do
    if printf '%s\n' "${SERVICES[@]}" | grep -qx "$req"; then
      ok "required external service present: $req"
      _found=1
      break
    fi
  done
  if [[ "$_found" -eq 0 ]]; then
    bad "missing required external service group in compose: one of [$group]"
  fi
done

_CONFIG="$(docker compose -f "$COMPOSE_FILE" config 2>/dev/null)"

say "=== RP compose contract (host ports) ==="
mapfile -t HOST_PORTS < <(COMPOSE_FILE="$COMPOSE_FILE" python3 <<'PY'
import json, os, subprocess, sys

compose = os.environ["COMPOSE_FILE"]
external = {
    "jaeger", "mailpit", "minio", "redis",
    "postgres-records", "postgres-messaging", "postgres-listings", "postgres-shopping", "postgres-auth",
    "postgres-auction-monitor-core", "postgres-analytics", "postgres-python-ai",
    "postgres-notification", "postgres-trust", "postgres-media",
    "postgres-backup",
}
r = subprocess.run(
    ["docker", "compose", "-f", compose, "config", "--format", "json"],
    capture_output=True,
    text=True,
)
if r.returncode != 0:
    print(r.stderr, file=sys.stderr)
    sys.exit(1)
cfg = json.loads(r.stdout)
ports = set()
for svc, spec in (cfg.get("services") or {}).items():
    if svc not in external:
        continue
    for p in spec.get("ports") or []:
        if isinstance(p, str) and ":" in p:
            host = p.split(":", 1)[0]
            if host.isdigit():
                ports.add(int(host))
        elif isinstance(p, dict):
            pub = p.get("published")
            if pub is not None:
                ports.add(int(pub))
for p in sorted(ports):
    print(p)
PY
)

ALLOWED_PORTS=(5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443 6379 9000 9001 1025 8025 16686 4318)
FORBIDDEN_PORTS=(5444 5445 5446 5447 5448 6380 29093 9092 2181 4000 4001 4002 4003 4004 4007 4010 3000 3001 5005 8080 8081 8082 8404 9091 9101 9113)

for p in "${HOST_PORTS[@]}"; do
  [[ -z "$p" ]] && continue
  _ok=0
  for a in "${ALLOWED_PORTS[@]}"; do
    [[ "$p" == "$a" ]] && _ok=1 && break
  done
  if [[ "$_ok" -eq 0 ]]; then
    bad "forbidden or unexpected published host port: $p"
  fi
done

for p in "${FORBIDDEN_PORTS[@]}"; do
  if printf '%s\n' "${HOST_PORTS[@]}" | grep -qx "$p"; then
    bad "forbidden host port published: $p"
  fi
done

for p in "${ALLOWED_PORTS[@]}"; do
  printf '%s\n' "${HOST_PORTS[@]}" | grep -qx "$p" || true
done
ok "published host ports: $(printf '%s ' "${HOST_PORTS[@]}")"

if [[ "$FAIL" -ne 0 ]]; then
  say "=== RP compose contract FAILED ==="
  exit 1
fi

ok "compose contract OK (${#SERVICES[@]} services declared; external infra subset validated)"
exit 0
