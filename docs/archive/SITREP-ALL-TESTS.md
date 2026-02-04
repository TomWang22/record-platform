# SITREP — All Tests (Baseline, Enhanced, Rotation)

**Date:** 2026-01-22  
**Status:** All three suites have **completed**. No test processes currently running.  
**Last updated:** Current cluster/infra check below.

---

## 1. Baseline smoke test (`baseline-final-1769137209.log`)

### Overall: **Completed** — Mixed results

| Area | Status | Notes |
|------|--------|------|
| Auth (reg/login, HTTP/2 & HTTP/3) | ✅ Pass | User 1 & 2 |
| Records (create, HTTP/2 & HTTP/3) | ✅ Pass | |
| gRPC (all 10 services) | ✅ Pass | Envoy + port-forward strict TLS |
| Listings (health, search, create, my listings) | ✅ Pass | HTTP/2 & HTTP/3 |
| Shopping (cart, checkout, orders, resell, search history) | ✅ Pass | |
| Auth logout & delete account | ✅ Pass | 401 verification OK |
| DB verification | ⚠️ Partial | User in auth DB ✅; User NOT in 5433 (records) |

### Failures / warnings

- **Caddy health (Test 4):** HTTP/2 and HTTP/3 **failed** (likely SSL-related).
- **API Gateway health (Test 5):** **curl exit 60** (SSL cert verify failed), HTTP 000.
- **HTTP/2 requests with curl 60 (SSL):**
  - Create forum post (Test 6)
  - Get forum posts (Test 7)
  - Send P2P message (Test 8)
  - Get messages (Test 9)
  - Add member to group (Test 9c)
- **HTTP/3 equivalents** for the same flows **passed** (e.g. forum post, P2P, group message).
- **Test 16f – Auction Monitor HTTP/3 health:** **503**.
- **Test 16g – Python AI HTTP/3 health:** **503**.
- **Test 9k – Leave group:** **403** “You are not a member” (downstream of skipped add-member).
- **User 1 NOT found in `auth.users` (port 5433):** May indicate foreign-key or schema expectations.

### Likely causes

1. **curl 60 on HTTP/2:** TLS verification failing for some requests (CA/cert mismatch or wrong CA after rotation). HTTP/3 path uses `strict_http3_curl` with `-k` fallback, so it can still pass.
2. **503 on Auction Monitor & Python AI:** Upstream unhealthy or gateway/proxy returning 503; added `/api/auction-monitor/healthz` and `/api/python-ai/healthz` routes may not be enough if backends are down or Caddy → API GW → service chain is broken.

---

## 2. Enhanced smoke test (`enhanced-fixed-1769137080.log`)

### Overall: **Completed** — Adversarial + DB checks done

| Area | Status | Notes |
|------|--------|------|
| Auth (reg/login), Records (create), Health | ✅ Pass | HTTP/2 & HTTP/3 |
| Caddy health HTTP/3 | ✅ Pass | |
| Protocol verification | ⚠️ Mixed | “No HTTP/2 frames” in captures (TLS encrypted); some HTTP/2 verify fails |
| Adversarial 1 – Invalid cert | ⚠️ Warn | “Invalid cert test result: ok” |
| Adversarial 2 – Protocol downgrade | ✅ Pass | Rejected or handled |
| Adversarial 3 – Cert rotation recovery | ⚠️ Warn | “Service may have issues after certificate rotation” |
| Adversarial 4 – Connection flood | ❌ Fail | **0/20 successful** |
| Adversarial 5 – Malformed requests | ✅ Pass | 2/2 handled |
| Adversarial 6 – Recovery after error | ⚠️ Warn | “Service may not recover properly after error” |
| Adversarial 7 – TLS downgrade | ⚠️ Warn | “TLS downgrade test result: ok” |
| Adversarial 8 – HTTP/3 → HTTP/2 fallback | ✅ Pass | HTTP/3 direct, no fallback needed |
| DB verification | ⚠️ Partial | User & record exist ✅; User not in 5433, no cart items |

### Capture / wire

- Captures under `/tmp/smoke-test-captures-1769137085/` (Caddy + Envoy).
- Envoy: e.g. `adversary1-invalid-cert` ~11K; others often 24 B (minimal).

---

## 3. Rotation suite (`rotation-higher-1769137076.log`)

