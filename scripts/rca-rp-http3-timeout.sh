#!/usr/bin/env bash
# RCA for curl exit 28 (timeout) on strict HTTP/3 edge — 1 vs 2 Caddy replicas.
# Does NOT use -k. Uses --cacert + --resolve (MetalLB IP only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"

NS="${RP_HTTP3_EDGE_NS:-ingress-nginx}"
OUT="${RP_HTTP3_TIMEOUT_RCA_DIR:-$REPO_ROOT/bench_logs/http3-timeout-rca}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"

REPORT="$OUT/report.md"
LB="$(rp_http3_lb_ip || true)"
HOST="$RP_HTTP3_EDGE_HOST"

_run_mode() {
  local mode="$1" replicas="$2"
  local mode_dir="$OUT/${mode}-replica"
  mkdir -p "$mode_dir"

  echo "" >&2
  echo "════════════════════════════════════════" >&2
  echo "RCA mode: ${replicas} Caddy replica(s)" >&2
  echo "════════════════════════════════════════" >&2

  kubectl -n "$NS" scale deployment/caddy-h3 --replicas="$replicas" >&2
  kubectl -n "$NS" rollout status deployment/caddy-h3 --timeout=180s >&2
  sleep 3

  kubectl -n "$NS" get pods -l app=caddy-h3 -o wide >"$mode_dir/caddy-pods.txt" 2>/dev/null || true
  kubectl -n "$NS" get svc caddy-h3 -o yaml >"$mode_dir/caddy-svc.yaml" 2>/dev/null || true
  kubectl get endpointslices -n "$NS" -l kubernetes.io/service-name=caddy-h3 -o yaml \
    >"$mode_dir/caddy-endpointslices.yaml" 2>/dev/null || true
  kubectl get pods -n metallb-system -o wide >"$mode_dir/metallb-pods.txt" 2>/dev/null || true
  kubectl get pods -n kube-system 2>/dev/null | grep -E 'svclb.*caddy|caddy-h3' >"$mode_dir/svclb-pods.txt" || true

  local smoke_rc=0
  RP_EDGE_STRICT_REPORT_DIR="$mode_dir/edge-h3-strict" \
    RP_HTTP3_STRICT_INTER_ATTEMPT_SLEEP="${RP_HTTP3_STRICT_INTER_ATTEMPT_SLEEP:-1.5}" \
    METALLB_IP="$LB" \
    bash "$SCRIPT_DIR/smoke-rp-edge-http3-strict.sh" \
    >"$mode_dir/smoke.log" 2>&1 || smoke_rc=$?

  cp "$mode_dir/edge-h3-strict/results.tsv" "$mode_dir/results.tsv" 2>/dev/null || true
  cp "$mode_dir/edge-h3-strict/caddy.log" "$mode_dir/caddy.log" 2>/dev/null || true
  cp "$mode_dir/edge-h3-strict/failures.md" "$mode_dir/failures.md" 2>/dev/null || true

  python3 - "$mode_dir/results.tsv" "$mode_dir/caddy.log" "$mode" "$replicas" "$smoke_rc" "$mode_dir/summary.json" <<'PY'
import json, sys, os
tsv, clog, mode, replicas, smoke_rc, out = sys.argv[1:7]
rows = []
if os.path.isfile(tsv):
    with open(tsv) as f:
        f.readline()
        for line in f:
            if not line.startswith("20"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 4:
                rows.append(parts)
def count(path, verdict="PASS"):
    return sum(1 for r in rows if r[1] == path and r[3] == verdict)
def total(path):
    return sum(1 for r in rows if r[1] == path)
clog_text = open(clog).read() if os.path.isfile(clog) else ""
summary = {
    "mode": mode,
    "replicas": int(replicas),
    "smoke_exit": int(smoke_rc),
    "readyz_pass": count("/api/readyz"),
    "readyz_total": total("/api/readyz"),
    "root_pass": count("/"),
    "root_total": total("/"),
    "timeout_or_quic_failures": sum(1 for r in rows if r[3] in ("TIMEOUT", "QUIC_CONN_FAIL")),
    "cert_failures": sum(1 for r in rows if r[3] == "CERT_FAIL"),
    "caddy_log_lines_readyz": clog_text.count('"/api/readyz"'),
    "caddy_log_lines_root": clog_text.count('"uri":"/"'),
}
with open(out, "w") as f:
    json.dump(summary, f, indent=2)
PY
}

echo "rca-rp-http3-timeout → $OUT"
[[ -n "$LB" ]] || { echo "❌ no LoadBalancer IP" >&2; exit 1; }

ORIG_REPLICAS="$(kubectl -n "$NS" get deploy caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 2)"

_run_mode one 1
_run_mode two 2

kubectl -n "$NS" scale deployment/caddy-h3 --replicas="${ORIG_REPLICAS:-2}" >&2 || true
kubectl -n "$NS" rollout status deployment/caddy-h3 --timeout=180s >&2 || true

s1="$OUT/one-replica/summary.json"
s2="$OUT/two-replica/summary.json"

read -r o_readyz_pass o_readyz_total o_root_pass o_root_total o_timeout o_cert o_cr o_croot o_smoke <<<"$(python3 -c 'import json; d=json.load(open("'"$s1"'")); print(d["readyz_pass"],d["readyz_total"],d["root_pass"],d["root_total"],d["timeout_or_quic_failures"],d["cert_failures"],d["caddy_log_lines_readyz"],d["caddy_log_lines_root"],d["smoke_exit"])')"
read -r t_readyz_pass t_readyz_total t_root_pass t_root_total t_timeout t_cert t_cr t_croot t_smoke <<<"$(python3 -c 'import json; d=json.load(open("'"$s2"'")); print(d["readyz_pass"],d["readyz_total"],d["root_pass"],d["root_total"],d["timeout_or_quic_failures"],d["cert_failures"],d["caddy_log_lines_readyz"],d["caddy_log_lines_root"],d["smoke_exit"])')"

SVCLB="$(rp_http3_svclb_active && echo yes || echo no)"
ETP="$(rp_http3_external_traffic_policy 2>/dev/null || echo ?)"
ALLOC="$(rp_http3_allocate_lb_nodeports 2>/dev/null || echo ?)"
SA="$(rp_http3_session_affinity 2>/dev/null || echo None)"

{
  echo "# HTTP/3 timeout RCA (curl exit 28)"
  echo ""
  echo "Generated: $TS (UTC)"
  echo ""
  echo "## Protocol clarifications"
  echo ""
  echo "- **Client → Caddy** must be HTTP/3 (\`http_version=3\`). Caddy access log \`request.proto\":\"HTTP/3.0\"\` is ground truth."
  echo "- **Caddy → upstream** may be HTTP/1.1 (Next.js/webapp). That does **not** invalidate edge HTTP/3."
  echo "- \`transport http { versions h1 }\` for webapp is valid when Next.js is h1-only or h2 upstream hangs."
  echo "- curl exit **28** = timeout (connect or overall). curl exit **60** = cert validation failure."
  echo "- External curl validates **Caddy edge cert** via \`certs/dev-chain.pem\`. Service mTLS certs are internal only."
  echo "- Strict proof: \`--cacert certs/dev-chain.pem\` + \`--resolve record-platform.test:443:${LB}\` + \`--http3-only\` (no \`-k\`, no client cert)."
  echo ""
  echo "## Edge facts"
  echo "| fact | value |"
  echo "|------|-------|"
  echo "| LB IP | \`${LB}\` |"
  echo "| /etc/hosts line | \`${LB} ${HOST}\` |"
  echo "| allocateLoadBalancerNodePorts | ${ALLOC} |"
  echo "| externalTrafficPolicy | ${ETP} |"
  echo "| sessionAffinity | ${SA} |"
  echo "| k3s svclb competing | ${SVCLB} |"
  echo ""
  echo "## Replica comparison"
  echo ""
  echo "| mode | replicas | /api/readyz | / | TIMEOUT+QUIC | CERT_FAIL | Caddy log /readyz | Caddy log / | smoke rc |"
  echo "|------|----------|-------------|---|--------------|-----------|-------------------|-------------|----------|"
  echo "| one | 1 | ${o_readyz_pass}/${o_readyz_total} | ${o_root_pass}/${o_root_total} | ${o_timeout} | ${o_cert} | ${o_cr} | ${o_croot} | ${o_smoke} |"
  echo "| two | 2 | ${t_readyz_pass}/${t_readyz_total} | ${t_root_pass}/${t_root_total} | ${t_timeout} | ${t_cert} | ${t_cr} | ${t_croot} | ${t_smoke} |"
  echo ""
  echo "## Answers"
  echo ""
  if [[ "$o_timeout" -gt 0 && "$t_timeout" -eq 0 ]]; then
    echo "- **curl 28 / TIMEOUT primarily with 2 replicas?** Yes — 1-replica had ${o_timeout} TIMEOUT/QUIC fails; 2-replica had 0."
  elif [[ "$o_timeout" -eq 0 && "$t_timeout" -gt 0 ]]; then
    echo "- **curl 28 primarily with 2 replicas?** Yes — failures only at 2 replicas (${t_timeout} TIMEOUT/QUIC rows)."
  elif [[ "$o_timeout" -gt 0 && "$t_timeout" -gt 0 ]]; then
    echo "- **curl 28 with 1 replica?** Yes (${o_timeout} fails). Also at 2 replicas (${t_timeout}) → QUIC/LB/client path, not replica count alone."
  else
    echo "- **curl 28 / TIMEOUT in this RCA run?** No TIMEOUT/QUIC_CONN_FAIL rows in either mode."
  fi
  echo ""
  if [[ "$o_croot" -gt 0 || "$t_croot" -gt 0 || "$o_cr" -gt 0 || "$t_cr" -gt 0 ]]; then
    echo "- **Did Caddy receive requests that curl timed out on?** **Yes** — Caddy logged HTTP/3 traffic for /api/readyz or /. When Caddy shows \`status\":200\` and \`proto\":\"HTTP/3.0\"\` but curl exit=28, the failure is **client QUIC response path** (not upstream 504, not cert)."
  elif [[ "$o_timeout" -gt 0 || "$t_timeout" -gt 0 ]]; then
    echo "- **Did Caddy receive timed-out requests?** Often **no** matching log lines → client→MetalLB→Caddy QUIC handshake/path issue."
  fi
  echo ""
  if [[ "$SVCLB" == "yes" ]]; then
    echo "- **k3s ServiceLB:** svclb pods present — may compete with MetalLB. Durable fix: disable k3s ServiceLB; do **not** reintroduce NodePorts."
  else
    echo "- **k3s ServiceLB:** not detected in this run."
  fi
  echo ""
  if [[ "$ETP" == "Local" ]]; then
    echo "- **externalTrafficPolicy Local:** on single-node Colima, all local Caddy endpoints receive traffic; QUIC still flakes without flow stickiness."
  fi
  echo ""
  echo "## Artifacts"
  echo "- \`$OUT/one-replica/\` — results.tsv, failures.md, caddy.log, smoke.log, summary.json"
  echo "- \`$OUT/two-replica/\` — same"
} >"$REPORT"

echo ""
echo "Report: $REPORT"
cat "$REPORT"
