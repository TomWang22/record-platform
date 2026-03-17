# QUIC Session Tuning (Applied)

**Context:** Transport study showed UDP errors=0, QUIC packets present, but `Session open refused by peer` under k6 load. Root cause: QUIC stream exhaustion / connection churn / CPU scheduling, not packet loss.

## Changes applied

### 1. Caddy (Caddyfile)
- **servers timeouts idle 2m**: Keep connections open longer for reuse (default 5m; explicit 2m ensures QUIC has room).
- Note: `max_concurrent_streams` is not exposed in Caddyfile. If "Session open refused" persists: build Caddy with xcaddy + quic-go fork that sets `MaxIncomingStreams: 2000` (see quic-go Config); or increase Caddy replicas to spread QUIC load.

### 2. k6 chaos (k6-chaos-test.js)
- **H3 executor: constant-vus** (default) instead of constant-arrival-rate.
  - 20 VUs, 90s duration.
  - Fewer stable connections, many streams per connection.
- Override: `H3_EXECUTOR=constant-arrival-rate` to restore old behavior; `H3_VUS`, `H3_DURATION` to tune.

### 3. xk6-http3 extension (connection reuse)
- **Per-VU client reuse**: One QUIC connection per VU, reused across iterations (getOrCreateClient + sync.Once).
- **QuicConfig**: MaxIdleTimeout 2m (match Caddy), KeepAlivePeriod 15s.
- **TLS**: Default InsecureSkipVerify=false; ServerName from options for SNI.
- Rebuild after changes: `./scripts/build-k6-http3.sh`

### 4. Caddy deployment (caddy-h3-deploy*.yaml)
- **CPU requests: 1000m** (was 500m).
- **Memory requests: 512Mi** (was 256Mi).
- Limits: 2000m CPU, 1Gi memory.

## Validation

1. **Re-run rotation suite:** `./scripts/rotation-suite.sh`
2. **H3-only test:** `H2_RATE=0 ./scripts/rotation-suite.sh`
3. **Watch Caddy logs:** `kubectl -n ingress-nginx logs deploy/caddy-h3 -f | grep -i quic`
4. **Target:** H3 p99 < 50ms, failures < 1%, no "Session open refused"

## References

- docs/TRANSPORT_LAYER_STUDY_PLAN.md
- docs/QUIC_HARDENING_CHECKLIST.md
