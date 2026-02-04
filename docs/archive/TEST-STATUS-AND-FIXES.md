# Current Test Status and Fixes

**Last updated:** 2026-01-22

## Summary: What’s Passing vs Failing

### Passing

| Area | Status | Notes |
|------|--------|------|
| **API server** | OK | `ensure-api-server-ready.sh`; Colima k3s reachable |
| **Verify-all-fixes** | OK | API, Envoy ConfigMap, Envoy pod, 2× Caddy, fix scripts |
| **Baseline smoke (most)** | OK | HTTP/2, HTTP/3, auth, records, social, listings, shopping, Caddy, Envoy, gRPC (Records, Social, Listings, Analytics, Shopping, Authenticate) |
| **gRPC Auth HealthCheck** | OK | **Fixed:** grpcurl now uses method without leading slash (see below) |
| **Envoy gRPC routing** | OK | Auth, Records, etc. via Envoy NodePort 30000 |
| **Rotation suite (core)** | OK | CA/leaf rotation, Caddy rollout, k6 chaos (0% failures, 33k+ requests) |
| **k6 custom image** | OK | Builds; includes net-tools, tcpdump, tshark, curl, psql |

### Fixed This Session

| Issue | Root cause | Fix |
|-------|------------|-----|
| **gRPC Auth HealthCheck “failed”** | grpcurl was called with `/auth.AuthService/HealthCheck` (leading slash). grpcurl expects `auth.AuthService/HealthCheck` (no slash). | Use `$method` instead of `$method_path` in all grpcurl calls in `grpc_test()`. |
| **Fallback for Envoy gRPC failures** | Script did not treat “Unimplemented” / “does not expose” as Envoy failure. | Added `Unimplemented` and `does not expose` to the fallback condition in `grpc_test()`. |
| **Rotation wire captures 0-byte** | Envoy tcpdump filter used `(port >= 50051 and port <= 50060)`; tcpdump expects `portrange 50051-50060`. | Use `portrange 50051-50060` in Envoy capture. Added `sleep 3` and `sync` before copying pcaps. |
| **DB verification “failed”** | `verify-k6-database.sh` uses `DB_HOST=host.docker.internal`; from host this can fail. | Try `127.0.0.1` when `DB_HOST=host.docker.internal` and first connect fails. |
| **verify-all-fixes Envoy check** | Grep required `safe_regex` and `auction_monitor` on same line; ConfigMap has them on different lines. | Check for both patterns separately in ConfigMap YAML. |
| **verify-all-fixes typo** | `kubectl get ppp=envoy-test` | Use `kubectl get pods -l app=envoy-test`. |

### Still Failing / Partially Failing

| Area | Status | Notes |
|------|--------|------|
| **gRPC Auction Monitor HealthCheck** | Failing | Envoy returns `Unimplemented` for `auction_monitor.AuctionMonitorService/HealthCheck`. Port-forward to 50059 refused (gRPC may not be up in pod). Unclear if route hits auth vs auction-monitor; needs follow-up. |
| **Enhanced smoke – HTTP/2 wire verification** | Warn | “No HTTP/2 frames found in capture” from tshark. Traffic is TLS-encrypted; tshark would need TLS key logging to decode. Application-level HTTP/2 works. |
| **Rotation – cert verification** | Warn | “Could not retrieve certificate info via port-forward.” Port-forward to 8443 is up; `openssl s_client` → `x509` returns empty. Likely s_client verify/connect issue; not yet debugged. |
| **Rotation – k6 job wait** | Timeout | `kubectl wait` for k6 job often times out; results are still collected. Job usually completes. |
| **Kafka** | CrashLoopBackOff | Cluster Kafka pod failing;不影响 core smoke tests. |

---

## Scripts Touched

- `scripts/test-microservices-http2-http3.sh`: grpcurl method fix, fallback condition update.
- `scripts/verify-all-fixes.sh`: Envoy check logic, `get pods` typo fix.
- `scripts/verify-k6-database.sh`: localhost fallback when `DB_HOST=host.docker.internal`.
- `scripts/rotation-suite.sh`: Envoy tcpdump filter `portrange`, sync + sleep before copying pcaps.

---

## How to Re-run

```bash
./scripts/ensure-api-server-ready.sh
./scripts/verify-all-fixes.sh
./scripts/test-microservices-http2-http3.sh    # baseline smoke
./scripts/test-microservices-http2-http3-enhanced.sh
./scripts/rotation-suite.sh
```

---

## Next Steps (Optional)

1. **Auction Monitor gRPC**: Confirm gRPC server listens on 50059 in pod; check Envoy route vs default auth route; fix any route or impl issue.
2. **Cert verification**: Run `openssl s_client` manually over port-forward, capture stderr, and fix connect/verify.
3. **Wire-level HTTP/2**: Enable TLS key logging for tshark if you need HTTP/2 verification in pcaps.
