#!/usr/bin/env bash
# Fail if active bootstrap paths annotate kafka-ssl-secret outside apply-rp-kafka-ssl-secret.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WRITER="scripts/apply-rp-kafka-ssl-secret.sh"

SCAN=(
  "$REPO_ROOT/scripts"
  "$REPO_ROOT/infra/k8s"
)

# Writers only: kubectl/colima annotate with rp.dev/ca-fingerprint-sha256=…
hits=()
while IFS= read -r f; do
  rel="${f#"$REPO_ROOT"/}"
  [[ "$rel" == "$WRITER" ]] && continue
  [[ "$rel" == toolkit-reference/* ]] && continue
  [[ "$rel" == docs/* ]] && continue
  hits+=("$rel")
done < <(grep -rlE '(kctl annotate|kubectl annotate).*(rp\.dev/ca-fingerprint-sha256=|rp\.dev/ca-fingerprint-sha256\$\{)' "${SCAN[@]}" 2>/dev/null || true)

if [[ ${#hits[@]} -gt 0 ]]; then
  echo "❌ rp.dev/ca-fingerprint-sha256 must only be written by scripts/apply-rp-kafka-ssl-secret.sh" >&2
  printf '  %s\n' "${hits[@]}" >&2
  exit 1
fi

# kustomize secretGenerator must not manage kafka-ssl-secret (ca-cert-only overwrite breaks client mTLS).
gen_hits=()
while IFS= read -r f; do
  rel="${f#"$REPO_ROOT"/}"
  gen_hits+=("$rel")
done < <(grep -rl 'name: kafka-ssl-secret' "$REPO_ROOT/infra/k8s" 2>/dev/null | while read -r f; do
  grep -q 'secretGenerator:' "$f" && echo "$f"
done || true)

if [[ ${#gen_hits[@]} -gt 0 ]]; then
  echo "❌ kafka-ssl-secret must not be in kustomize secretGenerator (use scripts/apply-rp-kafka-ssl-secret.sh)" >&2
  printf '  %s\n' "${gen_hits[@]}" >&2
  exit 1
fi

echo "✅ kafka-ssl-secret annotation writers audit passed"
