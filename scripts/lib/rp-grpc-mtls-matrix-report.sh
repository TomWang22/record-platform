#!/usr/bin/env bash
# Write bench_logs/grpc-mtls-rca/report.md matrix for all certPolicy.mtlsServices.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=rp-service-cert-contract.sh
source "$SCRIPT_DIR/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
OUT="${RP_GRPC_MTLS_RCA_DIR:-$REPO_ROOT/bench_logs/grpc-mtls-rca}"
mkdir -p "$OUT"
REPORT="$OUT/report.md"
NDJSON="${1:-$OUT/summary.ndjson}"

python3 - <<'PY' "$REPO_ROOT" "$NS" "$REPORT" "$NDJSON"
import json, os, subprocess, sys
from pathlib import Path

repo, ns, report_path, ndjson_path = sys.argv[1:5]
contract = json.loads((Path(repo) / "infra/contracts/rp-service-runtime-contract.json").read_text())
mtls = [r for r in (contract.get("certPolicy") or {}).get("mtlsServices") or [] if r.get("mtlsRequired", True)]

def kubectl(*args):
    try:
        return subprocess.check_output(["kubectl", *args], text=True, stderr=subprocess.DEVNULL).strip()
    except subprocess.CalledProcessError:
        return ""

def secret_keys(sec):
    raw = kubectl("get", "secret", sec, "-n", ns, "-o", "json")
    if not raw:
        return set()
    return set(json.loads(raw).get("data", {}).keys())

def deploy_mount(sec_name, dep):
    raw = kubectl("get", "deploy", dep, "-n", ns, "-o", "json")
    if not raw:
        return "missing-deploy"
    doc = json.loads(raw)
    vols = {v["name"]: v.get("secret", {}).get("secretName", "") for v in doc["spec"]["template"]["spec"].get("volumes", [])}
    mounts = []
    for c in doc["spec"]["template"]["spec"].get("containers", []):
        for m in c.get("volumeMounts", []):
            if m.get("name") in vols:
                mounts.append(vols[m["name"]])
    return mounts[0] if mounts else "none"

def openssl_field(crt_b64, args):
    import base64, tempfile
    if not crt_b64:
        return ""
    data = base64.b64decode(crt_b64)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".crt") as f:
        f.write(data)
        path = f.name
    try:
        r = subprocess.run(["openssl", "x509", "-in", path, *args], capture_output=True, text=True)
        return (r.stdout or r.stderr or "").strip()
    finally:
        os.unlink(path)

def san_ok(crt_b64, svc):
    out = openssl_field(crt_b64, ["-noout", "-ext", "subjectAltName"])
    need = [svc, f"{svc}.record-platform", f"{svc}.record-platform.svc", f"{svc}.record-platform.svc.cluster.local"]
    return all(n in out for n in need)

def issuer_intermediate(crt_b64):
    subj = openssl_field(crt_b64, ["-noout", "-subject"])
    return "Intermediate" in subj or "intermediate" in subj.lower()

def eku_ok(crt_b64):
    out = openssl_field(crt_b64, ["-noout", "-purpose"])
    return "SSL server" in out and "SSL client" in out

rca = {}
if os.path.isfile(ndjson_path):
    text = Path(ndjson_path).read_text()
    dec = json.JSONDecoder()
    idx = 0
    while idx < len(text):
        while idx < len(text) and text[idx].isspace():
            idx += 1
        if idx >= len(text):
            break
        row, end = dec.raw_decode(text, idx)
        if isinstance(row, dict) and row.get("service"):
            rca[row["service"]] = row
        idx = end

lines = [
    "# gRPC/mTLS RCA matrix",
    "",
    f"Namespace: `{ns}`",
    "",
    "| service | grpc_port | mounted_secret | cert_subject | issuer_intermediate | chain_keys | san_ok | eku_ok | in_pod_grpc | http_health | runtime_gate | verdict |",
    "|---------|-----------|----------------|--------------|---------------------|------------|--------|--------|-------------|-------------|--------------|---------|",
]

for row in mtls:
    svc = row["serviceName"]
    dep = svc
    sec = f"service-tls-{svc}"
    keys = secret_keys(sec)
    crt = kubectl("get", "secret", sec, "-n", ns, "-o", "jsonpath={.data.tls\\.crt}")
    subj = openssl_field(crt, ["-noout", "-subject"]).replace(",", " ")[:60] if crt else "?"
    mount = deploy_mount(sec, dep)
    san = san_ok(crt, svc) if crt else False
    eku = eku_ok(crt) if crt else False
    iss = issuer_intermediate(crt) if crt else False
    chain = "tls.crt,tls.key,ca.crt" if keys >= {"tls.crt", "tls.key", "ca.crt"} else ",".join(sorted(keys))
    r = rca.get(svc, {})
    scopes = r.get("scopes", [])
    grpc_ok = any(":mtls:ok" in s or ":plaintext:ok" in s for s in scopes)
    rt = contract.get("services", {}).get(svc, {})
    grpc_port = rt.get("grpcPort", "")
    grpc_req = rt.get("grpcRequiredForRuntime", False)
    http = "probe" if rt.get("httpPort") else "n/a"
    gate = "grpc-required" if grpc_req else "http-primary"
    verdict = "pass" if mount == sec and san and eku and keys >= {"tls.crt", "tls.key", "ca.crt"} else "fail"
    if grpc_req and not grpc_ok:
        verdict = "fail-grpc"
    lines.append(
        f"| {svc} | {grpc_port} | {mount} | {subj} | {iss} | {chain} | {san} | {eku} | {grpc_ok} | {http} | {gate} | {verdict} |"
    )

Path(report_path).write_text("\n".join(lines) + "\n")
print(report_path)
PY

echo "✅ gRPC/mTLS matrix: $REPORT"
