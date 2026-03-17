# HTTP/3 debug playbook

Structured, deterministic, layered isolation for HTTP/3 (QUIC) failures in k3d. **Production invariant:** all QUIC tests use **record.local** (SNI + URL); no IP, no on_demand in production. See **docs/QUIC_INVARIANT_CHECKLIST.md**. No guessing: eliminate one layer at a time.

## Objective

HTTP/3 (`curl --http3-only`) fails against localhost:443 (or LB IP / NodePort). Isolate the failure across:

1. **Docker publishing** — host port → loadbalancer container
2. **k3d loadbalancer container** — listens and forwards to server node(s)
3. **Kubernetes Service** — ClusterIP / NodePort
4. **kube-proxy** — rules to pod
5. **Pod (Caddy)** — QUIC listener on 443/UDP

## Rule

**If any node is NotReady, do NOT debug HTTP/3.** That is undefined networking state (e.g. VXLAN overlay broken, kubelet not posting status). Fix node readiness first.

## Phases (script: `scripts/http3-debug-playbook.sh`)

| Phase | What | Pass condition |
|-------|------|----------------|
| **0** | Hard reset | Cluster deleted, k3d containers pruned, Docker network prune. **Then restart Docker Desktop** and re-run from phase 1. |
| **1** | Minimal cluster | `k3d cluster create` with **no MetalLB**, **no socat**, **no loopback alias**. Ports: `443:443@loadbalancer` and `443:443/udp@loadbalancer`. All nodes Ready. |
| **2** | Minimal Caddy | Single replica, explicit `servers { protocols h1 h2 h3 }`, `:443 { tls internal; respond "ok" }`. Pod Running and Ready. |
| **3** | LB container binding | Inside loadbalancer: `ss -ulnp \| grep 443` → UDP 443 listening. |
| **4** | In-cluster QUIC | `kubectl run` a pod that curls `https://caddy-h3.ingress-nginx.svc.cluster.local` with `--http3-only`. **If this fails → Caddy QUIC not working.** |
| **5** | Host → localhost:443 | From host: `curl --http3-only -k https://localhost/`. If Phase 4 succeeded but 5 fails → break is Docker → loadbalancer. |
| **6** | Docker UDP publish | `docker ps` shows `0.0.0.0:443->443/udp` (or similar) for serverlb. |
| **7** | Packet capture | `tcpdump` on host (lo0) and inside serverlb. Packets hit host but not LB → Docker NAT. Packets in LB but no response → kube-proxy or Service. |

## Interpretation table

| Phase fails | Root cause |
|-------------|------------|
| 1 (nodes NotReady) | Cluster unhealthy; fix nodes before HTTP/3. |
| 4 (in-cluster curl) | Caddy QUIC misconfig or not listening (config / image / UDP not bound). |
| 4 ok, 5 fails | Docker UDP publish or k3d loadbalancer not forwarding UDP. |
| 6 (no UDP in docker ps) | Cluster not created with `443:443/udp@loadbalancer`. |
| 7: packets on host, not in LB | Docker networking (UDP not reaching container). |
| 7: packets in LB, no response | kube-proxy or Service routing to pod. |

## Usage

```bash
# Full run (phase 0 deletes cluster and exits; restart Docker, then):
SKIP_PHASE0=1 ./scripts/http3-debug-playbook.sh

# Single phase (e.g. re-run only phase 4 after fixing Caddy):
./scripts/http3-debug-playbook.sh 4

# Phase 7 with automated capture (needs sudo):
RUN_PHASE7=1 ./scripts/http3-debug-playbook.sh 7
```

## Minimal cluster create (Phase 1)

```bash
k3d cluster create record-platform \
  --agents 1 \
  --port "443:443@loadbalancer" \
  --port "443:443/udp@loadbalancer"
```

No MetalLB, no socat, no loopback alias. The loadbalancer proxies to the **same port (443)** on all **server** nodes, so the minimal Caddy deploy uses **hostPort 443** and a **nodeSelector** for the server node (`k3d-record-platform-server-0`).

## Minimal Caddy (Phase 2)

Manifests under `infra/k8s/caddy-h3-minimal-quic/`:

- **namespace.yaml** — `ingress-nginx`
- **caddyfile.yaml** — ConfigMap with minimal Caddyfile (`servers { protocols h1 h2 h3 }`, `:443 { tls internal; respond "ok" }`)
- **deploy.yaml** — Deployment (1 replica, hostPort 443 TCP+UDP, nodeSelector server-0) + ClusterIP Service

Apply with:

```bash
kubectl apply -f infra/k8s/caddy-h3-minimal-quic/
```

## Why this works

- **QUIC exposes cluster network instability; TCP hides it.** A NotReady node or broken overlay can make UDP fail while TCP still works.
- **Layered elimination:** Phase 4 proves Caddy QUIC inside the cluster. Phase 5 proves the path from host to loadbalancer. Phase 7 shows exactly where packets stop.

No hacks, no LB IP alias, no socat — pure layered isolation.

## In-cluster UDP isolation (when Phase 4 fails)

When **Phase 4 fails** (in-cluster HTTP/3 to Service returns 000) but Caddy is listening on UDP 443 and Docker publishes UDP (Phase 6 ok), the failure is **inside Kubernetes**: either Service/kube-proxy UDP or pod-to-pod UDP path.

Run:

```bash
./scripts/http3-in-cluster-udp-diagnosis.sh
```

This runs:

1. **Test 1 — Bypass Service:** curl `--http3-only -k https://<CADDY_POD_IP>/` from a pod.  
   - **200** → Service/kube-proxy UDP path is broken; pod-to-pod QUIC works.  
   - **000 / timeout** → Caddy QUIC or pod-to-pod UDP path failing (or Caddy not responding when client uses IP).

2. **Test 2 — iptables:** On the server node container, `iptables -t nat -L -n | grep 443`.  
   - Expect DNAT rules for `udp dpt:443` → `<podIP>:443`.  
   - Missing → kube-proxy did not program UDP for the Service.

3. **Test 3 — Flannel:** On the server node, `ip route`.  
   - Expect `10.42.0.0/16` via `flannel.1` or `cni0`.  
   - Missing → Flannel overlay broken.

**Interpretation:** If Test 1 fails but Test 2 and 3 look correct, the issue is often **Caddy QUIC handshake**: SNI must match the Caddy server block (e.g. **record.local**). Use `--resolve record.local:443:<ip>` and `https://record.local` in all QUIC tests. For **debug-only** isolation you can temporarily use `tls internal { on_demand }` to prove the path; then revert to explicit **record.local** and no on_demand. See **docs/QUIC_INVARIANT_CHECKLIST.md**.
