#!/usr/bin/env bash
# Create or update New Relic and Splunk HEC secrets for the Otel collector (observability namespace).
# Run this so telemetry flows to your backends. Without real keys, Otel still runs (Jaeger + logging).
#
# Usage:
#   NEW_RELIC_LICENSE_KEY=your_key SPLUNK_HEC_URL=https://... SPLUNK_HEC_TOKEN=... ./scripts/setup-observability-secrets.sh
#   Or export the vars and run with no args.
#
# If a var is empty, that secret is skipped (existing secret left as-is). To clear, delete the secret and re-apply base.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${OBSERVABILITY_NS:-observability}"
NEW_RELIC_KEY="${NEW_RELIC_LICENSE_KEY:-}"
SPLUNK_URL="${SPLUNK_HEC_URL:-}"
SPLUNK_TOKEN="${SPLUNK_HEC_TOKEN:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

kubectl get ns "$NS" >/dev/null 2>&1 || { kubectl create namespace "$NS"; ok "Created namespace $NS"; }

if [[ -n "$NEW_RELIC_KEY" ]]; then
  kubectl create secret generic newrelic-secret -n "$NS" --from-literal=license-key="$NEW_RELIC_KEY" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null && ok "newrelic-secret created/updated" || warn "newrelic-secret failed"
else
  warn "NEW_RELIC_LICENSE_KEY not set — New Relic export will use placeholder or skip"
fi

if [[ -n "$SPLUNK_URL" ]] && [[ -n "$SPLUNK_TOKEN" ]]; then
  kubectl create secret generic splunk-secret -n "$NS" --from-literal=hec-url="$SPLUNK_URL" --from-literal=hec-token="$SPLUNK_TOKEN" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null && ok "splunk-secret created/updated" || warn "splunk-secret failed"
else
  warn "SPLUNK_HEC_URL or SPLUNK_HEC_TOKEN not set — Splunk HEC export will use placeholder or skip"
fi

say "Restarting otel-collector to pick up secrets..."
kubectl rollout restart deployment/otel-collector -n "$NS" 2>/dev/null && ok "Otel collector restarting" || true
