#!/usr/bin/env bash
set -euo pipefail

# Setup script for k6 shopping daily CronJob
# Creates ConfigMap with test script and applies CronJob

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

NS_K6="${NS_K6:-k6-load}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "Setting up k6 Shopping Daily CronJob"

# Create namespace if it doesn't exist
kubectl get ns "$NS_K6" >/dev/null 2>&1 || kubectl create ns "$NS_K6" >/dev/null
ok "Namespace $NS_K6 ready"

# Create ConfigMap with k6 test script
say "Creating ConfigMap with k6 shopping ramp test script..."
if [[ ! -f "scripts/load/k6-shopping-ramp.js" ]]; then
  fail "Test script not found: scripts/load/k6-shopping-ramp.js"
fi

kubectl -n "$NS_K6" create configmap k6-shopping-script \
  --from-file=k6-shopping-ramp.js=scripts/load/k6-shopping-ramp.js \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
ok "ConfigMap created with test script"

# Apply CronJob
say "Applying k6 shopping daily CronJob..."
if [[ ! -f "infra/k8s/base/cron-jobs/k6-shopping-daily.yaml" ]]; then
  fail "CronJob YAML not found: infra/k8s/base/cron-jobs/k6-shopping-daily.yaml"
fi

kubectl apply -f infra/k8s/base/cron-jobs/k6-shopping-daily.yaml
ok "CronJob applied"

# Show CronJob status
say "CronJob status:"
kubectl -n "$NS_K6" get cronjob k6-shopping-daily

say "Setup complete!"
say "The CronJob will run daily at 2:00 AM (America/New_York timezone)"
say "To view CronJob: kubectl -n $NS_K6 get cronjob k6-shopping-daily"
say "To view jobs: kubectl -n $NS_K6 get jobs -l app=k6-shopping-test"
say "To view logs: kubectl -n $NS_K6 logs -l app=k6-shopping-test --tail=100"

