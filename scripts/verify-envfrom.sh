#!/usr/bin/env bash
set -euo pipefail
NS="${NS:-record-platform}"
SERVICES=(api-gateway auth-service records-service listings-service analytics-service python-ai-service)

fail=0
for d in "${SERVICES[@]}"; do
  if ! kubectl -n "$NS" get deploy "$d" >/dev/null 2>&1; then
    echo "✗ $d: deploy missing"; fail=1; continue
  fi
  cm=$(kubectl -n "$NS" get deploy "$d" -o jsonpath='{range .spec.template.spec.containers[0].envFrom[*]}{.configMapRef.name}{" "}{end}')
  sec=$(kubectl -n "$NS" get deploy "$d" -o jsonpath='{range .spec.template.spec.containers[0].envFrom[*]}{.secretRef.name}{" "}{end}')
  if [[ "$cm" == *"app-config"* && "$sec" == *"app-secrets"* ]]; then
    echo "✓ $d"
  else
    echo "✗ $d (missing app-config and/or app-secrets)"; fail=1
  fi
done
exit $fail
