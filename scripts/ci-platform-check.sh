#!/usr/bin/env bash
# CI-ready deterministic platform check: tiered validation (infra → protocol → TLS → functional).
# Optional load tier via RUN_LOAD=1. Use for CI or quick platform gate.
# Tier 1: preflight-stateful   Tier 2: http2/http3  Tier 3: tls-mtls  Tier 4: microservices/social
# Tier 5 (optional): rotation-stable + load suites when RUN_LOAD=1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

RUN_LOAD="${RUN_LOAD:-0}"
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

say "=== Tier 1: Infra (stateful preflight) ==="
if [[ -f "$SCRIPT_DIR/preflight-stateful.sh" ]]; then
  "$SCRIPT_DIR/preflight-stateful.sh" || exit 1
  ok "Tier 1 passed"
else
  warn "preflight-stateful.sh not found; skipping Tier 1"
fi

say "=== Tier 2: Protocol (HTTP/2 + HTTP/3) ==="
if [[ -f "$SCRIPT_DIR/test-microservices-http2-http3.sh" ]]; then
  "$SCRIPT_DIR/test-microservices-http2-http3.sh" || exit 1
  ok "Tier 2 passed"
else
  warn "test-microservices-http2-http3.sh not found; skipping Tier 2"
fi

say "=== Tier 3: TLS/mTLS ==="
if [[ -f "$SCRIPT_DIR/test-tls-mtls-comprehensive.sh" ]]; then
  "$SCRIPT_DIR/test-tls-mtls-comprehensive.sh" || exit 1
  ok "Tier 3 passed"
else
  warn "test-tls-mtls-comprehensive.sh not found; skipping Tier 3"
fi

say "=== Tier 4: Functional (social / microservices) ==="
if [[ -f "$SCRIPT_DIR/test-messaging-service-comprehensive.sh" ]]; then
  "$SCRIPT_DIR/test-messaging-service-comprehensive.sh" || exit 1
  ok "Tier 4 passed"
else
  warn "test-messaging-service-comprehensive.sh not found; skipping Tier 4"
fi

if [[ "${RUN_LOAD}" == "1" ]]; then
  say "=== Tier 5: Rotation + load (RUN_LOAD=1) ==="
  if [[ -f "$SCRIPT_DIR/rotation-stable.sh" ]]; then
    "$SCRIPT_DIR/rotation-stable.sh" || exit 1
    ok "Rotation stability passed"
  fi
  if [[ -f "$SCRIPT_DIR/run-all-test-suites.sh" ]]; then
    warn "Full suites (including rotation/adversarial) — run manually: ./scripts/run-all-test-suites.sh"
  fi
else
  info "Skipping load tier (set RUN_LOAD=1 to include rotation-stable and load suites)"
fi

say "=== CI platform check complete ==="
ok "All deterministic checks passed"
