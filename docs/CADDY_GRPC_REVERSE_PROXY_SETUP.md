# Caddy → Envoy gRPC Reverse Proxy Setup

**Purpose:** Document the correct Caddy reverse proxy configuration for gRPC (Client → Caddy → Envoy → backends) so traffic reaches Envoy over h2c.

---

## Correct gRPC Proxy Block (Caddyfile)

```caddyfile
# gRPC: route to Envoy via h2c only. TLS terminated at Caddy; do NOT use https:// upstream for Envoy.
# CRITICAL: Explicit transport versions h2c — without it Caddy may downgrade to HTTP/1.1 and Envoy gRPC listener rejects.
@grpc path_regexp \.
handle @grpc {
  reverse_proxy envoy-test.envoy-test.svc.cluster.local:10000 {
    header_up Host {http.request.host}
    transport http {
      versions h2c
    }
  }
}
```

### Why Each Part Matters

| Directive | Purpose |
|----------|---------|
| `@grpc path_regexp \.` | Match paths containing a dot (e.g. `/grpc.health.v1.Health/Check`, `/auth.AuthService/Authenticate`) |
| `reverse_proxy ... :10000` | Envoy listens on 10000 (plaintext gRPC) |
| `transport http { versions h2c }` | **Critical.** Forces HTTP/2 cleartext to Envoy. Without it, Caddy may use HTTP/1.1 → Envoy gRPC listener rejects |
| `header_up Host {http.request.host}` | Forward original Host header (e.g. record.local) to Envoy |

---

## Traffic Flow

```
Client (grpcurl -cacert ... record.local:443)
  → TLS termination at Caddy
  → Caddy proxies over h2c to envoy-test:10000
  → Envoy routes to auth-service, records-service, etc. (mTLS)
```

- **Caddy:** TLS on 443 (record-local-tls), HTTP/3 + HTTP/2
- **Envoy:** Plaintext gRPC on 10000 (h2c), routes to backends with mTLS
- **Upstream:** `envoy-test.envoy-test.svc.cluster.local:10000` (from ingress-nginx namespace)

---

## Apply and Restart

```bash
# From repo root
kubectl -n ingress-nginx create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -
kubectl -n ingress-nginx rollout restart deploy/caddy-h3
kubectl -n ingress-nginx rollout status deploy/caddy-h3 --timeout=120s
```

Or use `./scripts/rollout-caddy.sh` (it applies ConfigMap from `./Caddyfile`).

---

## Diagnostic Commands (Copilot Recommendations)

### 1. Confirm Caddy upstream can reach Envoy (from inside cluster)

```bash
CADDY_POD=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n ingress-nginx "$CADDY_POD" -- curl -v http://envoy-test.envoy-test.svc.cluster.local:10000
```

If this fails → Caddy upstream broken (DNS, network, Envoy not listening).

### 2. Test HTTP/2 prior-knowledge (h2c) from Caddy pod

```bash
kubectl exec -n ingress-nginx "$CADDY_POD" -- curl -v --http2-prior-knowledge http://envoy-test.envoy-test.svc.cluster.local:10000
```

If this works but (1) fails → Caddy reverse_proxy needs explicit h2c transport (already in place above).

### 3. Inspect live Caddyfile

```bash
kubectl exec -n ingress-nginx "$CADDY_POD" -- cat /etc/caddy/Caddyfile
```

Look for the gRPC `handle @grpc` block and `transport http { versions h2c }`.

### 4. Critical host-side gRPC test via Caddy (LB IP)

**Always resolve LB IP dynamically** — MetalLB can reassign after Caddy rollout:

```bash
LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
[[ -z "$LB_IP" ]] && LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
grpcurl -vv -cacert certs/dev-root.pem -authority record.local --resolve record.local:443:${LB_IP} record.local:443 list
```

- If handshake succeeds but no services listed → TLS OK, Caddy reachable, but gRPC upstream routing issue.
- If handshake fails → CA/cert issue (see ROTATION_CA_DRIFT_COPILOT_REPORT.md).

### 5. Verify Envoy receives traffic (packet capture)

```bash
# Envoy pod
kubectl exec -n envoy-test <envoy-pod> -- tcpdump -i any -c 20 port 10000
```

If TCP 10000 shows 0 packets when grpcurl runs → Caddy is not forwarding gRPC to Envoy.

---

## Why Port-Forward Works but LB Fails

- **Port-forward** bypasses Caddy: `grpcurl → Envoy pod:10000` directly. mTLS works.
- **LB path** goes through Caddy: `grpcurl → Caddy:443 → Envoy:10000`. If Caddy misconfigures h2c, Envoy never sees packets.

---

## Single-Node / Colima: Rollout Stuck (Pod Pending)

If `caddy-h3` rollout times out with a pod `PodScheduled False`:

- **Cause:** The deployment uses **required** pod anti-affinity (one Caddy per node). On single-node Colima, a second pod cannot schedule.
- **Immediate fix:**
  ```bash
  kubectl -n ingress-nginx scale deployment caddy-h3 --replicas=1
  ```
  This terminates the old pod. The new pod can then schedule (no other caddy-h3 pod blocking it). Rollout completes; the new pod has the updated Caddyfile.
- **Long-term:** Use `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh` for 2 replicas on single node (uses `caddy-h3-deploy-loadbalancer.yaml` + `caddy-h3-service-loadbalancer.yaml`: soft anti-affinity, no hostPort).

---

## Related Files

| File | Purpose |
|------|---------|
| `Caddyfile` | Source of truth for Caddy config |
| `infra/k8s/caddy-h3-deploy.yaml` | Mounts ConfigMap `caddy-h3` |
| `scripts/rollout-caddy.sh` | Applies Caddyfile to ConfigMap and restarts deploy |
| `infra/k8s/base/envoy-test/` | Envoy listens on 10000, routes to gRPC backends |
| `scripts/diag-caddy-grpc-upstream.sh` | Diagnostic script (see below) |
