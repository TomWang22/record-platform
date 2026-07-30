#!/usr/bin/env bash
# Contract/smoke paths must use https://record-platform.test and curl --cacert (no curl -k).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

_fail() { echo "audit-rp-edge-host-contract: FAIL — $*" >&2; exit 1; }

# record.test must not match record-platform.test
FORBIDDEN_RE='record\.local|(^|[^-])record\.test([^a-z-]|$)|curl[[:space:]]+[^|]*-k|curl[[:space:]]+[^|]*-sk|localhost:8080'

is_allowlisted() {
  local rel="$1"
  case "$rel" in
    */docs/*|*/bench_logs/*|*/backups/*|*/node_modules/*|*/.git/*|*/.next/*|*/dist/*)
      return 0
      ;;
    scripts/test-http2-http3-strict-tls.sh|scripts/test-grpc-http2-http3.sh|scripts/test-full-chain-with-rotation.sh|scripts/test-microservices-http2-http3.sh|scripts/test-packet-capture-standalone.sh|scripts/run-transport-study-experiments.sh|scripts/verify-rotation-prerequisites.sh|scripts/verify-quic-diagnostic-in-vm.sh|scripts/verify-metallb-advanced.sh|scripts/verify-k6-protocols.sh|scripts/verify-k3d-30443-udp.sh|scripts/verify-http3-with-tcpdump.sh|scripts/verify-cache-hit-rates.sh|scripts/verify-production-ready.sh|scripts/verify-tls-chain.sh|scripts/verify-upstream-tls.sh|scripts/tests-local.sh|scripts/build-substrate-bundle.sh|scripts/load/*|scripts/k6-*|scripts/package-*|scripts/rp-audit-no-localhost-nodeport.sh|scripts/audit-rp-edge-host-contract.sh)
      return 0
      ;;
    infra/k8s/base/secrets/*|infra/k8s/scripts/*|certs/record.local.*)
      return 0
      ;;
  esac
  return 1
}

CONTRACT_PATHS=(
  scripts/e2e
  scripts/rp-auth-contract-comb.sh
  scripts/rp-runtime-domain-comb.sh
  scripts/rp-db-domain-comb.sh
  scripts/rp-rp-decontaminate-scan.sh
  scripts/rp-verify-kafka-cert-chain.sh
  scripts/verify-kafka-ready.sh
  scripts/audit-rp-ci-service-matrix.sh
  scripts/audit-rp-service-mtls-required.sh
  scripts/audit-rp-redis-lua-runtime-contract.sh
  scripts/audit-rp-event-outbox-contract.sh
  scripts/rca-rp-grpc-mtls.sh
  scripts/cold-bootstrap.sh
  scripts/cold-bootstrap-post-hosts.sh
  scripts/rp-cold-bootstrap-gates.sh
  scripts/rp-cold-run-prep.sh
  scripts/seed-jaeger-via-edge-health.sh
  scripts/lib/edge-test-url.sh
  scripts/lib/rp-edge-curl-probe.sh
  scripts/lib/rp-edge-strict-smoke-runner.sh
  scripts/lib/rp-cluster-readiness.sh
  webapp/e2e
  webapp/playwright.config.ts
  .github/workflows/ci.yml
  .github/workflows/docker-build.yml
  Makefile
  Caddyfile
)

VIOLATIONS=0

check_file() {
  local rel="$1"
  is_allowlisted "$rel" && return 0
  local f="$REPO_ROOT/$rel"
  [[ -f "$f" ]] || return 0
  local hits
  hits="$(grep -nE "$FORBIDDEN_RE" "$f" 2>/dev/null | grep -Ev 'for bad in|not record\.local|reject.*record\.local|forbidden.*record\.local' || true)"
  if [[ -n "$hits" ]]; then
    echo "  $rel" >&2
    echo "$hits" | sed 's/^/    /' >&2
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
}

scan_dir() {
  local dir="$1"
  [[ -d "$REPO_ROOT/$dir" ]] || return 0
  while IFS= read -r -d '' f; do
    local rel="${f#"$REPO_ROOT"/}"
    check_file "$rel"
  done < <(
    find "$REPO_ROOT/$dir" -type f \( \
      -name '*.sh' -o -name '*.ts' -o -name '*.tsx' -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' \
    \) ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' -print0 2>/dev/null
  )
}

echo "audit-rp-edge-host-contract: contract/smoke paths…"
for p in "${CONTRACT_PATHS[@]}"; do
  if [[ -f "$REPO_ROOT/$p" ]]; then
    check_file "$p"
  elif [[ -d "$REPO_ROOT/$p" ]]; then
    scan_dir "$p"
  fi
done

if [[ "$VIOLATIONS" -gt 0 ]]; then
  _fail "$VIOLATIONS path(s) — use record-platform.test and curl --cacert (no curl -k)"
fi

echo "audit-rp-edge-host-contract: PASS"
exit 0
