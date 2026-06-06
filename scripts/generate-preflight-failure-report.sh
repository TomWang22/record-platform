#!/usr/bin/env bash
# Generate a structured report of what failed in a preflight run and why.
# Usage:
#   ./scripts/generate-preflight-failure-report.sh [preflight-full-*.log]
#   ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee preflight.log; ./scripts/generate-preflight-failure-report.sh preflight.log
# If no file given, reads stdin (e.g. pipe from a previous run).
# Output: markdown report suitable for docs or handoff to an AI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT="${1:-}"
if [[ -n "$INPUT" ]] && [[ -r "$INPUT" ]]; then
  LOG=$(cat "$INPUT")
  SOURCE_DESC="file: $INPUT"
else
  if [[ -n "$INPUT" ]]; then
    echo "Warning: $INPUT not readable; reading stdin" >&2
  elif [[ -t 0 ]]; then
    echo "Usage: $0 <preflight-run-*.log>" >&2
    echo "  Pass the log file path (e.g. preflight-run-20260207-205811.log)." >&2
    echo "  In another terminal, \$LOG is unset — use the actual filename." >&2
    exit 1
  fi
  LOG=$(cat)
  SOURCE_DESC="stdin"
fi

echo "---"
echo "# Preflight Failure Report"
echo ""
echo "**Generated:** $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "**Source:** $SOURCE_DESC"
echo ""
echo "## Summary"
echo ""

# Count failures by category
REISSUE_FAIL=0
REISSUE_STEP2_RETRIES=0
KAFKA_SSL_FAIL=0
APPLY_FAIL=0
SCALE_FAIL=0
CADDY_VERIFY_FAIL=0
API_NOT_RESPONDING=0
CONNECTION_RESET=0
PHASE=""

echo "$LOG" | grep -q "Reissue failed" && REISSUE_FAIL=1 || true
echo "$LOG" | grep -q "Attempt [0-9]*/12 failed" && REISSUE_STEP2_RETRIES=1 || true
echo "$LOG" | grep -q "Kafka SSL failed" && KAFKA_SSL_FAIL=1 || true
echo "$LOG" | grep -q "Apply.*failed\|Apply.*skipped or failed" && APPLY_FAIL=1 || true
echo "$LOG" | grep -q "scale.*failed" && SCALE_FAIL=1 || true
echo "$LOG" | grep -q "Caddy.*verif.*failed\|Caddy health check failed" && CADDY_VERIFY_FAIL=1 || true
echo "$LOG" | grep -q "API still not responding\|apiserver not ready" && API_NOT_RESPONDING=1 || true
echo "$LOG" | grep -q "connection reset by peer\|503\|ServiceUnavailable" && CONNECTION_RESET=1 || true

# Last failure point
if [[ $REISSUE_FAIL -eq 1 ]]; then PHASE="Reissue (CA/leaf or step 2/5/7)"; fi
if [[ $KAFKA_SSL_FAIL -eq 1 ]] && [[ -z "$PHASE" ]]; then PHASE="Kafka SSL (3b)"; fi
if [[ $APPLY_FAIL -eq 1 ]] && [[ -z "$PHASE" ]]; then PHASE="kubectl apply (3c / 3c2)"; fi
if [[ $SCALE_FAIL -eq 1 ]] && [[ -z "$PHASE" ]]; then PHASE="Scaling (4)"; fi
if [[ $CADDY_VERIFY_FAIL -eq 1 ]] && [[ -z "$PHASE" ]]; then PHASE="Caddy strict TLS verify (4d)"; fi
if [[ $API_NOT_RESPONDING -eq 1 ]] && [[ -z "$PHASE" ]]; then PHASE="API not responding after burst"; fi
[[ -z "$PHASE" ]] && PHASE="Unknown or no clear failure"

