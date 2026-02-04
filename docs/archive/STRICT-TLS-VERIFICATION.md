# Strict TLS Verification - All Services

**Date:** 2026-01-23  
**Status:** Verifying strict TLS (CA + leaf) for all services

## Requirements

**Strict TLS means:**
- ✅ CA certificate verification (no `-k` flags)
- ✅ Leaf certificate validation
- ✅ All service-to-service communication uses TLS
- ✅ All client-to-service communication uses TLS
- ✅ Certificate chain validation

## Service TLS Configuration

### Ingress Layer (Caddy)
- **CA**: `dev-root-ca` secret in `ingress-nginx` namespace
- **Leaf**: `record-local-tls` secret in `ingress-nginx` namespace
- **Strict TLS**: Enabled via `--cacert` in test scripts

### Service Pods
- **Internal communication**: Should use TLS with service mesh or direct TLS
- **External access**: Via Caddy with strict TLS

### Test Scripts
- **Baseline**: Uses `strict_curl` with `--cacert` (mkcert CA)
- **Enhanced**: Uses `strict_curl` and `strict_http3_curl`
- **Rotation Suite**: Generates new CA and leaf, updates secrets

## Verification Steps

1. ✅ Check CA secret exists
2. ✅ Check leaf secret exists
3. ✅ Verify mkcert CA is available
4. ✅ Check test scripts use `--cacert` (no `-k`)
5. ✅ Verify Caddy uses TLS secrets
6. ✅ Check service pods have TLS config

## Rotation Suite

The `scripts/rotation-suite.sh` will:
1. Generate new CA certificate
2. Generate new leaf certificate (signed by new CA)
3. Update secrets in both namespaces
4. Restart Caddy to pick up new certs
5. Run k6 load tests during rotation
6. Verify strict TLS works with new certs

**Status: Verifying strict TLS configuration across all services**
