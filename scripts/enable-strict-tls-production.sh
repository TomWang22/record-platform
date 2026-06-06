#!/usr/bin/env bash
# Enable strict TLS with client certificate verification for all gRPC services (production requirement)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Enabling Strict TLS with Client Certificate Verification ==="
echo "This is a PRODUCTION requirement for security."
echo ""

SERVICES=(
  "auth-service"
  "records-service"
  "listings-service"
  "social-service"
  "shopping-service"
  "analytics-service"
  "auction-monitor"
  "python-ai-service"
)

for service in "${SERVICES[@]}"; do
  deploy_file="infra/k8s/base/$service/deploy.yaml"
  if [[ ! -f "$deploy_file" ]]; then
    warn "Deployment file not found: $deploy_file"
    continue
  fi
  
  echo "Updating $service..."
  
  # Update GRPC_REQUIRE_CLIENT_CERT to true
  if grep -q "GRPC_REQUIRE_CLIENT_CERT" "$deploy_file"; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' 's/GRPC_REQUIRE_CLIENT_CERT.*value: "false"/GRPC_REQUIRE_CLIENT_CERT\
              value: "true"  # Enable client cert verification for production/g' "$deploy_file"
      sed -i '' 's/value: "false"  # Disable client cert verification for dev/value: "true"  # Enable client cert verification for production/g' "$deploy_file"
    else
      sed -i 's/GRPC_REQUIRE_CLIENT_CERT.*value: "false"/GRPC_REQUIRE_CLIENT_CERT\n              value: "true"  # Enable client cert verification for production/g' "$deploy_file"
      sed -i 's/value: "false"  # Disable client cert verification for dev/value: "true"  # Enable client cert verification for production/g' "$deploy_file"
    fi
    ok "  Updated GRPC_REQUIRE_CLIENT_CERT=true"
  else
    # Add GRPC_REQUIRE_CLIENT_CERT after ENABLE_GRPC
    if grep -q "ENABLE_GRPC" "$deploy_file"; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' '/ENABLE_GRPC/a\
            - name: GRPC_REQUIRE_CLIENT_CERT\
              value: "true"  # Enable client cert verification for production
' "$deploy_file"
      else
        sed -i '/ENABLE_GRPC/a\            - name: GRPC_REQUIRE_CLIENT_CERT\n              value: "true"  # Enable client cert verification for production' "$deploy_file"
      fi
      ok "  Added GRPC_REQUIRE_CLIENT_CERT=true"
    else
      warn "  Could not find ENABLE_GRPC - manual update needed"
    fi
  fi
  
  # Update health probes to verify server certs (remove -tls-no-verify=true)
  if grep -q "tls-no-verify=true" "$deploy_file"; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' 's/-tls-no-verify=true/-tls-no-verify=false  # Verify server cert (strict TLS)/g' "$deploy_file"
    else
      sed -i 's/-tls-no-verify=true/-tls-no-verify=false  # Verify server cert (strict TLS)/g' "$deploy_file"
    fi
    ok "  Updated health probes to verify server certs"
  fi
  
  echo ""
done

say "=== Updates Complete ==="
echo ""
echo "Next: Apply deployments and restart services:"
echo "  kubectl apply -f infra/k8s/base/<service>/deploy.yaml"
echo "  kubectl rollout restart deployment/<service> -n record-platform"
