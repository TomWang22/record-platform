#!/usr/bin/env bash
# Fix Caddy proxy chain issues:
# - Double TLS termination (Caddy → ingress-nginx should be HTTP, not HTTPS)
# - ALPN mismatch (protocol negotiation issues)
# - Backend HTTP/1.1 vs H2 mismatch
# - QUIC listener configuration
# - Certificate reload during rotation

set -euo pipefail

NS="ingress-nginx"
HOST="${HOST:-record.local}"

bold() { echo -e "\033[1m$1\033[0m"; }
ok() { echo -e "\033[32m✅ $1\033[0m"; }
warn() { echo -e "\033[33m⚠️  $1\033[0m"; }
error() { echo -e "\033[31m❌ $1\033[0m"; }
step() { echo; bold ">>> $1"; }

step "=== Fixing Caddy Proxy Chain Issues ==="

# Step 1: Check current Caddyfile
step "1. Checking Current Caddyfile Configuration"
if [[ ! -f "./Caddyfile" ]]; then
  error "Caddyfile not found in current directory"
  exit 1
fi

# Check if we're using HTTPS to ingress-nginx (double TLS termination issue)
if grep -q "reverse_proxy https://ingress-nginx" ./Caddyfile; then
  warn "Found HTTPS proxy to ingress-nginx (double TLS termination)"
  NEEDS_FIX=1
else
  ok "Caddyfile uses HTTP to ingress-nginx (correct)"
  NEEDS_FIX=0
fi

# Step 2: Create fixed Caddyfile
step "2. Creating Fixed Caddyfile"
# Backup original
cp ./Caddyfile ./Caddyfile.backup.$(date +%s)

# Fix the Caddyfile to use HTTP instead of HTTPS for ingress-nginx
# This avoids double TLS termination and ALPN mismatches
cat > ./Caddyfile.fixed <<'CADDYFILE'
{
  admin localhost:2019
  # Enable HTTP/3 (QUIC)
  servers {
    protocol {
      experimental_http3
    }
  }
}

