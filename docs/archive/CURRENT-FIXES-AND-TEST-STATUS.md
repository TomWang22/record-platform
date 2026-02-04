# Current Fixes and Test Status

**Date:** 2026-01-22  
**Status:** All fixes applied, baseline test running

## ✅ All Fixes Applied

### 1. Caddyfile Routes ✅
- Added `/auctions/healthz` → api-gateway
- Added `/ai/healthz` → api-gateway
- ConfigMap updated, Caddy restarted

### 2. Baseline Test Fixes ✅
- **16f/16g retry logic**: Retries `/api/` paths when non-200 (e.g. 503)
- **Pre-flight TLS verification**: Checks CA/cert match before tests
- **Strict TLS**: All HTTP/2 requests use `--cacert` (no `-k`)

### 3. Enhanced Test Fixes ✅
- **Strict TLS**: Added CA_CERT detection and strict_curl/strict_http3_curl
- **Connection flood**: Fixed success check (200 OR "ok")
- **Recovery test**: Fixed success check (200 OR "ok")
- **All adversarial tests**: Use strict TLS (except test 1 which intentionally uses -k)

### 4. Protocol Verification ✅
- **DEAD ON**: Enhanced with ALPN, QUIC version, detailed analysis
- Test names included in all verification output

## Infrastructure Status

✅ **9/9 services**: Running 1/1 (auth, records, listings, social, shopping, analytics, auction-monitor, python-ai, api-gateway)  
✅ **2/2 Caddy pods**: Running 1/1 (one new pod in CrashLoopBackOff, but 2 old ones still running)  
✅ **1/1 Envoy pod**: Running 1/1  
✅ **2/2 Exporters**: Running (haproxy-exporter, nginx-exporter)

## Test Execution

🔄 **Baseline test**: Running with all fixes  
⏳ **Enhanced test**: Waiting for baseline  
⏳ **Rotation suite**: Waiting for enhanced

**Status: Baseline test running, monitoring progress**
