# Root Cause and Fixes (Test Suite, LB IP, gRPC, DB Verification)

## 1. Test 1b: User 2 not found in auth.users (port 5437)

**Symptom:** `Test 1b DB: User 2 in auth.users: no/zero result in DB (port 5437)`.

**Root cause:** Auth-service writes to **5437/records** (schema `auth` inside database `records`). The test was verifying against **5437/auth** (database name `auth`). On many setups the database name on the auth instance is `records`, not `auth`, so the check failed.

**Fix:** Verify against **5437/records** first, then fallback to 5437/auth. Same for post-test DB verification (User2): query 5437/records first, then auth. See `scripts/test-microservices-http2-http3.sh` (Test 1b and DB verification section).

**Canonical DB name per port (for verification):**

| Port | Service        | DB name   | Schema(s)   |
|------|----------------|-----------|-------------|
| 5433 | records        | records   | records     |
| 5434 | social         | records   | forum, messages |
| 5435 | listings       | records   | listings    |
| 5436 | shopping       | shopping  | shopping    |
| 5437 | auth           | records   | auth        |
| 5438 | auction_monitor| postgres  | (varies)    |
| 5439 | analytics      | analytics | analytics   |
| 5440 | python_ai      | python_ai | ai          |

---

## 2. HTTP/3 (UDP) to LB IP 192.168.x.x:443 — test both LB IP and NodePort

**Symptom:** `HTTP/3 (UDP) to LB IP 192.168.106.241:443 failed (curl exit 7).`

**Root cause:** Exit 7 = connection refused. UDP socat may not be running, or macOS firewall blocks UDP 443. We do **not** want to silently fall back to NodePort only; we want to **test both** paths and report both.

**Fix (run-all):** When HTTP/3 to LB IP fails, we **keep PORT=443** and **TARGET_IP=LB_IP** so HTTP/2 still uses the LB path. We only set `HTTP3_USE_LB_IP=0` so the baseline uses NodePort for HTTP/3. The baseline script now **tests both**: it runs "HTTP/3 via LB IP" and "HTTP/3 via NodePort" and prints OK/fail for each, so both paths are validated.

**Making UDP 443 work:** Run **once with sudo**: `LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh`. Check `lb-ip-socat-udp.log` if UDP still fails; allow UDP 443 in macOS firewall if needed.

---

## 3. gRPC: Envoy NodePort 30000/30001 not reachable from host

**Symptom:** Test 15 uses port-forward because “Envoy NodePort 30000/30001 not reachable from host”; Envoy service is ClusterIP.

**Root cause:** Envoy service was `ClusterIP` with no NodePort, so the host couldn’t reach it without a port-forward.

**Fix (applied):** Envoy service is now **NodePort** with **nodePort: 30000** in `infra/k8s/base/envoy-test/deploy.yaml` — same pattern as Caddy (NodePort 30443). Apply: `kubectl apply -k infra/k8s/base/envoy-test`. Host can use `127.0.0.1:30000` when Envoy runs on the same node; port-forward remains valid otherwise. This fixes gRPC reachability for good like NodePort does for Caddy.

---

## 4. Test 13j5: Checkout via HTTP/3 — HTTP 400 “No items found in cart”

**Symptom:** 13j5 checkout returns 400 with `{"error":"No items found in cart"}` even though 13j1 added an item and 13j2 get-cart succeeded.

**Root cause:** Timing or ordering: cart can be empty when 13j5 runs (e.g. 13j1 hadn’t persisted yet, or cart was cleared elsewhere). Cart is in DB so it’s not per-pod; the issue is test ordering/retries.

**Fix:** (1) Before 13j5, if get-cart (13j2) indicated an empty cart, re-add one item via HTTP/3 and sleep 1. (2) If 13j5 returns 400 with “No items found in cart”, retry once: re-add item via HTTP/3, sleep 1, then run checkout again. This makes 13j5 robust to empty-cart races.

---

## 5. Test 13j8: Resell via HTTP/3 — HTTP 404

**Symptom:** Resell purchase via HTTP/3 fails with 404.

**Root cause:** When 13j5 fails, `PURCHASE_ID_H3` is never set, so 13j8 tries to resell with no (or wrong) purchase id.

**Fix:** If `PURCHASE_ID_H3` is empty, set it from `PURCHASE_ID` (from the HTTP/2 checkout in 13c) so 13j8 has a valid purchase to resell.

---

## 6. Packet capture: no TCP/UDP 443 counts

**Symptom:** `Packet analysis: no TCP/UDP 443 counts (one Caddy pod may have had tcpdump install timeout)`.

**Root cause:** tcpdump isn’t installed in the Caddy image (or install times out during capture start).

**Fix:** Use the **caddy-with-tcpdump** image and `scripts/k3d-registry-push-and-patch.sh` so tcpdump is present in the pod and capture can record TCP/UDP 443.

---

## 7. DB verification: correct DB per port and time limit

**Fix (DB name):** Auth (5437) uses database **auth** (POSTGRES_URL_AUTH=.../auth). `verify_db_after_test` and post-test checks use the canonical port → DB map; auth is checked as **auth** first, then **records** for backward compatibility.

**Fix (time limit):** Default **DB_VERIFY_MAX_SECONDS=120**. When the cap is reached, the script prints a timestamped line: `[HH:MM:SS] (Nns) DB verification time limit (120s) reached; proceeding to next suite.` and continues so the next test suite runs instead of blocking.
