# Preflight Run — Issues Report

**Run:** preflight-20260223-035032  
**Total time:** 7217s  
**Result:** 1 suite failed (baseline); k6 100% errors; 1 JS syntax error.

---

## Critical issues (fix first)

### 1. k6 HTTP/2 phase: `dial tcp 127.0.0.1:443: connect: can't assign requested address`

- **What:** All k6 requests to `https://record.local:443/api/records` fail.  
  Go HTTP client resolves `record.local` to **127.0.0.1** and connects to **127.0.0.1:443**.
- **Why it fails:**  
  - When k6 runs on the **host**, nothing is listening on host **127.0.0.1:443** (Caddy is in Colima VM at MetalLB IP 192.168.64.240).  
  - Or BASE_URL / host resolution is wrong for the run context (e.g. in-cluster vs host).  
  - “Can't assign requested address” often means **ephemeral port exhaustion** (many connections to same address) or **wrong target** (connecting to 127.0.0.1:443 when service is elsewhere).
- **Evidence:**  
  - `error_rate: 1`, `http_req_failed_rate: 1`  
  - ~29,941 requests, all failed  
  - `Get "https://record.local:443/api/records": dial tcp 127.0.0.1:443: connect: can't assign requested address`

**Fix:** Preflight and `run-k6-phases.sh` now set BASE_URL automatically:

- **From host (MetalLB):** When Caddy has a LoadBalancer IP, `BASE_URL` is set to `https://<LB_IP>:443` so k6 does not use 127.0.0.1. No extra env needed.
- **In-cluster:** Set `K6_IN_CLUSTER=1` so `BASE_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443`.
- See [docs/XK6_HTTP3_SETUP.md](XK6_HTTP3_SETUP.md) for xk6-http3 and k6 URL usage.

---

### 2. k6-http3-complete.js: SyntaxError (object spread)

- **What:** `Unexpected token (133:27)` at  
  `headers: { Host: HOST, ...options.headers }`
- **Why:** k6’s JS runtime (Babel) does not support **object spread** (`...`).
- **File:** `scripts/load/k6-http3-complete.js` line 133.

**Fix:** Replace spread with `Object.assign` (see below).

---

### 3. Baseline suite: gRPC via Envoy / port-forward

- **What:** Envoy gRPC routing test and gRPC Auth/Records health and authenticate fail.
- **Messages:**  
  - “Envoy gRPC routing test failed (port-forward to Envoy pod)”  
  - “gRPC Auth HealthCheck failed via Envoy”  
  - “gRPC Auth Authenticate failed via Envoy” — “Session open refused by peer”  
  - “Port-forward failed to establish connection to 50448:50051”  
  - “gRPC Records HealthCheck failed via Envoy”
- **Why:** On Colima, host → Envoy is via port-forward (or NodePort). SSH multiplexing / port-forward limits cause “Session open refused by peer” and port-forward failures.

**Fix (already partially done):** Prefer in-cluster grpcurl to Envoy; skip strict TLS port-forward from host when on Colima when Envoy/in-cluster already succeeded. Ensure baseline uses in-cluster Envoy health when available so baseline does not depend on host port-forward.

---

### 4. Baseline: Resell purchase via HTTP/3 — HTTP 404

- **What:** “Resell purchase via HTTP/3 failed - HTTP 404”
- **Why:** Either the resell endpoint path differs for HTTP/3, or the route/backend for that path is missing/incorrect for the request made (e.g. wrong path or method).

**Fix:** Inspect baseline script: exact URL and method for “resell purchase” over HTTP/3; compare with working HTTP/2 and with API gateway/shopping routes. Fix URL or route so HTTP/3 gets 2xx.

---

## Other issues (non-blocking but noted)

### 5. Social suite: GET /messages/groups — “List groups failed”

- One failing test in social comprehensive; rest pass.  
- Check route and response for `GET /api/messages/groups` (auth, query, or backend bug).

### 6. Caddy in-cluster health: “curl: executable file not found”

- LB-coordinated step runs curl inside Caddy pod; image has no `curl`.  
- Either add curl to that image or use wget/in-cluster client for that check.

### 7. HAProxy health: 503

- “HAProxy health returned 503” and pod "curl-hp-76696" deleted.  
- Check HAProxy deployment and config; ensure health check path and backend are correct.

### 8. pgbench: Ports 5435 (listings) and 5438 (auction_monitor) not reachable

- “Port 5435 (listings) | database=records --- (not reachable)”  
- “Port 5438 (auction_monitor) | database=auction_monitor --- (not reachable)”  
- Postgres on those ports was down or unreachable at that moment; re-run or fix DB/network.

---

## Summary table

| # | Area              | Issue                                      | Severity | Suggested fix |
|---|-------------------|--------------------------------------------|----------|----------------|
| 1 | k6                | record.local → 127.0.0.1:443, all fail     | Critical | Set BASE_URL to MetalLB IP or run k6 in-cluster |
| 2 | k6-http3-complete | Object spread `...options.headers`         | Critical | Use Object.assign in script |
| 3 | Baseline          | gRPC Envoy / port-forward failures        | High     | Rely on in-cluster grpcurl; skip host PF on Colima |
| 4 | Baseline          | Resell via HTTP/3 → 404                    | High     | Align HTTP/3 resell URL/route with HTTP/2 |
| 5 | Social            | GET /messages/groups failed                | Medium   | Debug route/response |
| 6 | LB-coordinated    | Caddy pod has no curl                      | Low      | Add curl or use other client |
| 7 | LB-coordinated    | HAProxy 503                                | Low      | Check HAProxy config/health |
| 8 | pgbench           | 5435, 5438 not reachable                   | Medium   | Ensure those Postgres instances are up |

---

## Passing / OK

- Auth, enhanced, adversarial, rotation, standalone-capture, tls-mtls, social (except one test), lb-coordinated (except Caddy curl and HAProxy).
- Packet capture: TCP 443 and UDP 443 present (e.g. 1271 TCP, 35 UDP).
- Caddy HTTP/3 health: 200 via LB IP. MetalLB and host reachability to 192.168.64.240:443 OK.
- DB connectivity: 8/8 ports OK in verification steps (pgbench sweep later showed 5435/5438 down at that time).

---

*Generated from preflight run preflight-20260223-035032 and terminal output.*
