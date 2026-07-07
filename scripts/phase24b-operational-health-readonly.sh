#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CONTRACT_UID="2ed75568-7deb-4c29-91b0-6919f24a0c9f"

phase21_pass=false
phase22_pass=false
evidence_pass=false
dry_run_pass=false

if bash scripts/verify-phase-21-archive-readonly.sh >/tmp/phase24b-op-phase21.txt 2>&1; then
  phase21_pass=true
fi
if bash scripts/verify-phase22-full-protocol-parity-archive-readonly.sh >/tmp/phase24b-op-phase22.txt 2>&1; then
  phase22_pass=true
fi
if bash scripts/verify-ai-platform-evidence-labels-readonly.sh >/tmp/phase24b-op-evidence.txt 2>&1; then
  evidence_pass=true
fi
if node scripts/phase23c-dry-run-replay-resume-validation.mjs >/tmp/phase24b-op-phase23c.txt 2>&1; then
  dry_run_pass=true
fi

archive_pass=false
if [[ "${phase21_pass}" == "true" && "${phase22_pass}" == "true" ]]; then
  archive_pass=true
fi

phase23_guardrails_pass=false
if [[ "${archive_pass}" == "true" && "${evidence_pass}" == "true" && "${dry_run_pass}" == "true" ]]; then
  phase23_guardrails_pass=true
fi

production_env="{}"
if kubectl -n record-platform exec deploy/python-ai-service -- printenv >/tmp/phase24b-op-env.txt 2>/dev/null; then
  canary="$(grep '^AI_RAG_HYBRID_CANARY=' /tmp/phase24b-op-env.txt | cut -d= -f2- || true)"
  allowlist="$(grep '^AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=' /tmp/phase24b-op-env.txt | cut -d= -f2- || true)"
  percent="$(grep '^AI_RAG_HYBRID_CANARY_PERCENT=' /tmp/phase24b-op-env.txt | cut -d= -f2- || true)"
  allow_prod_percent="$(grep '^AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=' /tmp/phase24b-op-env.txt | cut -d= -f2- || true)"
  production_env="$(cat <<EOF
{"AI_RAG_HYBRID_CANARY":"${canary}","AI_RAG_HYBRID_CANARY_USER_ALLOWLIST":"${allowlist}","AI_RAG_HYBRID_CANARY_PERCENT":"${percent}","AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT":"${allow_prod_percent}"}
EOF
)"
fi

cat <<EOF
{
  "archive_verifiers_pass": ${archive_pass},
  "evidence_label_guard_pass": ${evidence_pass},
  "dry_run_resume_validation_pass": ${dry_run_pass},
  "phase23_guardrails_pass": ${phase23_guardrails_pass},
  "production_env": ${production_env},
  "telemetry_warns": "not re-run in Phase 24; see Phase 22E KPI telemetry audit",
  "contract_uid_expected": "${CONTRACT_UID}"
}
EOF