echo "| Check | Result |"
echo "|-------|--------|"
echo "| Reissue completed | $([ $REISSUE_FAIL -eq 0 ] && echo "✅ Yes" || echo "❌ No") |"
echo "| Step 2 retries (connection reset) | $([ $REISSUE_STEP2_RETRIES -eq 0 ] && echo "None" || echo "⚠️ Yes") |"
echo "| Kafka SSL (3b) | $([ $KAFKA_SSL_FAIL -eq 0 ] && echo "✅ OK" || echo "❌ Failed") |"
echo "| Applies (3c / 3c2) | $([ $APPLY_FAIL -eq 0 ] && echo "✅ OK" || echo "❌ Some failed") |"
echo "| Scaling (4) | $([ $SCALE_FAIL -eq 0 ] && echo "✅ OK" || echo "❌ Some failed") |"
echo "| Caddy verify (4d) | $([ $CADDY_VERIFY_FAIL -eq 0 ] && echo "✅ OK" || echo "❌ Failed") |"
echo "| API / connection resets | $([ $CONNECTION_RESET -eq 0 ] && echo "None seen" || echo "⚠️ Seen") |"
echo ""
echo "**Last failure phase:** $PHASE"
echo ""

echo "## What failed and why"
echo ""

if [[ $REISSUE_FAIL -eq 1 ]] || [[ $REISSUE_STEP2_RETRIES -eq 1 ]]; then
  echo "### Reissue (step 2 / 5 / 7)"
  echo "- **Symptom:** \`connection reset by peer\`, \`apiserver not ready\`, or reissue step 5 (Caddy rollout) failed after \"API still not responding after 120s\"."
  echo "- **Cause:** Burst of secret creates/patches overloads the API server or tunnel; single-node k3s/etcd is rate-limited."
  echo "- **What to do:**"
  echo "  1. Apply k3s/etcd tuning: \`./scripts/apply-k3s-etcd-tuning.sh\` (then wait ~60s)."
  echo "  2. Use host kubectl for step 2: \`REISSUE_STEP2_VIA_SSH=0 METALLB_ENABLED=0 ./scripts/run-preflight-scale-and-all-suites.sh\`."
  echo "  3. If tunnel is flaky: \`./scripts/colima-forward-6443.sh\` then retry; or full teardown: \`./scripts/colima-teardown-and-start.sh\`."
  echo "  4. See **Runbook.md** item 32 and **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**."
  echo ""
fi

if [[ $KAFKA_SSL_FAIL -eq 1 ]]; then
  echo "### Kafka SSL (3b)"
  echo "- **Symptom:** \`kubectl apply failed (host and colima ssh)\` when creating kafka-ssl-secret."
  echo "- **Cause:** API still recovering from reissue burst; 30s settle may not be enough."
  echo "- **What to do:** Preflight continues (Kafka SSL is non-fatal). When cluster is idle, run \`./scripts/kafka-ssl-from-dev-root.sh\` or re-run full preflight."
  echo ""
fi

if [[ $APPLY_FAIL -eq 1 ]]; then
  echo "### Applies (3c / 3c2)"
  echo "- **Symptom:** \`Apply config failed\`, \`Apply kafka-external failed\`, \`Apply analytics-service failed\`, or \`Apply caddy-h3-service-nodeport.yaml failed\`."
  echo "- **Cause:** API 503 or timeout under load; or existing resource conflict (e.g. Service type LoadBalancer vs NodePort)."
  echo "- **What to do:** Wait for API to settle, then re-run preflight or apply the failing manifest manually. For Caddy NodePort, ensure \`caddy-h3\` service exists and NodePort 30443 is correct; if it was LoadBalancer before, delete the service and re-apply NodePort."
  echo ""
fi

if [[ $SCALE_FAIL -eq 1 ]]; then
  echo "### Scaling (4)"
  echo "- **Symptom:** \`scale auth-service failed\`, \`scale api-gateway failed\`, etc."
  echo "- **Cause:** API overload or timeout after many writes."
  echo "- **What to do:** Same as Reissue: apply tuning, use REISSUE_STEP2_VIA_SSH=0, re-establish tunnel, or teardown+start. Then re-run preflight."
  echo ""
fi

if [[ $CADDY_VERIFY_FAIL -eq 1 ]]; then
  echo "### Caddy strict TLS verify (4d)"
  echo "- **Symptom:** \`Caddy health check failed (exit 35)\` or \`Caddy strict TLS verification failed after 3 attempts\`."
  echo "- **Cause:** curl exit 35 = SSL connect error; 127.0.0.1:30443 not reachable (NodePort not forwarded from Colima VM to host), or Caddy not ready."
  echo "- **What to do:** Preflight continues (Caddy verify is non-fatal). To fix: ensure port-forward 30443 or use \`colima ssh\` and curl from inside VM; or enable MetalLB and use LoadBalancer IP. See **docs/COLIMA_K3S_TUNING.md** and **Runbook.md**."
  echo ""
