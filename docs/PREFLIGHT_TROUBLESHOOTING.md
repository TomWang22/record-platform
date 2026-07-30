# Preflight run troubleshooting

When preflight or suites hit **port-forward / strict TLS**, **HTTP/3 curl 55/28**, **Test 13 (shopping)**, or **Records HTTP/3 health (curl 28)**, use this guide.

---

## 1. Port-forward and strict TLS/mTLS (Envoy works, “the other one” not)

**Symptom:** Envoy gRPC works (e.g. via NodePort or in-cluster), but strict TLS/mTLS or Caddy verification fails; or you need “the other setup” for full strict TLS.

**Two paths that must both work:**

| Path | What it is | How to fix |
|------|------------|------------|
| **Envoy** | gRPC via Envoy (NodePort 30000/30001 or in-cluster). Tests use Envoy for HealthCheck/Authenticate/SearchRecords when reachable from host. | Ensure Envoy pod is Ready; NodePort 30000/30001 published when using host. If host can’t reach NodePort (e.g. Colima), use **port-forward** path below. |
| **Port-forward (strict TLS/mTLS)** | `kubectl port-forward` to a **gRPC pod** (e.g. auth-service, records-service) so host runs `grpcurl` with CA + client cert to `127.0.0.1:50051`. This is the **primary** strict TLS path when NodePort isn’t exposed. | Use **host** kubectl (not Colima shim) for port-forward so `127.0.0.1` is on the host. Preflight step 5 runs `ensure-strict-tls-mtls-preflight.sh` to validate `service-tls` + `dev-root-ca` and restart gRPC workloads. If that script is missing, ensure manually: (1) `service-tls` and `dev-root-ca` secrets exist and chain is valid; (2) sync CA to `certs/dev-root.pem`; (3) rollout restart api-gateway, auth-service, records-service, messaging-service, listings-service, shopping-service, auction-monitor, python-ai-service, analytics-service. |
| **Caddy strict TLS** | HTTPS (HTTP/2 and HTTP/3) to Caddy with `certs/dev-root.pem`. Step 4d/4e verifies Caddy (in-cluster or port-forward). | On k3d: `verify-caddy-strict-tls-in-cluster.sh`. On Colima without NodePort: start a short-lived port-forward to `svc/caddy-h3 8443:443`, then `PORT=8443 CADDY_TARGET=127.0.0.1 ./scripts/verify-caddy-strict-tls.sh`. Ensure `certs/dev-root.pem` is the CA that signed the leaf Caddy uses. |

**Root cause (why strict TLS/mTLS did not work):** Preflight step 5 calls **ensure-strict-tls-mtls-preflight.sh**, which was previously missing. Without it, `service-tls` and `dev-root-ca` were not validated or provisioned, and gRPC workloads were not restarted after cert changes (503/self-signed). The script is now in place: it validates the chain, provisions from repo certs or mkcert if missing, syncs CA to `certs/dev-root.pem`, and when secrets change or `FORCE_TLS_RESTART=1` runs sync-envoy-tls-secrets and rollout restarts all gRPC/TLS deployments.

**MetalLB IP for health checks:** When `USE_LB_FOR_TESTS=1` and a reachable MetalLB IP is set (`REACHABLE_LB_IP` / `TARGET_IP`, port 443), HTTP/3 and gRPC health checks use that LB IP. `run-all-test-suites.sh` exports `TARGET_IP` and `PORT=443`. The shared lib **`scripts/lib/grpc-http3-health.sh`** uses them: Caddy HTTP/3 health uses `--resolve record.local:443:${TARGET_IP}` when `TARGET_IP` is set, and gRPC health tries `grpcurl` to `${TARGET_IP}:443` (strict TLS) first before Envoy NodePort or port-forward.

**Checklist:**

1. Run **ensure-strict-tls-mtls-preflight.sh** (preflight step 5). It validates service-tls + dev-root-ca, syncs CA to `certs/dev-root.pem`, and restarts gRPC deployments when certs change or `FORCE_TLS_RESTART=1`.
2. **Caddy:** Verify with `verify-caddy-strict-tls.sh` or `verify-caddy-strict-tls-in-cluster.sh` so “no curl 60” (certificate chain).
3. **gRPC strict TLS:** Baseline runs Envoy, MetalLB IP (when TARGET_IP set), and port-forward. For port-forward, `KUBECTL_PORT_FORWARD` must be host kubectl; certs in `/tmp/grpc-certs` or `GRPC_CERTS_DIR` with `ca.crt`, `tls.crt`, `tls.key` for mTLS. See `scripts/lib/grpc-http3-health.sh` and TEST-FAILURES-AND-WARNINGS.md “gRPC Envoy (strict TLS/mTLS)”.

