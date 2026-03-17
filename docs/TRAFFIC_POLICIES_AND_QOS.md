# Traffic Policies and QoS (Custom Routing)

This doc describes how traffic is coordinated across **MetalLB**, **HAProxy**, and **Caddy** today and how custom traffic policies and QoS could be added later.

## Current layout (three components)

| Component | Role | Where |
|-----------|------|--------|
| **Caddy** | Primary ingress: TLS termination, HTTP/1.1, HTTP/2, HTTP/3 (QUIC). Proxies to api-gateway and services. | `ingress-nginx` namespace, LoadBalancer or NodePort. |
| **MetalLB** | Assigns external IP to Caddy’s LoadBalancer service so the host (and tests) can reach Caddy via LB IP:443. | L2 mode; pool e.g. 192.168.64.240–192.168.64.250. |
| **HAProxy** | Optional edge: frontend :8081, backend api-gateway:4000. Health at `http://haproxy:8081/healthz`. | `record-platform` namespace. |

- **Primary path for tests:** `https://record.local:443` with `--resolve record.local:443:<LB_IP>` (MetalLB → Caddy).
- **HAProxy** is an alternative path (in-cluster only unless exposed). If api-gateway is down, HAProxy returns 503.

## Coordinated LB suite

`scripts/test-lb-coordinated.sh` (suite 9/9) checks:

1. Caddy via LB IP or NodePort (HTTP/2 and optionally HTTP/3).
2. Caddy in-cluster (curl from a pod to `caddy-h3.ingress-nginx.svc.cluster.local`); may be skipped if the pod has no curl.
3. HAProxy health (one-off pod curls `http://haproxy:8081/healthz`). Tolerant of transient 503 during api-gateway restart (e.g. rotation): suite fails only if 503 for 6+ consecutive checks (~30s). See `HAPROXY_ATTEMPTS`, `HAPROXY_INTERVAL`, `HAPROXY_CONSECUTIVE_503_FAIL` in the script.
4. MetalLB (optional): `verify-metallb-and-traffic-policy.sh` (pool, L2, LB IP, host reachability, HTTP/1.1/2/3).

So the suite verifies that **Caddy**, **HAProxy**, and **MetalLB** are consistent (Caddy and MetalLB are required for full pass; HAProxy is best-effort).

## Custom traffic policies and QoS (future)

- **Traffic policies:** Today there is no policy layer (e.g. rate-by-route, allow/deny by path). This could be added via:
  - Caddy: `route` blocks, `handle` with matchers, or Caddy modules.
  - HAProxy: ACLs, `http-request deny`, `stick-table` for rate limiting.
  - Ingress/K8s: `Ingress` annotations or a policy CRD that drives Caddy/HAProxy config.
- **QoS:** No explicit QoS (DSCP, priority queues) is configured. Options later:
  - Node/CNI: pod priority, resource limits (already in use).
  - MetalLB: no built-in QoS; L2 forwards by MAC.
  - Caddy/HAProxy: could add response headers or backend priority; true QoS usually requires CNI or node-level tuning.

When we add policy or QoS, we can extend the coordinated LB suite to assert expected behavior (e.g. HAProxy returns 429 when over rate, or a given path is denied).
