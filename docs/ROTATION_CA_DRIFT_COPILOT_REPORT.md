# Rotation Suite CA Drift — Handoff Report for Copilot

**Date:** 2026-02-26  
**Purpose:** Forward to Copilot for verification, fix implementation, or architectural redesign.

---

## Executive Summary

The rotation suite produces **curl exit 60** and **HTTP 000** because the CA used by the test harness does not match the CA currently served by Caddy. The root cause is **CA identity drift**: rotation silently switched from the custom OpenSSL CA (`CN=dev-root-ca, O=record-platform`) to mkcert-generated CA (`CN=dev-root-ca-<timestamp>, O=mkcert development CA`), creating two incompatible trust roots.

---

## The Smoking Gun

From rotation output after failure:

```
subject=CN=record.local, O=mkcert development certificate
issuer=CN=dev-root-ca-1772357437, O=mkcert development CA
```

The rotated leaf is signed by **mkcert** CA:

- **CN** = `dev-root-ca-1772357437` (timestamped, mkcert-style)
- **O** = `mkcert development CA`

But the baseline / harness expects:

- **CN** = `dev-root-ca` (deterministic, OpenSSL-style)
- **O** = `record-platform`

These are **different CAs**. The test harness trusts one; Caddy serves a leaf signed by the other. TLS handshake fails before ALPN — hence HTTP 000, curl exit 60.

---

## Why Everything Fails

| Component | Expected CA | Actual (after mkcert rotation) |
|-----------|-------------|---------------------------------|
| `certs/dev-root.pem` | `CN=dev-root-ca, O=record-platform` | May still contain old OpenSSL CA |
| Caddy (record-local-tls) | Same as harness | `CN=dev-root-ca-1772357437, O=mkcert development CA` |
| k6 ConfigMap (k6-ca-cert) | Same as Caddy | If not updated from rotated CA, mismatch |
| grpcurl / gRPC strict mTLS | Same as harness | Fails if CA file doesn't match leaf issuer |

**Result:** `self signed certificate in certificate chain` — clients reject the leaf because trust anchor not found.

---

## Why Baseline Worked Before

Before rotation, the entire stack used the same dev-root-ca (record-platform identity). After rotation, if mkcert is used, a **new** CA hierarchy is introduced. Trust continuity is broken.

---

## Verification Commands (Confirm Immediately)

### 1. Local CA file (what harness trusts)

```bash
openssl x509 -in certs/dev-root.pem -noout -subject -issuer -fingerprint -sha256
```

### 2. CA served by Caddy (what clients see)

```bash
# Resolve LB IP dynamically (MetalLB can reassign after rotation)
LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
echo | openssl s_client -connect ${LB_IP}:443 -servername record.local -showcerts 2>/dev/null \
  | openssl x509 -noout -issuer -subject -fingerprint -sha256
```

**If fingerprints differ → CA mismatch confirmed.**

### 3. Cluster dev-root-ca secret vs local

```bash
kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d | openssl x509 -noout -subject -fingerprint -sha256
openssl x509 -in certs/dev-root.pem -noout -subject -fingerprint -sha256
```

---

## Core Architectural Problem

Rotation suite has **two code paths**:

| Path | When | CA Source | Identity |
|------|------|-----------|----------|
| **OpenSSL** | `ROTATE_CA=true` (default) | OpenSSL-generated CA | `CN=dev-root-ca, O=record-platform` ✅ |
| **mkcert** | `ROTATE_CA=false` | `mkcert -CAROOT` | `CN=dev-root-ca-<ts>, O=mkcert development CA` ❌ |

If `ROTATE_CA=false` is set (e.g. by caller or env), rotation uses mkcert. The enhanced suite, k6, grpcurl, and strict TLS tests all expect the OpenSSL CA format. **Two dev roots in play = permanent break for strict TLS.**

---

## Current Fix in Codebase

`scripts/rotation-suite.sh` **already** uses OpenSSL for full rotation:

- **Lines 94–95:** CA generated with `-subj "/CN=dev-root-ca/O=record-platform"`
- **Lines 138–139:** Leaf CSR with `-subj "/CN=$HOST/O=record-platform"`
- **Lines 344–353:** CA synced to `certs/dev-root.pem` after secret updates
- **Lines 763–797:** k6 ConfigMap created from `certs/dev-root.pem` each iteration

