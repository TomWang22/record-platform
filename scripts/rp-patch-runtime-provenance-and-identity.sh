#!/usr/bin/env bash
# Inject RP_SOURCE_SHA, pod Downward API, OTEL resource attrs, and drain preStop on RP app Deployments.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-record-platform}"
SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short=12 HEAD)"
BUILD_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BUILD_ID="local-${SHORT}"

DEPLOYS=(
  analytics-service api-gateway auction-monitor auth-service listings-service
  media-service messaging-service notification-service python-ai-service
  records-service shopping-service trust-service webapp
  ollama-gateway ollama-worker
)

port_for() {
  # Canonical HTTP ports from infra/contracts/rp-service-runtime-contract.json
  case "$1" in
    api-gateway) echo 4000 ;;
    auth-service) echo 4001 ;;
    records-service) echo 4002 ;;
    shopping-service) echo 4007 ;;
    auction-monitor) echo 4008 ;;
    listings-service) echo 4012 ;;
    messaging-service) echo 4014 ;;
    notification-service) echo 4015 ;;
    trust-service) echo 4016 ;;
    analytics-service) echo 4017 ;;
    media-service) echo 4018 ;;
    python-ai-service) echo 5005 ;;
    webapp) echo 3001 ;;
    ollama-gateway) echo 8081 ;;
    ollama-worker) echo 9100 ;;
    *) echo 0 ;;
  esac
}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }

say "=== rp-patch-runtime-provenance (sha=$SHORT) ==="

for d in "${DEPLOYS[@]}"; do
  if ! kubectl -n "$NS" get deploy "$d" &>/dev/null; then
    echo "ℹ️  skip $d"
    continue
  fi
  port="$(port_for "$d")"
  in="$(mktemp)"
  out="$(mktemp)"
  kubectl -n "$NS" get deploy "$d" -o json >"$in"
  python3 - "$in" "$out" "$d" "$SHA" "$BUILD_TS" "$BUILD_ID" "$port" <<'PY'
import json, sys
in_path, out_path, name, sha, build_ts, build_id, port = sys.argv[1:8]
dep = json.load(open(in_path))
dep.pop("status", None)
md = dep.setdefault("metadata", {})
for k in ("resourceVersion", "uid", "generation", "creationTimestamp", "managedFields"):
  md.pop(k, None)
spec = dep["spec"]["template"]["spec"]
spec["terminationGracePeriodSeconds"] = max(int(spec.get("terminationGracePeriodSeconds") or 0), 30)

def ensure_env(container):
  env = container.setdefault("env", [])
  by = {e.get("name"): e for e in env if e.get("name")}
  def setv(k, v):
    by[k] = {"name": k, "value": v}
  def setf(k, path):
    by[k] = {"name": k, "valueFrom": {"fieldRef": {"fieldPath": path}}}
  setv("RP_SOURCE_SHA", sha)
  setv("RP_BUILD_TIMESTAMP", build_ts)
  setv("RP_BUILD_ID", build_id)
  setv("RP_IMAGE_TAG", "dev")
  setv("SERVICE_NAME", name)
  setv("RP_SERVICE_NAME", name)
  setv("OTEL_SERVICE_NAME", name)
  setf("POD_NAME", "metadata.name")
  setf("RP_POD_NAME", "metadata.name")
  setf("POD_UID", "metadata.uid")
  setf("RP_POD_UID", "metadata.uid")
  setf("POD_NAMESPACE", "metadata.namespace")
  setv("RP_KAFKA_CLIENT_ID_STRICT", "1")
  attrs = f"service.name={name},service.version={sha[:12]},deployment.environment=local,rp.source_sha={sha}"
  setv("OTEL_RESOURCE_ATTRIBUTES", attrs)
  container["env"] = list(by.values())
  life = container.setdefault("lifecycle", {})
  if int(port) > 0:
    life["preStop"] = {
      "exec": {
        "command": [
          "sh", "-lc",
          f"wget -qO- --post-data= http://127.0.0.1:{port}/internal/drain >/dev/null 2>&1 || curl -sf -X POST http://127.0.0.1:{port}/internal/drain >/dev/null 2>&1 || true; sleep 3",
        ]
      }
    }
  else:
    life["preStop"] = {"exec": {"command": ["sh", "-lc", "sleep 3"]}}

for c in spec.get("containers") or []:
  cname = c.get("name") or ""
  if cname in ("app", "web", "webapp", "worker", "gateway") or len(spec.get("containers") or []) == 1:
    ensure_env(c)

json.dump(dep, open(out_path, "w"))
PY
  kubectl replace -f "$out" >/dev/null
  rm -f "$in" "$out"
  ok "patched $d provenance+preStop (port=$port)"
done

say "Done."