### Overall: **Completed** — Certs rotated, k6 run done, limit-finding stopped at iteration 1

| Step | Status | Notes |
|------|--------|------|
| Cert generation | ✅ | Overlap window failed; standard cert used |
| K8s secrets (CA + leaf) | ✅ | Both namespaces updated |
| Caddy reload | ⚠️ | Rollout wait **timed out**; pods then reported ready |
| k6 chaos job | ⚠️ | **`kubectl wait` timed out (660s)**; results collected anyway |
| Protocol verification | ✅ Envoy | **HTTP/2 verified** (92 packets) |
| | ⚠️ QUIC | **No QUIC** in Envoy capture (HTTP/3 via Caddy, not Envoy) |
| Cert verification (Test 7) | ❌ | “Could not retrieve certificate info via port-forward”; “All certificate retrieval methods failed” |

### k6 / limit-finding

- **Rates:** H2 = **300 req/s**, H3 = **160 req/s** (combined **460 req/s**).
- **Iteration 1:** “Limit found” — **41.16% dropped iterations**, **0.00% failure rate**.
- **Requests:** 48,716 total (expected ~82,800); **34,084 iterations dropped**.
- **Reported “last successful”:** H2 = 300, H3 = 160, combined 460 req/s, but drops **> 1.5%** threshold → suite treats as at capacity.

### DB verification (post–k6)

- **Connectivity:** ✅ (127.0.0.1:5433/records, `host.docker.internal` fallback).
- **auth.users:** ✅ 50,360 users.
- **records.records:** ✅ 2,438,131 records.
- **Foreign keys:** ⚠️ **38,131 violations** reported.

### Captures

- Wire captures under `/tmp/rotation-wire-1769137237`.

---

## Summary

| Suite | Done? | Main issues |
|-------|-------|-------------|
| **Baseline** | ✅ Yes | curl 60 on several HTTP/2 calls; Caddy & API GW health fail; 16f/16g 503; leave-group 403; user not in 5433 |
| **Enhanced** | ✅ Yes | Connection flood 0/20; recovery & cert-rotation warnings; protocol verify mixed |
| **Rotation** | ✅ Yes | 41% drops at 460 req/s (0% failures); k6 wait timeout; cert retrieval failed; 38K FK violations |

---

## Recommended next steps

1. **Baseline – curl 60:**  
   - Confirm which CA the baseline uses vs. what Caddy/API GW serve (including after rotation).  
   - Ensure same CA is used for all HTTP/2 strict TLS checks (e.g. `strict_curl`).

2. **Baseline – 503 on Auction Monitor & Python AI:**  
   - Check service health and Caddy → API GW → service routing.  
   - Verify `/api/auction-monitor/healthz` and `/api/python-ai/healthz` reach healthy backends.

3. **Enhanced – connection flood & recovery:**  
   - Investigate why 0/20 connection-flood requests succeed and why “recovery after error” is uncertain.  
   - Consider relaxing or scoping adversarial expectations if they’re stricter than deployment limits.

4. **Rotation – cert verification:**  
   - Fix port-forward or retrieval method so “Test 7” can fetch and inspect the new certificate post-rotation.

5. **Rotation – FK violations:**  
   - Review DB constraints and k6 data patterns (e.g. user/record creation) to track down the 38,131 foreign key violations.

6. **Rotation – limit finding:**  
   - 460 req/s with 41% drops and 0% failures indicates capacity limit.  
   - Either accept lower sustainable rate (e.g. where drops &lt; 1.5%) or increase resources and re-run.

---

**No test processes are running.** Logs:  
`/tmp/baseline-final-1769137209.log`,  
`/tmp/enhanced-fixed-1769137080.log`,  
`/tmp/rotation-higher-1769137076.log`.

---

## Current infrastructure (as of last check)

| Component | Status |
|-----------|--------|
| **Cluster** | colima, API server OK |
| **Caddy (ingress-nginx)** | 2 pods Running (caddy-h3-*); 1 recently restarted |
| **Envoy (envoy-test)** | 1 pod Running |
| **Services (record-platform)** | auth, records, listings, social, shopping, analytics, auction-monitor, python-ai, api-gateway: all 1/1 Running |
| **Exporters** | haproxy-exporter, nginx-exporter: Running |
| **Kafka** | 0/1 Error (auction-monitor may log Kafka errors; health can still respond) |
