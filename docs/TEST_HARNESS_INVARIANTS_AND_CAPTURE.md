# Test harness: invariants, packet capture, and Colima rules

Deterministic rules for the baseline/enhanced/adversarial suites so we avoid curl exit 55, broken packet capture, and gRPC "Too many arguments".

---

## Invariant rules

1. **Always restart Caddy via rollout** — never use Admin API (`localhost:2019/load`) on Colima; admin port is ClusterIP and host cannot reach it. Use:
   ```bash
   kubectl rollout restart deployment caddy-h3 -n ingress-nginx
   kubectl rollout status deployment caddy-h3 -n ingress-nginx
   sleep 2
   ```
2. **Always restart Envoy after CA rotation** — so Envoy picks up new CA bundle (reissue step already does this).
3. **Always sleep 2–3s after rollout before HTTP tests** — avoids racing pod readiness and curl exit 55.
4. **Never rely on NodePort on Colima** — use MetalLB LB IP for HTTP/2 and HTTP/3; gRPC via port-forward to Envoy pod only.
5. **gRPC on Colima: only port-forward to Envoy pod** — not in-cluster grpcurl, not NodePort, not service port-forward. Flow: port-forward `pod/<envoy-pod>` 10000:10000 → sleep 2 → grpcurl with method last.
6. **Retry idempotent curl once on exit 55** — GET health / attachment fetch: one retry after 500ms. No more than one retry.

---

## curl exit 55 (HTTP/2 + HTTP/3)

Exit 55 = "Failed sending network data" / connection reset mid-stream. Usually not application error; often QUIC connection reuse, Caddy pod restart during test, or strict TLS mismatch.

- **Rule A — Never reuse QUIC connection during verification:** Use `--no-keepalive` so each request uses a new connection.
- **Rule B — After any rollout restart, sleep before HTTP tests:** e.g. 3s after readiness checks (see above).
- **Rule C — Retry only idempotent calls once:** On exit 55, retry once after 500ms (implemented in `scripts/lib/http3.sh`). Test 16c (Social) and 16e (Shopping) HTTP/3 health checks add a **second** retry at script level (one more try after 0.5s) if the first attempt returns 55, since these endpoints sometimes fail once under load.

**Investigation:** If 16c/16e still fail after retry, check: (1) Caddy routing to social/shopping backends, (2) QUIC connection limits or backend slow response, (3) `strict_http3_curl` in `scripts/lib/http3.sh` uses `--no-keepalive` and one internal retry; the baseline adds one script-level retry for these two.

Use `--connect-timeout 3` and `--max-time 10` (or 15) for health checks to avoid hanging sockets.

---

## HTTP/3: direct only (no Docker bridge)

When using MetalLB LB IP (`TARGET_IP` + `PORT=443`), use **direct** path only: native curl to LB IP:443. Do **not** fall back to Docker bridge (host.docker.internal:18443) so behaviour is deterministic and avoids exit 55 on the bridge path.

- `HTTP3_SKIP_DOCKER_BRIDGE=1` is set by the baseline when `TARGET_IP` and `PORT=443` are set.
- Protocol verification: use `curl -w "%{http_version}"` — if 2 then HTTP/2, if 3 then HTTP/3. Do not infer protocol from packet capture ALPN.

---

## Packet capture rules

1. **Phase-based capture** — Start one tcpdump per phase (e.g. suite start); stop at phase/suite end. Do not start/stop per test (that causes SIGKILL mid-handshake and missing QUIC packets).
2. **Stop at phase end** — Drain briefly (e.g. 2s) then stop; do not kill capture immediately after a single request.
3. **Verification** — Packet capture confirms **TCP 443** (HTTP/2) and **UDP 443** (HTTP/3/QUIC) traffic only. Do **not** use ALPN detection from raw tcpdump (tcpdump does not decode TLS ALPN). Use curl output for protocol: `curl -I --http2 -w "%{http_version}"` → 2; `curl --http3 -w "%{http_version}"` → 3.
4. **Capture duration** — Prefer 2s drain before stop when using quick-stop mode; full copy capped by `CAPTURE_MAX_STOP_SECONDS`.

See `scripts/lib/packet-capture.sh` and `scripts/lib/protocol-verification.sh` (tshark HTTP/2 and QUIC counts are informational; protocol success is from curl).

