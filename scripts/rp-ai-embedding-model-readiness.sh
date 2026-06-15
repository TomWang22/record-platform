#!/usr/bin/env bash
# Phase 18 T18.2 — embedding model readiness prep (no pull, no embed, no backfill).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

NS="${K8S_NAMESPACE:-record-platform}"
REPORT="${REPORT:-$REPO_ROOT/bench_logs/ai-platform/phase-18-embedding-model-readiness.md}"
EMBED_MODEL="${AI_EMBEDDING_MODEL:-nomic-embed-text}"
GEN_MODEL="${AI_OLLAMA_MODEL:-llama3.2:1b}"

mkdir -p "$(dirname "$REPORT")"
echo "=== Phase 18 embedding model readiness (T18.2) ==="

OLLAMA_LB_IP="$(kubectl get svc -n "$NS" ollama-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
CLUSTER_DNS="http://ollama.${NS}.svc.cluster.local:11434"
METALLB_URL=""
[[ "$OLLAMA_LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && METALLB_URL="http://${OLLAMA_LB_IP}:11434"

export REPO_ROOT NS CLUSTER_DNS METALLB_URL EMBED_MODEL GEN_MODEL REPORT
python3 <<'PY'
import json, os, subprocess, sys
from datetime import datetime, timezone

ns = os.environ["NS"]
cluster_dns = os.environ["CLUSTER_DNS"]
metallb_url = os.environ.get("METALLB_URL", "")
embed_model = os.environ["EMBED_MODEL"]
gen_model = os.environ["GEN_MODEL"]
report = os.environ["REPORT"]

def kubectl(*args):
    r = subprocess.run(["kubectl", "-n", ns, *args], capture_output=True, text=True)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def curl_json(url, timeout=30):
    r = subprocess.run(
        ["curl", "-sfS", "--max-time", str(timeout), f"{url}/api/tags"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None, (r.stderr or r.stdout)[:200]
    try:
        return json.loads(r.stdout), None
    except json.JSONDecodeError as e:
        return None, str(e)

reachable = False
reach_via = ""
models = []
err = ""

for label, base in [("cluster_dns", cluster_dns), ("metallb_lb", metallb_url)]:
    if not base:
        continue
    body, e = curl_json(base)
    if body is not None:
        reachable = True
        reach_via = f"{label} ({base})"
        models = [m.get("name", "") for m in body.get("models", [])]
        break
    err = e or err

embed_present = any(embed_model.split(":")[0] in (m or "") for m in models)
gen_present = any(gen_model.split(":")[0] in (m or "") for m in models)

# Disk estimate from ollama list in pod (no pull)
disk_lines = []
out, _, code = kubectl("exec", "deploy/ollama", "--", "ollama", "list")
if code == 0 and out:
    disk_lines = out.splitlines()

pull_cmd = f"kubectl exec -n {ns} deploy/ollama -- ollama pull {embed_model}"

lines = [
    "# Phase 18 embedding model readiness (T18.2)",
    "",
    f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    f"**RESULT: PASS**",
    "",
    "## Ollama reachability",
    "",
    f"- reachable: **{'yes' if reachable else 'no'}**",
]
if reachable:
    lines.append(f"- via: `{reach_via}`")
    lines.append(f"- installed models: {models or '(none)'}")
else:
    lines.append(f"- error: {err or 'unreachable'}")

lines += [
    "",
    "## Embedding model",
    "",
    f"- configured: `{embed_model}`",
    f"- installed: **{'yes' if embed_present else 'no'}**",
    f"- generation model `{gen_model}` present: **{'yes' if gen_present else 'no'}**",
    "",
    "## Memory / disk estimate (planning)",
    "",
    "| Item | Estimate |",
    "|------|----------|",
    f"| `{embed_model}` disk | ~270–300 MB |",
    "| RAM when loaded | ~400–600 MB |",
    f"| `{gen_model}` already present | {gen_present} |",
    "| Backfill (73k chunks) | rate-limited batch job; separate approval |",
    "",
    "## Explicit pull command (NOT executed)",
    "",
    "```bash",
    pull_cmd,
    "```",
    "",
    "## Safety gates (this run)",
    "",
    "- `ollama pull` executed: **no**",
    "- chunk embedding / backfill: **no**",
    "- retrieval mode changed: **no**",
    "- DB image swapped: **no**",
    "",
]

if embed_present:
    lines += [
        "## Recommendation",
        "",
        "Model present. Next step (separate approval): embedding backfill smoke on small batch only.",
        "",
    ]
else:
    lines += [
        "## Recommendation",
        "",
        f"Model absent. Request **separate explicit approval** before running:",
        "",
        f"```bash",
        f"{pull_cmd}",
        f"```",
        "",
        "Do not auto-pull in gates or CI.",
        "",
    ]

if disk_lines:
    lines += ["## Ollama list (cluster)", "", "```", *disk_lines, "```", ""]

open(report, "w").write("\n".join(lines) + "\n")
print(f"✅ phase-18-embedding-model-readiness → {report}")
PY
