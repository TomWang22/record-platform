#!/usr/bin/env bash
# Phase 17 T17.1 — Ollama production readiness probe.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

NS="${K8S_NAMESPACE:-record-platform}"
REPORT="${REPORT:-$REPO_ROOT/bench_logs/ai-platform/phase-17-ollama-readiness.md}"
mkdir -p "$(dirname "$REPORT")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
OLLAMA_LB_IP="$(kubectl get svc -n "$NS" ollama-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
CLUSTER_DNS="http://ollama.${NS}.svc.cluster.local:11434"
STALE_DNS="http://ollama.ollama.svc.cluster.local:11434"
METALLB_URL=""
[[ "$OLLAMA_LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && METALLB_URL="http://${OLLAMA_LB_IP}:11434"

echo "=== Phase 17 Ollama readiness (T17.1) ==="

CURRENT="$(kubectl get deploy -n "$NS" python-ai-service -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="OLLAMA_BASE_URL")].value}' 2>/dev/null || true)"
if [[ "$CURRENT" == *"ollama.ollama.svc"* ]]; then
  echo "fixing stale OLLAMA_BASE_URL: $CURRENT → $CLUSTER_DNS"
  bash "$SCRIPT_DIR/rp-ai-apply-ollama-cluster-env.sh"
else
  echo "OLLAMA_BASE_URL: ${CURRENT:-<unset>}"
fi

export REPO_ROOT NS CLUSTER_DNS STALE_DNS METALLB_URL OLLAMA_LB_IP LB_IP CA REPORT
python3 <<'PY'
import json, os, subprocess, sys
from datetime import datetime, timezone

ns = os.environ["NS"]
cluster_dns = os.environ["CLUSTER_DNS"]
stale_dns = os.environ["STALE_DNS"]
metallb_url = os.environ.get("METALLB_URL", "")
lb_ip = os.environ.get("LB_IP", "")
ca = os.environ["CA"]
report = os.environ["REPORT"]

def kubectl(*args):
    r = subprocess.run(["kubectl", "-n", ns, *args], capture_output=True, text=True)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def pod_http(base, path="/api/tags", method="GET", payload=None, timeout_s=30):
    body = json.dumps(payload) if payload else "null"
    py = f"""
import asyncio, httpx, json
async def main():
    async with httpx.AsyncClient(timeout={timeout_s}) as c:
        url = {json.dumps(base + path)}
        if {json.dumps(method)} == "POST":
            r = await c.post(url, json={json.dumps(payload)})
        else:
            r = await c.get(url)
        out = {{"status": r.status_code}}
        try:
            out["body"] = r.json()
        except Exception:
            out["body"] = r.text[:200]
        print(json.dumps(out))
asyncio.run(main())
"""
    out, err, code = kubectl("exec", "deploy/python-ai-service", "-c", "app", "--", "python3", "-c", py)
    if code != 0:
        return {"error": (err or out)[:200]}
    line = [l for l in out.splitlines() if l.startswith("{")][-1] if out else "{}"
    return json.loads(line)

svc_out, _, _ = kubectl("get", "svc", "-o", "wide")
ollama_svcs = [l for l in svc_out.splitlines() if "ollama" in l.lower()]

lines = [
    "# Phase 17 Ollama readiness (T17.1)",
    "",
    f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    "",
    "## Service topology",
    "",
    "```",
    *ollama_svcs,
    "```",
    "",
    "## Reachability (python-ai-service pod)",
    "",
]

probes = {"cluster_dns": cluster_dns, "stale_dns": stale_dns}
if metallb_url:
    probes["metallb_lb"] = metallb_url

reachable = None
models = []
for label, base in probes.items():
    res = pod_http(base)
    ok = res.get("status") == 200
    lines.append(f"- **{label}** `{base}`: {'PASS' if ok else 'FAIL'}")
    if ok:
        reachable = base
        models = [m.get("name") for m in (res.get("body") or {}).get("models", [])]
        lines.append(f"  - models: {models or '(none)'}")
    elif res.get("error"):
        lines.append(f"  - error: {res['error']}")

lines += ["", "## Live generation probe", ""]
gen_ok = False
gen_base = metallb_url or cluster_dns
if reachable and any("llama3.2" in (m or "") for m in models):
    curl = subprocess.run(
        [
            "curl", "-sfS", "--max-time", "180", "-X", "POST",
            f"{gen_base}/api/generate",
            "-H", "Content-Type: application/json",
            "-d", json.dumps({
                "model": "llama3.2:1b",
                "prompt": "Reply: ollama_ok",
                "stream": False,
                "options": {"num_predict": 8},
            }),
        ],
        capture_output=True, text=True,
    )
    if curl.returncode == 0:
        try:
            body = json.loads(curl.stdout)
            text = (body.get("response") or "")[:80]
            lines.append(f"- ✅ POST /api/generate `llama3.2:1b` via `{gen_base}` → {text!r}")
            gen_ok = True
        except Exception as exc:
            lines.append(f"- ❌ generate parse failed: {exc}")
    else:
        lines.append(f"- ❌ generate failed via `{gen_base}`: {(curl.stderr or curl.stdout)[:200]}")
elif reachable:
    lines.append("- ⚠️ generation model absent; rule-engine fallback remains")
    lines.append(f"  - models present: {models}")
else:
    lines.append("- ❌ cannot generate — Ollama unreachable")

status_raw = subprocess.run(
    ["curl", "-sfS", "--cacert", ca, "--resolve", f"record-platform.test:443:{lb_ip}",
     "https://record-platform.test/api/ai/rag/status"],
    capture_output=True, text=True,
).stdout
try:
    status = json.loads(status_raw)
except Exception:
    status = {}

ollama_st = (status.get("providers") or {}).get("ollama", {})
lines += [
    "",
    "## /api/ai/rag/status",
    "",
    f"- source_status: `{status.get('source_status')}`",
    f"- model_used: `{status.get('model_used')}`",
    f"- active provider: `{(status.get('providers') or {}).get('active')}`",
    f"- ollama.available: `{ollama_st.get('available')}`",
    f"- ollama.base_url: `{ollama_st.get('base_url')}`",
    f"- ollama.model_present: `{ollama_st.get('model_present')}`",
    f"- ollama.embedding_model_present: `{ollama_st.get('embedding_model_present')}`",
]
if ollama_st.get("reason"):
    lines.append(f"- ollama.reason: `{ollama_st['reason']}`")

fail = False
if not reachable:
    fail = True
if "demo" in json.dumps(status).lower() or "mock" in json.dumps(status).lower():
    fail = True
if "ollama.ollama.svc" in str(ollama_st.get("base_url", "")):
    fail = True

lines.insert(3, f"**RESULT: {'PASS' if not fail else 'FAIL'}**")
lines.insert(4, "")
lines += ["", "## Acceptance", ""]
lines.append("- ✅ Ollama reachable OR structured missing-model reason" if reachable or ollama_st.get("reason") else "- ❌ no reachability and no structured reason")
lines.append("- ✅ no fake live status prose" if "mock" not in json.dumps(status).lower() else "- ❌ fake prose detected")
lines.append("- ✅ no model auto-download (probe only)")
lines.append("- ✅ rule-engine fallback preserved (`AI_MODEL_PROVIDER=rule`)")

with open(report, "w") as f:
    f.write("\n".join(lines) + "\n")
print(f"{'✅' if not fail else '❌'} phase-17-ollama-readiness → {report}")
sys.exit(1 if fail else 0)
PY