---

## gRPC: direct first, then Envoy

1. **Test direct gRPC (no Envoy)** so you don't debug both at once:
   ```bash
   ./scripts/test-grpc-direct-in-cluster.sh auth-service
   ```
   Or from host: `kubectl run grpc-direct --rm -it -n record-platform --image=fullstorydev/grpcurl -- grpcurl -cacert /etc/certs/dev-root.pem auth-service.record-platform.svc.cluster.local:50051 grpc.health.v1.Health/Check` (with CA mounted from secret).
   If direct fails → service TLS is wrong. If direct works → Envoy cluster config is wrong.

2. **Envoy clusters** must have for every upstream:
   - `http2_protocol_options: {}` (without this gRPC fails silently)
   - `transport_socket` with `UpstreamTlsContext`, `sni: <upstream-hostname>` (e.g. auth-service.record-platform.svc.cluster.local), and `trusted_ca.filename` pointing at dev-root.pem.

3. **Disable gRPC suite until Envoy passes:** set `SKIP_GRPC=1` when running the baseline; fix Envoy then run without it.

---

## gRPC via Envoy (Colima)

On Colima + MetalLB, Envoy is ClusterIP; NodePort is not exposed to host. The **only** stable path is:

1. Get Envoy pod: `kubectl -n envoy-test get pod -l app=envoy-test -o name`
2. Port-forward **pod** (not service): `kubectl -n envoy-test port-forward pod/<envoy-pod> 10000:10000`
3. Wait 2 seconds.
4. grpcurl **strict TLS**, method **last** (no extra args):
   ```bash
   grpcurl -cacert certs/dev-root.pem -authority record.local -d '{}' localhost:10000 grpc.health.v1.Health/Check
   ```
   Do not append arguments after the method; grpcurl is strict and "Too many arguments" usually means wrong order or extra args.

---

## Speed rules (optional)

- **DB verification:** `DB_VERIFY_FAST=1` skips User2 block, fallback auth, and email lookups; uses shorter parallel timeout (5s) and `DB_VERIFY_POLL_INTERVAL` (default 0.5s) so the wait loop detects completion sooner. Set `DB_VERIFY_MAX_SECONDS=60` (or 120) to cap total time. Preflight sets `DB_VERIFY_FAST=1` and 60s cap.
- DB verify per service group (e.g. auth group → 1 check, social → 1 check) instead of after every write.
- Parallelize HTTP/2 and HTTP/3 tests where they hit different connections.
- Remove duplicate health checks (keep smoke + post-rotation).
- Lower adaptive baseline ~10–15% for Colima single-node (e.g. H2=280, H3=160) to reduce control-plane stress.

---

## More schema coverage (optional tests)

Baseline already hits: auth, records, forum/messages (social), listings, shopping (cart, orders, purchase_history, resell, search_history). To cover additional schemas and DBs (see **docs/SCHEMA_TABLE_BREAKDOWN.md**):

- **Port 5436 (shopping DB):** feedback.reviews, feedback.user_profiles, shopping.notifications, shopping.price_alerts — add API tests if endpoints exist (e.g. get/leave review, notifications, price alert).
- **Port 5438 (auction_monitor):** health and any auction/bid API if exposed via api-gateway.
- **Port 5439 (analytics):** health (already in Test 16d) and any analytics event/aggregation API.
- **Port 5440 (python_ai):** health (already in Test 16g) and any AI pipeline API.

DB verification currently checks 5433–5437 (records, social, listings, shopping, auth). Optional: add a single `SELECT 1` per port for 5438, 5439, 5440 when `DB_VERIFY_FAST=0` to confirm all 8 DBs are reachable.

---

## Related

- **scripts/test-microservices-http2-http3.sh** — Baseline; implements post-rollout sleep, direct HTTP/3, gRPC port-forward path.
- **scripts/lib/http3.sh** — `--no-keepalive`, retry on 55 once (500ms), native curl path.
- **scripts/lib/packet-capture.sh** — Phase-based start/stop; first-packet analysis (TCP/UDP 443 counts).
- **docs/ENVOY_GRPC_HEALTH_LAYERS.md** — L1/L2/L3 health layers.
- **docs/HTTP3-CURL-EXIT-CODES.md** — Exit 28, 55, etc.
