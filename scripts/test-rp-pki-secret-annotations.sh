#!/usr/bin/env bash
# Regression: verify that rp_annotate_secret_pki_generation applies correct annotations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok()  { echo "✅ $*"; }

# --- Unit: shared helper reads from disk ---
echo "=== rp-pki-generation.sh unit tests ==="

# shellcheck source=lib/rp-pki-generation.sh
source "$SCRIPT_DIR/lib/rp-pki-generation.sh"

GEN_ID_FILE="$REPO_ROOT/certs/.rp-pki-generation-id"
if [[ -f "$GEN_ID_FILE" ]] && [[ -s "$GEN_ID_FILE" ]]; then
  DISK_ID="$(cat "$GEN_ID_FILE")"
  FUNC_ID="$(rp_pki_generation_id)"
  [[ "$FUNC_ID" == "$DISK_ID" ]] && ok "rp_pki_generation_id reads disk ($DISK_ID)" \
    || bad "rp_pki_generation_id disk mismatch (func=$FUNC_ID disk=$DISK_ID)"
else
  echo "ℹ️  no certs/.rp-pki-generation-id — skipping disk read test"
fi

export RP_PKI_GENERATION_ID="test-1234"
FUNC_ID="$(rp_pki_generation_id)"
[[ "$FUNC_ID" == "test-1234" ]] && ok "rp_pki_generation_id prefers env var" \
  || bad "rp_pki_generation_id env override failed (got=$FUNC_ID)"
unset RP_PKI_GENERATION_ID

export RP_PKI_GENERATED_AT="2026-01-01T00:00:00Z"
FUNC_AT="$(rp_pki_generated_at)"
[[ "$FUNC_AT" == "2026-01-01T00:00:00Z" ]] && ok "rp_pki_generated_at prefers env var" \
  || bad "rp_pki_generated_at env override failed (got=$FUNC_AT)"
unset RP_PKI_GENERATED_AT

# --- Structural: shared helper sourced by writers ---
echo ""
echo "=== Writer source checks ==="

grep -q 'rp-pki-generation.sh' "$SCRIPT_DIR/strict-tls-bootstrap.sh" \
  && ok "strict-tls-bootstrap.sh sources rp-pki-generation.sh" \
  || bad "strict-tls-bootstrap.sh missing rp-pki-generation.sh source"

grep -q 'rp-pki-generation.sh' "$SCRIPT_DIR/lib/rp-apply-service-mtls-secrets.sh" \
  && ok "rp-apply-service-mtls-secrets.sh sources rp-pki-generation.sh" \
  || bad "rp-apply-service-mtls-secrets.sh missing rp-pki-generation.sh source"

grep -q 'rp-pki-generation.sh' "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh" \
  && ok "apply-rp-kafka-ssl-secret.sh sources rp-pki-generation.sh" \
  || bad "apply-rp-kafka-ssl-secret.sh missing rp-pki-generation.sh source"

grep -q 'rp_annotate_secret_pki_generation' "$SCRIPT_DIR/strict-tls-bootstrap.sh" \
  && ok "strict-tls-bootstrap.sh calls rp_annotate_secret_pki_generation" \
  || bad "strict-tls-bootstrap.sh missing rp_annotate_secret_pki_generation calls"

grep -q 'rp_annotate_secret_pki_generation' "$SCRIPT_DIR/lib/rp-apply-service-mtls-secrets.sh" \
  && ok "rp-apply-service-mtls-secrets.sh calls rp_annotate_secret_pki_generation" \
  || bad "rp-apply-service-mtls-secrets.sh missing rp_annotate_secret_pki_generation calls"

grep -q 'rp_annotate_secret_pki_generation.*kafka-ssl-secret' "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh" \
  && ok "apply-rp-kafka-ssl-secret.sh annotates kafka-ssl-secret" \
  || bad "apply-rp-kafka-ssl-secret.sh missing kafka-ssl-secret annotation"

# --- Structural: no stale inline _annotate left ---
if grep -qE '^_annotate\(\)' "$SCRIPT_DIR/strict-tls-bootstrap.sh" 2>/dev/null; then
  bad "strict-tls-bootstrap.sh still has inline _annotate() function"
else
  ok "strict-tls-bootstrap.sh has no stale _annotate() inline"
fi

if grep -qE '_rp_apply_annotate_secret' "$SCRIPT_DIR/lib/rp-apply-service-mtls-secrets.sh" 2>/dev/null; then
  bad "rp-apply-service-mtls-secrets.sh still has _rp_apply_annotate_secret"
else
  ok "rp-apply-service-mtls-secrets.sh has no stale _rp_apply_annotate_secret"
fi

# --- Structural: .rp-pki-generated-at written by B.crypto ---
grep -q 'rp-pki-generated-at' "$SCRIPT_DIR/rp-bootstrap-crypto.sh" \
  && ok "rp-bootstrap-crypto.sh writes .rp-pki-generated-at" \
  || bad "rp-bootstrap-crypto.sh missing .rp-pki-generated-at write"

# --- Live cluster check (if available) ---
echo ""
echo "=== Live annotation spot-check ==="
if ! kubectl cluster-info --request-timeout=5s >/dev/null 2>&1; then
  echo "ℹ️  cluster not up — skipping live checks"
else
  NS="${HOUSING_NS:-record-platform}"
  _check_ann() {
    local ns="$1" name="$2"
    if ! kubectl get secret "$name" -n "$ns" >/dev/null 2>&1; then
      echo "ℹ️  secret/$name not in $ns — skip"
      return 0
    fi
    local ann
    ann="$(kubectl get secret "$name" -n "$ns" -o jsonpath='{.metadata.annotations.rp\.dev/pki-generation-id}' 2>/dev/null || true)"
    if [[ -n "$ann" ]]; then
      ok "secret/$name (ns=$ns) has generation-id=$ann"
    else
      bad "secret/$name (ns=$ns) missing rp.dev/pki-generation-id annotation"
    fi
  }
  _check_ann "$NS" service-tls-auth-service
  _check_ann "$NS" rp-service-mtls-bundle
  _check_ann "$NS" edge-service-tls
  _check_ann "$NS" service-tls
  _check_ann "$NS" kafka-ssl-secret
  _check_ann ingress-nginx record-platform-local-tls
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "✅ test-rp-pki-secret-annotations passed"
  exit 0
fi
echo "❌ test-rp-pki-secret-annotations failed" >&2
exit 1