fi

if [[ $API_NOT_RESPONDING -eq 1 ]]; then
  echo "### API not responding"
  echo "- **Symptom:** \`API still not responding after 120s\` or \`kubectl get nodes failed\` in diagnostic."
  echo "- **Cause:** k3s overloaded or restarting after write burst."
  echo "- **What to do:** Apply \`scripts/apply-k3s-etcd-tuning.sh\`; increase VM memory (e.g. COLIMA_MEMORY=12); avoid overlapping write phases. See **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**."
  echo ""
fi

echo "## Consistency and next steps"
echo ""
echo "- **Control-plane tuning:** Run \`./scripts/apply-k3s-etcd-tuning.sh\` once per Colima profile to reduce stalls (see **docs/COLIMA_K3S_TUNING.md**)."
echo "- **Strict TLS/mTLS:** Preflight uses \`certs/dev-root.pem\` and reissue keeps CA/leaf in sync; run with \`REISSUE_STEP2_VIA_SSH=0\` for most stable step 2."
echo "- **Phase-gated runs:** Use \`PREFLIGHT_PHASE=A\` for control-plane sanity only, or \`METALLB_ENABLED=0\` to skip MetalLB (default). See **docs/PREFLIGHT_PHASES_README.md**."
echo "- **Full diagnostic:** \`./scripts/generate-preflight-diagnostic-report.sh > preflight-diagnostic-\$(date +%Y%m%d-%H%M%S).txt\` (optional \`RUN_DIAGNOSE=1\`)."
echo ""

echo "---"
echo "## Forensic / deep-dive (for AI and ops)"
echo ""
echo "### Why the failure report script can look \"stuck\""
echo "- In a **different terminal**, \`\$LOG\` is unset (it was set only in the terminal where preflight ran). So \`./scripts/generate-preflight-failure-report.sh \"\$LOG\"\` is called with **no argument**."
echo "- With no argument the script **reads from stdin** (\`LOG=\$(cat)\`). It then blocks waiting for input. **Fix:** Pass the log file path explicitly, e.g. \`./scripts/generate-preflight-failure-report.sh preflight-run-20260207-205314.log\`. The script now exits with usage if run with no argument and stdin is a TTY."
echo ""
echo "### Where all writes line up"
echo "- The **single burst** that triggers resets is **reissue step 2**: delete + create secrets in \`record-platform\` and \`ingress-nginx\`, then create/update \`service-tls\`. Those writes hit the API in quick succession. Step 4b (settle) and step 5 (Caddy patch) run **after** that burst; if the API is still overloaded, they fail. **Forensic takeaway:** all problematic writes are in step 2; everything after is read or lighter write on an already-stressed API."
echo ""
echo "### Why \"jitter\" (e.g. Kind/Docker in another terminal) might have helped"
echo "- With only Colima + preflight, the reissue script sends the burst at a very regular pace. The API can hit in-flight limits quickly."
echo "- With Kind or Docker Desktop (or other heavy processes) running, the shell and Colima VM get more context switches and variable latency. That can **spread** the same burst in time so the API sees a less sharp spike and may stay under the limit. So a past \"good run\" might have coincided with more system jitter. **We rely on rate limiting, settle, and lock (flock/mkdir), not on ambient jitter.**"
echo ""
echo "### How to go forensic"
echo "- **Layer 1 (symptom):** After a failure, run \`kubectl get nodes\` and \`kubectl create ns test\` — if get nodes works but create fails, the API is still recovering."
echo "- **Layer 2 (transport):** While reproducing: \`sudo tcpdump -nn -i lo0 tcp port 6443\` and look for RST; or \`scripts/diagnose-reset-by-peer.sh\` (see **scripts/CONNECTION-RESET-PLAYBOOK.md**)."
echo "- **Layer 3 (TLS):** \`openssl s_client -connect 127.0.0.1:6443 -servername kubernetes\` and \`curl -k https://127.0.0.1:6443/version\` — if these succeed while kubectl fails, the issue is API load/limits, not TLS."
echo "- **Diagnostic log:** After reissue failure the pipeline runs a connection-reset diagnostic and writes \`scripts/diag-reset-*.log\` (DEEP + GATHER). Use that file for Colima/ports/tunnel state at failure time."
echo ""

