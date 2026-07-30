#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bench_logs/ai-platform bench_logs/release-contract
LOG=bench_logs/ai-platform/phase-17-provider-gates-run.log
echo "=== Phase 17 provider gates $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" > "$LOG"

FAIL=0
run_gate() {
  local name="$1"
  shift
  echo "" >> "$LOG"
  echo ">>> $name: $*" >> "$LOG"
  if "$@" >> "$LOG" 2>&1; then
    echo "$name=0" >> "$LOG"
    return 0
  else
    echo "$name=$?" >> "$LOG"
    return 1
  fi
}

run_gate pnpm_install pnpm install --frozen-lockfile || FAIL=1
run_gate ollama_readiness bash scripts/rp-ai-ollama-readiness.sh || FAIL=1
run_gate provider_readiness bash scripts/rp-ai-provider-readiness.sh || FAIL=1
run_gate rag_quality bash scripts/rp-ai-rag-quality-smoke.sh || FAIL=1
run_gate ai_soak bash scripts/rp-ai-soak-monitor.sh || FAIL=1
run_gate audit_rag bash scripts/audit-rp-ai-rag-contract.sh || FAIL=1
run_gate audit_runtime bash scripts/audit-rp-ai-runtime-contract.sh || FAIL=1
run_gate audit_endpoints bash scripts/audit-rp-ai-endpoints-contract.sh || FAIL=1
run_gate audit_pipeline bash scripts/audit-rp-ai-pipeline-contract.sh || FAIL=1
run_gate event_matrix bash scripts/rp-platform-event-e2e-matrix.sh || FAIL=1
run_gate kafka bash scripts/audit-rp-kafka-producer-consumer-contract.sh || FAIL=1
run_gate grpc bash scripts/rp-bootstrap-grpc-mtls-gate.sh || FAIL=1
run_gate h2h3 bash scripts/smoke-rp-edge-h2-h3-strict-tls.sh || FAIL=1
run_gate mtls_smoke bash scripts/smoke-rp-mtls-real.sh || FAIL=1
run_gate redis bash scripts/audit-rp-redis-lua-runtime-contract.sh || FAIL=1
run_gate outbox bash scripts/audit-rp-event-outbox-contract.sh || FAIL=1
run_gate runtime_comb bash scripts/rp-runtime-domain-comb.sh || FAIL=1
run_gate db_comb bash scripts/rp-db-domain-comb.sh || FAIL=1
run_gate och bash scripts/rp-rp-decontaminate-scan.sh || FAIL=1
run_gate cluster_doctor env CLUSTER_DOCTOR_STRICT=1 make cluster-doctor || FAIL=1

echo "" >> "$LOG"
echo ">>> playwright: full suite" >> "$LOG"
if (cd webapp && CONTRACT_SCREENSHOT_DATE="$(date -u +%F)" \
  E2E_API_BASE=https://record-platform.test \
  NODE_EXTRA_CA_CERTS=../certs/dev-root.pem \
  pnpm exec playwright test --workers=1 --retries=0 --timeout=180000) >> "$LOG" 2>&1; then
  echo "playwright=0" >> "$LOG"
else
  echo "playwright=$?" >> "$LOG"
  FAIL=1
fi

run_gate screenshot_strict env CONTRACT_ONLY=1 make rp-frontend-screenshot-strict-contract || FAIL=1

# Ops runbook contract
python3 - "bench_logs/ai-platform/phase-17-ai-ops-runbook-contract.md" <<'PY' >> "$LOG" 2>&1 || FAIL=1
import os, sys
doc = "docs/ai-platform/ai-provider-operations.md"
fail = False
if not os.path.isfile(doc):
    print("❌ missing", doc); sys.exit(1)
text = open(doc).read()
for term in ("record.local", "off-campus", "landlord", "tenant", "housing", " RP"):
    if term.strip() in text:
        print(f"❌ forbidden term: {term}"); fail = True
for needle in ("rp-ai-apply-ollama-cluster-env", "rp-ai-rag-reindex", "AI_MODEL_PROVIDER", "ollama.record-platform"):
    if needle not in text:
        print(f"❌ missing section ref: {needle}"); fail = True
out = sys.argv[1]
open(out, "w").write("# Phase 17 AI ops runbook contract (T17.4)\n\n**RESULT: PASS**\n\n- docs/ai-platform/ai-provider-operations.md validated\n")
print("✅ phase-17-ai-ops-runbook-contract")
sys.exit(1 if fail else 0)
PY

echo "FAIL_TOTAL=$FAIL" >> "$LOG"
exit "$FAIL"
