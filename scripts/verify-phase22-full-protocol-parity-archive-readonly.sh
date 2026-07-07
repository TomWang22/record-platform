#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ARCHIVE_PATH="docs/ai-platform/PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md"
ACTIVE_CONTEXT_PATH="docs/ai-platform/ACTIVE_CONTEXT.md"
ARTIFACT_PATH="docs/ai-platform/T20-35-owner-approved-real-preview-participants.md"
EXPECTED_ARTIFACT_SHA="1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa"
CONTRACT_UID="2ed75568-7deb-4c29-91b0-6919f24a0c9f"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

current_head="$(git rev-parse --short HEAD)"
full_head="$(git rev-parse HEAD)"
echo "current_head_short=$current_head"
echo "current_head_full=$full_head"

[[ -f "$ARCHIVE_PATH" ]] || fail "missing archive doc $ARCHIVE_PATH"
[[ -f "$ACTIVE_CONTEXT_PATH" ]] || fail "missing active context doc $ACTIVE_CONTEXT_PATH"

actual_artifact_sha="$(shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"
echo "artifact_sha256=$actual_artifact_sha"
[[ "$actual_artifact_sha" == "$EXPECTED_ARTIFACT_SHA" ]] || fail "artifact SHA mismatch"

grep -q "Phase 22 status: CLOSED PASS" "$ARCHIVE_PATH" || fail "archive missing Phase 22 status CLOSED PASS"
grep -q "H1 baseline: 57105/57105" "$ARCHIVE_PATH" || fail "archive missing H1 baseline 57105/57105"
grep -q "H2 replay: 57105/57105" "$ARCHIVE_PATH" || fail "archive missing H2 replay 57105/57105"
grep -q "H3 replay: 57105/57105" "$ARCHIVE_PATH" || fail "archive missing H3 replay 57105/57105"
grep -q "Full labeled protocol parity: PASS" "$ARCHIVE_PATH" || fail "archive missing full labeled protocol parity PASS"
grep -q "Phase 22C 7200/7200: sample only" "$ARCHIVE_PATH" || fail "archive missing Phase 22C sample only"
grep -q "Production default: keyword" "$ARCHIVE_PATH" || fail "archive missing Production default keyword"
grep -q "PERCENT=0" "$ARCHIVE_PATH" || fail "archive missing PERCENT=0"
grep -q "ALLOW_PROD_PERCENT=0" "$ARCHIVE_PATH" || fail "archive missing ALLOW_PROD_PERCENT=0"
grep -q "Hybrid/vector production default: NOT APPROVED" "$ARCHIVE_PATH" || fail "archive missing hybrid/vector NOT APPROVED"

if grep -q "Current handoff HEAD:" "$ACTIVE_CONTEXT_PATH"; then
  fail "ACTIVE_CONTEXT.md contains banned label Current handoff HEAD:"
fi

grep -q "Current repo tip:" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Current repo tip section"
grep -q "Compute live with: git rev-parse --short HEAD" "$ACTIVE_CONTEXT_PATH" || fail "active context missing compute-live repo tip instruction"
grep -q "Phase handoff lineage:" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Phase handoff lineage section"
grep -q "Phase 23A operations-design commit: 77af124" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Phase 23A operations-design commit"
grep -q "Phase 23A metadata-sync commit: 6442d87" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Phase 23A metadata-sync commit"
grep -q "Frozen archive heads:" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Frozen archive heads section"
grep -q "Phase 22 archive HEAD: 5588779" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Phase 22 archive HEAD 5588779"
grep -q "Phase 21 archive checkpoint: 328161d" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Phase 21 archive checkpoint 328161d"
grep -q "Phase 21 pre-archive validation HEAD: bd76875" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Phase 21 pre-archive validation HEAD"
grep -q "H1 baseline: 57105/57105 HTTP/1.1" "$ACTIVE_CONTEXT_PATH" || fail "active context missing H1 baseline 57105/57105 HTTP/1.1"
grep -q "H2 replay: 57105/57105 HTTP/2 PASS" "$ACTIVE_CONTEXT_PATH" || fail "active context missing H2 replay 57105/57105 HTTP/2 PASS"
grep -q "H3 replay: 57105/57105 HTTP/3 PASS" "$ACTIVE_CONTEXT_PATH" || fail "active context missing H3 replay 57105/57105 HTTP/3 PASS"
grep -q "Phase 22C: 7200/7200 sample only" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Phase 22C sample only"
grep -q "Production default: keyword" "$ACTIVE_CONTEXT_PATH" || fail "active context missing Production default keyword"
grep -q "PERCENT=0" "$ACTIVE_CONTEXT_PATH" || fail "active context missing PERCENT=0"
grep -q "ALLOW_PROD_PERCENT=0" "$ACTIVE_CONTEXT_PATH" || fail "active context missing ALLOW_PROD_PERCENT=0"
grep -q "Hybrid/vector production default: NOT APPROVED" "$ACTIVE_CONTEXT_PATH" || fail "active context missing hybrid/vector NOT APPROVED"

if ! kubectl -n record-platform exec deploy/python-ai-service -- printenv >/tmp/rp-phase22-archive-env.txt 2>/dev/null; then
  fail "kubectl printenv failed (cluster unavailable)"
fi

grep -q "^AI_RAG_HYBRID_CANARY=1$" /tmp/rp-phase22-archive-env.txt || fail "AI_RAG_HYBRID_CANARY != 1"
grep -q "^AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=${CONTRACT_UID}$" /tmp/rp-phase22-archive-env.txt || fail "allowlist mismatch"
grep -q "^AI_RAG_HYBRID_CANARY_PERCENT=0$" /tmp/rp-phase22-archive-env.txt || fail "AI_RAG_HYBRID_CANARY_PERCENT != 0"
grep -q "^AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0$" /tmp/rp-phase22-archive-env.txt || fail "AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT != 0"

echo "PASS: Phase 22 full protocol parity archive verification"
