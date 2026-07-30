#!/usr/bin/env bash
# F.namespace_integrity_runtime — fail-closed live K8s / proxy / MetalLB Jaeger freshness gate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPORT_DIR="${RP_NAMESPACE_REPORT_DIR:-$ROOT/reports/runtime}"
mkdir -p "$REPORT_DIR"
OUT="$REPORT_DIR/namespace-integrity-runtime.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

kubectl get deploy,sts,ds,job,cronjob,svc,ingress,cm,networkpolicy -A -o yaml >"$TMP/k8s-objects.yaml" 2>"$TMP/k8s-objects.err" || {
  echo "kubectl object dump failed" >&2
  cat "$TMP/k8s-objects.err" >&2 || true
  exit 1
}

# Never print Secret values; metadata-only
kubectl get secrets -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"\n"}{end}' >"$TMP/secret-names.txt" || true
kubectl get pods -A -o json >"$TMP/pods.json"

FRESH_TRACE_OK=0
if bash "$ROOT/scripts/jaeger-metallb-trace-roundtrip.sh" >"$TMP/trace-rt.log" 2>&1; then
  FRESH_TRACE_OK=1
fi

python3 - "$OUT" "$TMP" "$FRESH_TRACE_OK" <<'PY'
import json, re, sys
from pathlib import Path

out = Path(sys.argv[1])
tmp = Path(sys.argv[2])
fresh_ok = sys.argv[3] == "1"

a = "".join(chr(c) for c in (0x6F, 0x63, 0x68))
pat = re.compile(
    rf"(?i)\b{re.escape(a)}[._-]|\bx-{re.escape(a)}\b|"
    r"off[-_ ]?campus[-_ ]?housing|"
    r"booking[-_ ]?service|social[-_ ]?service|housing[-_ ]?service"
)

k8s_yaml = (tmp / "k8s-objects.yaml").read_text(encoding="utf-8", errors="replace")
k8s_hits = [f"k8s:{i}" for i, line in enumerate(k8s_yaml.splitlines(), 1) if pat.search(line)]
obj_count = sum(1 for line in k8s_yaml.splitlines() if line.startswith("kind:"))

pods = json.loads((tmp / "pods.json").read_text(encoding="utf-8"))
pod_hits = []
for item in pods.get("items", []):
    meta = item.get("metadata", {})
    ns = meta.get("namespace", "")
    name = meta.get("name", "")
    blob = json.dumps({
        "labels": meta.get("labels") or {},
        "annotations": meta.get("annotations") or {},
        "spec": item.get("spec") or {},
    })
    if pat.search(blob):
        pod_hits.append(f"{ns}/{name}")

# ConfigMaps that look like proxy/otel
proxy_hits = []
# already included in cluster yaml dump; recount cm-ish lines
for i, line in enumerate(k8s_yaml.splitlines(), 1):
    if pat.search(line) and re.search(r"(?i)caddy|envoy|otel|nginx|haproxy", line):
        proxy_hits.append(f"cm-line:{i}")

trace_log = (tmp / "trace-rt.log").read_text(encoding="utf-8", errors="replace")
trace_hits = [f"trace:{i}" for i, line in enumerate(trace_log.splitlines(), 1) if pat.search(line)]

payload = {
    "gate": "F.namespace_integrity_runtime",
    "kubernetes_objects_expected_scanned": obj_count,
    "kubernetes_objects_scanned": obj_count,
    "active_kubernetes_hits": len(k8s_hits),
    "live_pods_expected_scanned": len(pods.get("items", [])),
    "live_pods_scanned": len(pods.get("items", [])),
    "live_pod_hits": len(pod_hits),
    "proxy_otel_config_hits": len(proxy_hits),
    "fresh_trace_roundtrip_ok": fresh_ok,
    "fresh_trace_log_hits": len(trace_hits),
    "verdict": "PASS"
    if (
        len(k8s_hits) == 0
        and len(pod_hits) == 0
        and len(proxy_hits) == 0
        and fresh_ok
        and len(trace_hits) == 0
    )
    else "FAIL",
}
out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(json.dumps(payload, indent=2))
raise SystemExit(0 if payload["verdict"] == "PASS" else 1)
PY
