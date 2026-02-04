# Colima/k3s Migration - Test Suite Updates

## Overview

The platform has migrated from Kind to Colima/k3s. This document outlines the changes made to the test suite to support Colima/k3s.

## Changes Made

### 1. Context Detection and Switching

**Before (Kind)**:
- Scripts assumed Kind cluster (`kind-h3`, `kind-h3-multi`)
- Used `docker exec` to run kubectl inside Kind containers
- Port detection for dynamic API server ports

**After (Colima/k3s)**:
- Scripts detect and prefer Colima context
- Use `colima ssh` for kubectl commands when needed
- Fixed API server address: `127.0.0.1:6443`
- Falls back to Kind if Colima not available (backward compatibility)

**Implementation**:
```bash
# Detect Colima context
ctx=$(kubectl config current-context 2>/dev/null || echo "")
colima_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || echo "")
if [[ -n "$colima_ctx" ]]; then
  kubectl config use-context "$colima_ctx" 2>/dev/null && ctx="$colima_ctx" || true
fi

# Verify Colima context
if [[ "$ctx" == *"colima"* ]]; then
  ok "Context: Colima + k3s ($ctx, server 127.0.0.1:6443)"
fi
```

### 2. gRPC Health Checks with mTLS

**Before**:
- Health checks assumed no client certificate verification
- Used `-tls-no-verify=true` (dev mode)

**After**:
- Checks `GRPC_REQUIRE_CLIENT_CERT` environment variable
- Uses client certificates when `GRPC_REQUIRE_CLIENT_CERT=true` (production)
- Verifies server certificates (`-tls-no-verify=false`)

**Implementation**:
```bash
# Check if service requires client certs
local require_client_cert=$(_kubectl -n "$NS" exec "$pod" -- env 2>/dev/null | grep "GRPC_REQUIRE_CLIENT_CERT" | cut -d= -f2 || echo "false")

if [[ "$require_client_cert" == "true" ]]; then
  # Use client certs for mTLS
  grpc-health-probe \
    -tls-client-cert=/etc/certs/tls.crt \
    -tls-client-key=/etc/certs/tls.key \
    ...
fi
```

### 3. CA Certificate Detection

**Before**:
- Single source for CA certificate
- No fallback mechanisms

**After**:
- Multiple fallback sources:
  1. Kubernetes secret in `ingress-nginx` namespace (Caddy certs)
  2. Kubernetes secret in `record-platform` namespace
  3. mkcert CA certificate (`$(mkcert -CAROOT)/rootCA.pem`)
- Better error messages when CA cert not found

**Implementation**:
```bash
# Try ingress-nginx namespace first
K8S_CA=$(_kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")

# Fallback to record-platform namespace
if [[ -z "$K8S_CA" ]]; then
  K8S_CA=$(_kubectl -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
fi

# Fallback to mkcert
if [[ -z "$CA_CERT" ]] && command -v mkcert >/dev/null 2>&1; then
  MKCERT_CA="$(mkcert -CAROOT)/rootCA.pem"
  if [[ -f "$MKCERT_CA" ]]; then
    CA_CERT="$MKCERT_CA"
  fi
fi
```

### 4. kubectl Helper Integration

**Before**:
- Direct `kubectl` calls
- No timeout handling
- No context switching

**After**:
- Uses `kctl` helper from `scripts/lib/kubectl-helper.sh`
- Automatic Colima/Kind detection
- Timeout handling (`--request-timeout=10s`)
- Fallback to `colima ssh` when needed

**Implementation**:
```bash
[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"

_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=10s "$@"; }
```

### 5. Preflight Checks

**Before**:
- No preflight checks
- Assumed cluster was ready

**After**:
- Preflight kubeconfig fix (Colima 127.0.0.1:6443, Kind port fallback)
- API server readiness check
- Context validation

**Implementation**:
```bash
# Preflight kubeconfig
if [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]]; then
  PREFLIGHT_CAP="${PREFLIGHT_CAP:-45}" "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null
fi

# Ensure API server ready
if [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  KUBECTL_REQUEST_TIMEOUT=10s API_SERVER_MAX_ATTEMPTS=8 API_SERVER_SLEEP=2 \
    ENSURE_CAP=120 PREFLIGHT_CAP=45 "$SCRIPT_DIR/ensure-api-server-ready.sh" 2>/dev/null
fi
```

## Files Updated

1. **`scripts/run-platform-wide-test-suite.sh`**
   - Added Colima context detection
   - Updated gRPC health checks for mTLS
   - Enhanced CA certificate detection
   - Integrated preflight checks

2. **`scripts/PLATFORM_WIDE_TEST_SUITE.md`**
   - Updated prerequisites section
   - Added Colima/k3s requirements
   - Updated usage examples

3. **`scripts/COLIMA_K3S_MIGRATION.md`** (this file)
   - Documentation of migration changes

## Testing

### Verify Colima/k3s Setup

```bash
# Check Colima status
colima status

# Check k3s API server
kubectl get nodes --request-timeout=10s

# Verify context
kubectl config current-context  # Should be "colima" or similar

# Check services are running
kubectl get pods -n record-platform
```

### Run Test Suite

```bash
# Full test suite
./scripts/run-platform-wide-test-suite.sh

# Check results
cat /tmp/platform-test-results-*/results.json | jq .
```

## Known Issues

1. **k3s API Server Startup Time**
   - k3s may take a few minutes to start after Colima restart
   - Use `scripts/continue-after-k3s-ready.sh` to wait and verify

2. **Certificate Reissuance**
   - After Colima restart, certificates may need reissuance
   - Run: `pnpm run reissue` or `./scripts/reissue-ca-and-leaf-load-all-services.sh`

3. **Service Startup Order**
   - Services may need time to become Ready after k3s restart
   - Use `scripts/continue-after-k3s-ready.sh` to scale and verify

## Backward Compatibility

The test suite maintains backward compatibility with Kind:
- If Colima context not found, falls back to Kind detection
- kubectl helper handles both Colima and Kind
- Preflight script supports both environments

However, **Colima/k3s is the preferred and recommended environment**.

## Next Steps

1. ✅ Test suite updated for Colima/k3s
2. ✅ mTLS support added
3. ✅ CA certificate detection improved
4. ⏳ Verify all tests pass with Colima/k3s
5. ⏳ Update other test scripts (if needed)
6. ⏳ Document any Colima-specific gotchas