---

## 2. HTTP/3 tests: curl 55 (send failure)

**Meaning:** For HTTP/3/QUIC, curl exit **55** = sendto() failed or UDP path broke (e.g. ngtcp2 ERR_HANDSHAKE_TIMEOUT). Often transient on macOS when using MetalLB + socat.

**Fixes (in order):**

1. **NGTCP2_ENABLE_GSO=0** — Scripts set this; ensure it’s set when running curl (e.g. `export NGTCP2_ENABLE_GSO=0`). GSO can cause send failures on macOS.
2. **Retry on 55** — `scripts/lib/http3.sh` retries once (after 2s) on exit 55 when `HTTP3_RETRY_ON_55=1` (default). **socat / LB IP path** — MetalLB only (no NodePort): run `setup-lb-ip-host-access.sh` (and `fix-http3-lb-ip-reset.sh` if needed). Only one socat; kill stale processes. See **docs/HTTP3-CURL-EXIT-CODES.md** and **docs/HTTP3-LB-IP-FIX-CHECKLIST.md**.
3. **In-cluster HTTP/3** — Preflight step 4f verifies HTTP/3 from a **pod** (bypasses host UDP). If 4f passes but host HTTP/3 fails, the issue is host→NodePort/socat; use in-cluster as the authoritative “HTTP/3 works”.

---

## 3. HTTP/3 tests: curl 28 (timeout) — especially Records

**Meaning:** Curl waited too long (no response). Often QUIC handshake or first response slow.

**Records service specifically (Test 16b):** Records HTTP/3 health can return **curl 28** when other service health checks pass. Common causes:

- **Cold backend:** First request to records-service after startup may open DB connections and be slower; subsequent requests are faster.
- **Same path as others:** Records uses the same `HTTP3_RESOLVE` and Caddy route; if only Records times out, the backend (or Caddy→records proxy) is slower for that path.

**Fixes:**

1. **Longer timeout for Records:** The baseline script uses `--max-time 15` and one retry for Records HTTP/3 health (Test 16b) to tolerate cold start.
2. **NGTCP2_ENABLE_GSO=0** — Reduces spurious timeouts on macOS (see docs/RCA-HTTP3-CURL-EXIT-28.md).
3. **Verify path:** Run `curl` manually to `/_caddy/healthz` (HTTP/3); if that works, then try `/api/records/healthz`. If Caddy health works but records health times out, the delay is Caddy→records-service (or records-service startup/DB).
4. **In-cluster:** Step 4f (in-cluster HTTP/3) is the authoritative check; host HTTP/3 can be best-effort on some setups.

---

## 4. Test 13 (Shopping) — checkout and related failures

**Symptoms:** Test 13c (checkout) fails with **duplicate key `orders_order_number_key`**; 13e, 13h, 13j5 etc. skip with “Order ID not available” or “No items in cart”.

**Root cause:** The shopping DB (port **5436**, database **shopping**) must have the **order_number sequence** and **generate_order_number()** so new orders get unique `order_number` values. Without it, checkout hits a unique constraint.

**Fix (run once before suites):**

```bash
./scripts/ensure-shopping-order-number-sequence.sh
```

Preflight **step 3b4** runs this when `SKIP_PREFLIGHT_MIGRATIONS≠1`. If you run suites without preflight, or 13c still fails after preflight:

1. Ensure Postgres on **5436** is up and database **shopping** exists.
2. Run `./scripts/ensure-shopping-order-number-sequence.sh` (applies `infra/db/09-shopping-order-number-sequence.sql` and syncs the sequence above current max).
3. Re-run baseline; 13c and 13j5 should pass. 13e, 13h, etc. depend on ORDER_ID from 13c/13j5.

**Other Test 13 issues:**