**Defaults:** `ROTATE_CA=true`, `ROTATE_LEAF=true` (lines 14–15).

**If you still see mkcert output:** Check that no caller sets `ROTATE_CA=false`. Search for:

```bash
grep -r "ROTATE_CA" scripts/
```

---

## Recommended Strategy: Option B (Stop Using mkcert in Rotation)

**Use OpenSSL everywhere for rotation.** Do not use mkcert in the rotation path.

1. **Keep** the OpenSSL CA generator for full rotation (already in place).
2. **Keep** identity: `CN=dev-root-ca`, `O=record-platform`.
3. **Regenerate only keypair** — do not change CA identity style.
4. **Deprecate or remove** the mkcert branch (lines 115–118, 214–217) when `ROTATE_CA=false`, or at least document that leaf-only rotation with mkcert breaks strict TLS expectations.

**Why mkcert is risky here:**

- mkcert is for local browser trust, not zero-trust / mTLS mesh / wire-level validation.
- Timestamped CN (`dev-root-ca-<ts>`) breaks deterministic testing.
- Implicit system trust behavior conflicts with deterministic PKI lifecycle.

---

## Immediate Recovery (If Enhanced Suite Fails Now)

After rotation finishes, force CA alignment (CA lives in `dev-root-ca`, not in the leaf TLS secret):

```bash
kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d > certs/dev-root.pem
```

Then update k6 ConfigMap and rerun Enhanced suite:

```bash
kubectl -n k6-load create configmap k6-ca-cert --from-file=ca.crt=certs/dev-root.pem --dry-run=client -o yaml | kubectl apply -f -
```

If Enhanced suite passes → CA drift confirmed.

---

## HTTP/2 and HTTP/3 Both Fail

This is **not** protocol-level. TLS handshake fails **before** ALPN negotiation:

- HTTP Code: 000  
- curl exit: 60  
- Version: 0  

Handshake never completes.

---

## Certificate Chain Note

If rotation output shows:

```
Certificate chain contains 1 certificate(s)
```

Caddy may be serving **leaf only**, not full chain (leaf + CA). That's fine when the CA is in the trust store. When there's a trust mismatch, the client sees the leaf as self-signed because the chain doesn't include the trust anchor the client expects.

---

## Deterministic CA Authority Requirements

All of these must use the **same** CA:

- baseline suite
- enhanced suite
- rotation suite
- k6
- curl
- grpcurl
- gRPC mTLS

Right now, if mkcert is used in rotation, you get:

```
dev-root-ca-<timestamp>
O=mkcert development CA
```

That is incompatible with the original OpenSSL CA identity.

---

## Clean Solution Summary

1. **Use OpenSSL for rotation** — already in `rotation-suite.sh` when `ROTATE_CA=true`.
2. **Ensure `ROTATE_CA=true`** — no caller overrides to `false` for full rotation.
3. **CA identity:** `CN=dev-root-ca`, `O=record-platform`.
4. **Sync flow:** After rotation → `certs/dev-root.pem` → k6 ConfigMap → host health checks. All use the same file.
5. **Remove or isolate mkcert path** — avoid `ROTATE_CA=false` + mkcert in production/test rotation flows.

---

## Related Files

| File | Relevance |
|------|------------|
| `scripts/rotation-suite.sh` | CA/leaf generation, sync to certs/, k6 ConfigMap |
| `scripts/run-k6-chaos.sh` | k6 ConfigMap preflight, strict TLS |
| `scripts/test-microservices-http2-http3.sh` | CA resolution: K8s secret → certs/dev-root.pem → mkcert |
| `scripts/test-full-chain-with-rotation.sh` | Full-chain + rotation test flow |
| `docs/PKI_ALIGNMENT_FIX.md` | Earlier Envoy/client cert drift resolution |

---

## What’s Actually Happening

The system is behaving correctly for a strict PKI setup:

- You changed the root CA.
- Clients don't trust it.
- Handshake fails.

The fix is **CA identity consistency** — one deterministic CA across all tooling, not two (OpenSSL + mkcert).

---

*End of report — suitable for Copilot handoff.*
