#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ARCHIVE_HEAD_SHORT="328161d"
PRE_ARCHIVE_HEAD_SHORT="bd76875"
ARTIFACT_PATH="docs/ai-platform/T20-35-owner-approved-real-preview-participants.md"
CONTEXT_PATH="docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md"
EXPECTED_ARTIFACT_SHA="1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

current_head="$(git rev-parse --short HEAD)"
full_head="$(git rev-parse HEAD)"

echo "current_head_short=$current_head"
echo "current_head_full=$full_head"

git cat-file -e "${ARCHIVE_HEAD_SHORT}^{commit}" || fail "missing archive commit $ARCHIVE_HEAD_SHORT"
git cat-file -e "${PRE_ARCHIVE_HEAD_SHORT}^{commit}" || fail "missing pre-archive commit $PRE_ARCHIVE_HEAD_SHORT"

actual_artifact_sha="$(shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"
echo "artifact_sha256=$actual_artifact_sha"
[[ "$actual_artifact_sha" == "$EXPECTED_ARTIFACT_SHA" ]] || fail "artifact SHA mismatch"

grep -q "CLOSED PASS" "$CONTEXT_PATH" || fail "context missing CLOSED PASS"
grep -q "57105/57105" "$CONTEXT_PATH" || fail "context missing cumulative live 57105/57105"
grep -q "Production default: keyword" "$CONTEXT_PATH" || fail "context missing keyword production default"
grep -q "Preview UI/API: KEEP" "$CONTEXT_PATH" || fail "context missing Preview UI/API KEEP"
grep -q "AI_RAG_HYBRID_CANARY_PERCENT=0" "$CONTEXT_PATH" || fail "context missing PERCENT=0"
grep -q "AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0" "$CONTEXT_PATH" || fail "context missing ALLOW_PROD_PERCENT=0"

pass "Phase 21 archive read-only verification"
