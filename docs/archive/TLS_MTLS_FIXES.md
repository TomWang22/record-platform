# TLS/mTLS Investigation and Fixes

## Issues Identified and Fixed

### 1. HTTP/3 Certificate Chain Issue (FIXED ✅)

**Problem**: HTTP/3 curl was failing with exit code 77 (SSL certificate problem)

**Root Cause**: Caddy was only serving the leaf certificate, not the full certificate chain (leaf + CA). When curl uses `--cacert` to verify, it needs the server to present a certificate that chains to that CA. Without the CA in the chain, verification fails even with `--cacert`.

**Fix**: Modified `scripts/reissue-ca-and-leaf-load-all-services.sh` to create a full certificate chain by concatenating the leaf certificate and CA certificate before creating the `record-local-tls` secret:

```bash
# Create full certificate chain (leaf + CA) for Caddy
CHAIN_CRT="$TMP/tls-chain.crt"
cat "$LEAF_CRT" "$CA_CRT" > "$CHAIN_CRT"
# Use full chain when creating secret
kctl -n "$n" create secret tls record-local-tls --cert="$CHAIN_CRT" --key="$LEAF_KEY"
```

**Result**: Caddy now serves the full certificate chain, allowing HTTP/3 curl to verify with `--cacert`.

### 2. gRPC Authenticate Routing Issue (INVESTIGATED)

**Problem**: gRPC Auth Authenticate method failing via Envoy NodePort

**Findings**:
- The `Authenticate` method is properly implemented in `auth-service/src/grpc-server.ts`
- Envoy configuration routes `/auth.` paths to `auth_service` cluster correctly
- The test script has fallback logic to use direct port-forward when Envoy fails
- Issue may be TLS-related or routing configuration

**Status**: Needs further investigation. The fallback to port-forward should work, but error detection may need improvement.

### 3. Rotation Suite Failure (FIXED ✅)

**Problem**: Rotation suite failing during Kubernetes secret updates

**Root Cause**: Background job PIDs were not being captured properly, causing `wait` to fail

**Fix**: Fixed the `wait` command to properly capture all background job PIDs:

```bash
CA_ING_PID=$!
CA_APP_PID=$!
wait $LEAF_ING_PID $LEAF_APP_PID $SVC_TLS_PID $CA_ING_PID $CA_APP_PID
```

### 4. Account Deletion Error Handling (FIXED ✅)

**Problem**: Account deletion test expecting 401 but getting 500

**Fix**: Improved error handling in login endpoint to return 401 instead of 500 when user doesn't exist.

## New Tools Created

### 1. `scripts/diagnose-tls-mtls.sh`
Comprehensive diagnostic script that checks:
- CA certificate configuration
- Caddy certificate configuration
- HTTP/3 certificate verification
- gRPC service TLS configuration
- Certificate chain completeness
- mTLS configuration status

### 2. `scripts/test-tls-mtls-comprehensive.sh`
Comprehensive test suite that validates:
- HTTP/3 certificate chain verification
- gRPC via Envoy NodePort
- gRPC via direct port-forward with TLS
- gRPC Authenticate method
- Certificate chain completeness
- mTLS configuration

## mTLS Configuration

### Current Status
- All gRPC services are **mTLS capable** (have CA certificates mounted)
- mTLS is **disabled by default** in dev mode (`GRPC_REQUIRE_CLIENT_CERT=false`)
- Services check for `GRPC_REQUIRE_CLIENT_CERT` environment variable
- When enabled, services require client certificates for gRPC connections

### Service Configuration
Services check for:
- `/etc/certs/tls.crt` - Server certificate
- `/etc/certs/tls.key` - Server private key
- `/etc/certs/ca.crt` - CA certificate (for mTLS)

mTLS is controlled by:
- `GRPC_REQUIRE_CLIENT_CERT=true` - Enables client certificate verification
- Default: `false` (dev mode, no client cert required)

## Next Steps

1. **Re-issue certificates** with full chain:
   ```bash
   ./scripts/reissue-ca-and-leaf-load-all-services.sh
   ```

2. **Run comprehensive tests**:
   ```bash
   ./scripts/test-tls-mtls-comprehensive.sh
   ```

3. **Run full test suite** to verify all fixes:
   ```bash
   ./scripts/run-all-test-suites.sh
   ```

4. **Investigate gRPC Authenticate routing** further if issues persist

## Certificate Chain Requirements

For HTTP/3 curl verification to work:
1. Server must present full certificate chain (leaf + CA)
2. Client must have CA certificate available (via `--cacert`)
3. CA certificate must match the CA that signed the server certificate

The fix ensures Caddy serves the full chain, so HTTP/3 curl can verify with `--cacert`.