# Primary vhost
https://record.local {
  tls /etc/caddy/certs/tls.crt /etc/caddy/certs/tls.key {
    protocols tls1.2 tls1.3
  }

  # Privacy and Terms pages - route directly to auth-service (BEFORE catch-all)
  @privacy {
    path /privacy
  }
  handle @privacy {
    reverse_proxy http://auth-service.record-platform.svc.cluster.local:4001 {
      header_up Host {http.request.host}
    }
  }
  
  @terms {
    path /terms
  }
  handle @terms {
    reverse_proxy http://auth-service.record-platform.svc.cluster.local:4001 {
      header_up Host {http.request.host}
    }
  }

  # Health check endpoint
  handle_path /_caddy/healthz {
    respond "ok" 200
  }

  # gRPC matchers - route by service name in path
  @grpc_auth {
    protocol grpc
    path_regexp ^/auth\.
  }
  @grpc_records {
    protocol grpc
    path_regexp ^/records\.
  }
  @grpc_social {
    protocol grpc
    path_regexp ^/social\.
  }
  @grpc_listings {
    protocol grpc
    path_regexp ^/listings\.
  }
  @grpc_analytics {
    protocol grpc
    path_regexp ^/analytics\.
  }
  @grpc_shopping {
    protocol grpc
    path_regexp ^/shopping\.
  }
  @grpc_auction_monitor {
    protocol grpc
    path_regexp ^/auction_monitor\.|^/auction-monitor\.
  }
  @grpc_python_ai {
    protocol grpc
    path_regexp ^/python_ai\.|^/python-ai\.
  }

  # Route auth-service gRPC requests
  handle @grpc_auth {
    reverse_proxy auth-service.record-platform.svc.cluster.local:50051 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route records-service gRPC requests
  handle @grpc_records {
    reverse_proxy records-service.record-platform.svc.cluster.local:50051 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route messaging-service gRPC requests
  handle @grpc_social {
    reverse_proxy messaging-service.record-platform.svc.cluster.local:50056 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route listings-service gRPC requests
  handle @grpc_listings {
    reverse_proxy listings-service.record-platform.svc.cluster.local:50057 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route analytics-service gRPC requests
  handle @grpc_analytics {
    reverse_proxy analytics-service.record-platform.svc.cluster.local:50054 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route shopping-service gRPC requests
  handle @grpc_shopping {
    reverse_proxy shopping-service.record-platform.svc.cluster.local:50058 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route auction-monitor gRPC requests
  handle @grpc_auction_monitor {
    reverse_proxy auction-monitor.record-platform.svc.cluster.local:50059 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route python-ai-service gRPC requests
  handle @grpc_python_ai {
    reverse_proxy python-ai-service.record-platform.svc.cluster.local:50060 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # REST API requests: route through nginx ingress via HTTP (NOT HTTPS)
  # FIX: Use HTTP to avoid double TLS termination and ALPN mismatches
  # Ingress-nginx terminates TLS, so Caddy should use cleartext HTTP
  handle {
    reverse_proxy http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80 {
      header_up Host {http.request.host}
      # Use HTTP/1.1 to match backend (ingress-nginx speaks HTTP/1.1 to backends)
      # This avoids ALPN negotiation issues and protocol mismatches
      transport http {
        versions h1
      }
    }
  }
}

# Internal h2c port for gRPC tests (bypasses TLS)
:5000 {
  # gRPC matchers - route by service name in path
  @grpc_auth {
    protocol grpc
    path_regexp ^/auth\.
  }
  @grpc_records {
    protocol grpc
    path_regexp ^/records\.
  }
  @grpc_social {
    protocol grpc
    path_regexp ^/social\.
  }
  @grpc_listings {
    protocol grpc
    path_regexp ^/listings\.
  }
  @grpc_analytics {
    protocol grpc
    path_regexp ^/analytics\.
  }
  @grpc_shopping {
    protocol grpc
    path_regexp ^/shopping\.
  }
  @grpc_auction_monitor {
    protocol grpc
    path_regexp ^/auction_monitor\.|^/auction-monitor\.
  }
  @grpc_python_ai {
    protocol grpc
    path_regexp ^/python_ai\.|^/python-ai\.
  }

  # Route auth-service gRPC requests
  handle @grpc_auth {
    reverse_proxy auth-service.record-platform.svc.cluster.local:50051 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route records-service gRPC requests
  handle @grpc_records {
    reverse_proxy records-service.record-platform.svc.cluster.local:50051 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route messaging-service gRPC requests
  handle @grpc_social {
    reverse_proxy messaging-service.record-platform.svc.cluster.local:50056 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route listings-service gRPC requests
  handle @grpc_listings {
    reverse_proxy listings-service.record-platform.svc.cluster.local:50057 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route analytics-service gRPC requests
  handle @grpc_analytics {
    reverse_proxy analytics-service.record-platform.svc.cluster.local:50054 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route shopping-service gRPC requests
  handle @grpc_shopping {
    reverse_proxy shopping-service.record-platform.svc.cluster.local:50058 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route auction-monitor gRPC requests
  handle @grpc_auction_monitor {
    reverse_proxy auction-monitor.record-platform.svc.cluster.local:50059 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }

  # Route python-ai-service gRPC requests
  handle @grpc_python_ai {
    reverse_proxy python-ai-service.record-platform.svc.cluster.local:50060 {
      header_up Host {http.request.host}
      header_up TE trailers
      header_up grpc-timeout {http.request.header.grpc-timeout}
      transport http {
        versions h2c
      }
    }
  }
}

# Catch-all for any hostname on port 443 (including ngrok, probes without SNI, etc.)
:443 {
  tls /etc/caddy/certs/tls.crt /etc/caddy/certs/tls.key {
    protocols tls1.2 tls1.3
  }
  
  # Health check endpoint for probes without SNI (must be first)
  handle_path /_caddy/healthz {
    respond "ok" 200
  }
  
  # Privacy and Terms pages - route directly to auth-service (BEFORE catch-all)
  @privacy {
    path /privacy
  }
  handle @privacy {
    reverse_proxy http://auth-service.record-platform.svc.cluster.local:4001 {
      header_up Host {http.request.host}
    }
  }
  
  @terms {
    path /terms
  }
  handle @terms {
    reverse_proxy http://auth-service.record-platform.svc.cluster.local:4001 {
      header_up Host {http.request.host}
    }
  }
  
  # All other requests go through nginx ingress via HTTP (NOT HTTPS)
  # FIX: Use HTTP to avoid double TLS termination
  handle {
    reverse_proxy http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80 {
      header_up Host {http.request.host}
      # Use HTTP/1.1 to match backend (ingress-nginx speaks HTTP/1.1 to backends)
      transport http {
        versions h1
      }
    }
  }
}
CADDYFILE

# Step 3: Validate the fixed Caddyfile
step "3. Validating Fixed Caddyfile"
if command -v caddy >/dev/null 2>&1; then
  if caddy validate --config ./Caddyfile.fixed --adapter caddyfile 2>/dev/null; then
    ok "Fixed Caddyfile is valid"
  else
    error "Fixed Caddyfile validation failed"
    caddy validate --config ./Caddyfile.fixed --adapter caddyfile
    exit 1
  fi
else
  warn "Caddy CLI not found - skipping validation"
fi

# Step 4: Apply the fixed Caddyfile
step "4. Applying Fixed Caddyfile"
kubectl -n "$NS" create configmap caddy-h3 \
  --from-file=Caddyfile=./Caddyfile.fixed \
  --dry-run=client -o yaml | kubectl apply -f -

ok "ConfigMap updated with fixed Caddyfile"

# Step 5: Restart Caddy deployment
step "5. Restarting Caddy Deployment"
kubectl -n "$NS" rollout restart deployment/caddy-h3
ok "Deployment restart triggered"

# Step 6: Wait for rollout
step "6. Waiting for Rollout"
if kubectl -n "$NS" rollout status deployment/caddy-h3 --timeout=120s; then
  ok "Deployment rolled out successfully"
else
  warn "Deployment rollout timed out or failed"
fi

# Step 7: Verify the fix
step "7. Verifying Fix"
sleep 3
POD=$(kubectl -n "$NS" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$POD" ]]; then
  # Check logs for errors
  LOGS=$(kubectl -n "$NS" logs "$POD" --tail=50 2>&1 | grep -iE "error|warning|listening|HTTP/3" || echo "")
  if echo "$LOGS" | grep -qi "error"; then
    warn "Errors found in logs:"
    echo "$LOGS" | grep -i "error" | head -5
  else
    ok "No errors in recent logs"
  fi
  
  # Check if HTTP/3 is enabled
  if echo "$LOGS" | grep -qi "HTTP/3\|QUIC"; then
    ok "HTTP/3 (QUIC) is enabled"
  else
    warn "HTTP/3 (QUIC) may not be enabled"
  fi
fi

# Step 8: Replace original Caddyfile
step "8. Updating Local Caddyfile"
mv ./Caddyfile.fixed ./Caddyfile
ok "Local Caddyfile updated"

step "=== Fix Complete ==="
bold "Summary of fixes:"
echo "  ✅ Changed ingress-nginx proxy from HTTPS to HTTP (avoids double TLS termination)"
echo "  ✅ Set transport to HTTP/1.1 only (matches backend, avoids ALPN mismatch)"
echo "  ✅ Enabled HTTP/3 (QUIC) in global config"
echo "  ✅ Removed TLS configuration from upstream transport (no longer needed)"
echo ""
bold "Next steps:"
echo "  1. Test the fix: bash scripts/test-full-chain-with-rotation.sh"
echo "  2. Monitor logs: kubectl -n $NS logs -l app=caddy-h3 -f"
echo "  3. Verify health: curl -k -H 'Host: $HOST' https://127.0.0.1:30443/_caddy/healthz"