- **“No items in cart” for 13j5:** Cart may be empty if 13j1/13j2 didn’t persist or request hit before write. The script retries by re-adding an item and retrying checkout once.
- **DB name:** Shopping service uses **database `shopping`** on port 5436 (see infra/docs/EIGHT-DATABASES_ARCHITECTURE.md). Ensure schema and sequence are on that DB.

---

## 5. MetalLB IP (no NodePort fallback)

**Intent:** The suite uses **MetalLB LB IP** as primary when `TARGET_IP` and `PORT=443` are set (e.g. from MetalLB verification / `REACHABLE_LB_IP`). NodePort is **not** used as fallback unless explicitly allowed.

**Behavior:**

- When `TARGET_IP` is set and `PORT=443`, HTTP/2 and HTTP/3 use the LB IP (`HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"`). If the HTTP/3 probe fails, the suite **still uses the LB IP** (no automatic NodePort fallback).
- To allow NodePort fallback when the LB path fails, set **`ALLOW_NODEPORT_FALLBACK=1`** before running the suite.
- TCP connectivity: if TCP to the LB IP fails, the suite keeps using the LB IP unless `ALLOW_NODEPORT_FALLBACK=1` and NodePort returns 200.

**gRPC port-forward:** Strict TLS/mTLS is verified by **always** running port-forward to each service’s gRPC port (in addition to Envoy when reachable). Set **`GRPC_ALWAYS_PORT_FORWARD=0`** to skip port-forward when Envoy already succeeded (saves time; default is 1 for thoroughness).

**gRPC via MetalLB:** When `TARGET_IP` and `PORT=443` are set, the baseline suite (Test 15) and `lib/grpc-http3-health.sh` try grpcurl to `TARGET_IP:443` first (TLS, authority record.local). If that succeeds, NodePort and port-forward are skipped for that call, avoiding Colima SSH multiplexing (Session open refused by peer) and port-forward conflicts.

---

## 6. Step-by-step debugging (common failures)

| Symptom | Likely cause | What to check |
|--------|---------------|----------------|
| curl exit 55 (HTTP/3) | QUIC send failure / handshake timeout (transient) | NGTCP2_ENABLE_GSO=0 set; lib/http3.sh retries once on 55. Run setup-lb-ip-host-access.sh; see §2. |
| gRPC Session open refused by peer / ControlSocket already exists | Colima SSH multiplexing when many port-forwards run | gRPC tries MetalLB IP:443 first when TARGET_IP set; Envoy/port-forward only if LB path fails. |
| Test 11 Search listings HTTP 504 | Listings service or gateway timeout | Check listings-service logs; increase proxy timeouts if backend slow. |
| Test 13g/13j7 Get resellable purchases HTTP 500 | Backend error (e.g. missing table or logic) | Check shopping-service logs; verify shopping schema and feedback/purchase views. |
| Enhanced suite: Test 1 HTTP 000, Test 2 login 401 | Registration failed (HTTP 000) so no token for login | HTTP 000 often connection/QUIC failure. Run baseline first to confirm auth works. |
| Schema / table not found | DB not migrated or wrong database name | See docs/SCHEMAS_AND_TABLES.md Test expectations; run ensure-all-schemas-and-tuning.sh and ensure-shopping-order-number-sequence.sh. |

---

## 7. Quick reference

| Issue | Doc / script |
|-------|----------------|
| HTTP/3 exit 7/28/55 meanings | docs/HTTP3-CURL-EXIT-CODES.md |
| LB IP + socat + alias | docs/HTTP3-LB-IP-FIX-CHECKLIST.md |
| HTTP/3 curl 28 (timeout / GSO) | docs/RCA-HTTP3-CURL-EXIT-28.md |
| Strict TLS/mTLS + 503 | Runbook.md items 24–25; TEST-FAILURES-AND-WARNINGS.md “gRPC Envoy” |
| Test 13 duplicate key | scripts/ensure-shopping-order-number-sequence.sh; TEST-FAILURES-AND-WARNINGS.md “Shopping” |
| Caddy strict TLS verify | scripts/verify-caddy-strict-tls.sh, verify-caddy-strict-tls-in-cluster.sh |
| Schema / test expectations | docs/SCHEMAS_AND_TABLES.md (Test expectations + Restore) |
| Step-by-step debugging | §6 (curl 55, gRPC SSH, 504/500, enhanced suite) |