echo "---"
echo "## Ideas to dig further"
echo ""
echo "1. **Increase spacing in reissue step 2:** Set \`REISSUE_STEP2_SLEEP=6\` (or 8) and \`REISSUE_SETTLE_CAP=300\` to give the API more time between secret ops and before step 5."
echo "2. **Try step 2 via SSH (reduces tunnel load):** \`REISSUE_STEP2_VIA_SSH=1\` so \`kubectl\` runs inside the Colima VM; fewer connections over the host tunnel."
echo "3. **Capture packets during a run:** \`TCPDUMP_SEC=15 ./scripts/diagnose-reset-by-peer.sh 6443\` in one terminal while starting preflight in another; inspect RST timing vs secret creates."
echo "4. **API server metrics:** If you expose kube-apiserver metrics (or use k3s default), check \`apiserver_request_duration_seconds\`, \`apiserver_current_inflight_requests\` during and after step 2."
echo "5. **Phase 0 then full run:** \`PREFLIGHT_PHASE0=1 ./scripts/run-preflight-scale-and-all-suites.sh\` (exit after freeze check), then run full preflight in the same session to ensure cluster is stable first."
echo "6. **etcd tuning verification:** Confirm drop-in is present in VM: \`colima ssh -- cat /etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml\`; re-run \`./scripts/apply-k3s-etcd-tuning.sh\` if missing."
echo ""

echo "---"
echo "## MetalLB and traffic policy (for AI / verification)"
echo ""
echo "### Goal"
echo "Prove MetalLB is working with our **traffic policy**: Caddy service \`type: LoadBalancer\` with **sessionAffinity: ClientIP** (1h) so traffic is not plain round-robin (fewer reconnects/TLS handshakes). Pool range and L2 advertisement must be applied; webhook must have endpoints."
echo ""
echo "### What to verify"
echo "1. **MetalLB installed and controller ready:** \`kubectl get pods -n metallb-system\` — controller and speaker Running. \`kubectl get ep -n metallb-system webhook-service\` — endpoints exist (otherwise pool apply fails with InternalError / endpoints not found)."
echo "2. **Pool and L2 applied:** \`kubectl get ipaddresspool -n metallb-system\`, \`kubectl get l2advertisement -n metallb-system\`. Addresses in pool must not overlap host/DHCP (e.g. 192.168.106.240/28 for Colima)."
echo "3. **Caddy LoadBalancer service:** \`kubectl get svc -n ingress-nginx caddy-h3\` — \`type: LoadBalancer\`, \`EXTERNAL-IP\` in pool range (not \<pending\>). \`kubectl get svc -n ingress-nginx caddy-h3 -o yaml\` — \`sessionAffinity: ClientIP\`, \`sessionAffinityConfig.clientIP.timeoutSeconds: 3600\`."
echo "4. **Traffic path:** \`curl -k --resolve record.local:443:\$EXTERNAL_IP https://record.local/...\` (or host entry) — HTTP 200 and TLS works; same client IP gets same backend (affinity)."
echo "5. **Preflight with MetalLB:** Run with \`METALLB_ENABLED=1\` only **after** a good run with \`METALLB_ENABLED=0\` (so control plane is not already at limit). Apply pool/Caddy when API is idle: \`./scripts/apply-metallb-pool-and-caddy-service.sh\` (see **METALLB_AND_API_503_REPORT.md**)."
echo ""
echo "### References"
echo "- **docs/adr/003-metallb-investigation-and-integration.md** — L2 flow, Caddy/Envoy behind MetalLB."
echo "- **METALLB_AND_API_503_REPORT.md** — Why 503, webhook, scripts (\`install-metallb.sh\`, \`apply-metallb-pool-and-caddy-service.sh\`), fix options."
echo "- **infra/docs/METALLB.md** — Quick install, address pool, L2Advertisement."
echo ""
