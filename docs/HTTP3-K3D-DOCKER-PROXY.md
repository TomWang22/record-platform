# HTTP/3 (QUIC) and k3d: docker-proxy Root Cause

**TL;DR:** In k3d, NodePorts are exposed by **docker-proxy**. docker-proxy handles TCP fine but **does not properly support QUIC/UDP**. So HTTP/2 over NodePort works; HTTP/3 (QUIC) over the same NodePort fails (handshake timeout). The fix is to avoid NodePort for QUIC: use **hostPort 443 + loadbalancer port publish**, or run Colima k3s / Kind without k3d.

**macOS + Colima:** Host 443 often doesn’t reach the loadbalancer (Colima doesn’t forward it). Use **host 8443** (script default): `./scripts/k3d-create-record-platform-443-lb.sh` then `https://127.0.0.1:8443`. Keep MetalLB, HA, QUIC; stop binding 443 on the Mac.

---

## What You See

- `ss -ulnp | grep 30443` inside the VM shows: `0.0.0.0:30443  users:(("docker-proxy",pid=...))`
- iptables has a DNAT rule for UDP 30443 → pod, but traffic is **bound by docker-proxy first**, so it never reaches kube-proxy’s NAT
- HTTP/2 to the same host:port works; HTTP/3 (QUIC) times out or fails handshake

## Why

- **k3d** (k3s in Docker) exposes NodePorts via Docker’s **userland proxy** (docker-proxy).
- **TCP** → docker-proxy forwards it and it works.
- **UDP (QUIC)** → docker-proxy is unreliable / broken in this setup; QUIC handshake packets are not correctly forwarded → handshake timeout.

So the break is:

```
Mac → VM → docker-proxy (NodePort 30443) → ???
                ↑
         QUIC dies here
```

Not MetalLB, not Caddy, not SNI, not kube-proxy iptables — **docker-proxy** in front of NodePort UDP.

## Clean Fix: hostPort + Loadbalancer Publish (No NodePort for QUIC)

Stop using NodePort for QUIC. Expose 443 (TCP+UDP) at the **loadbalancer container** and have Caddy listen on **hostPort 443** so traffic goes:

```
Mac → loadbalancer container (published 443/tcp, 443/udp) → Caddy pod (hostPort 443)
```

No NodePort. No docker-proxy in the path for 443.

### 1. Recreate cluster with HTTPS published on the loadbalancer

By default the script uses **host port 8443** so you don't have to free 443 on the Mac. Use `K3D_HOST_HTTPS_PORT=443` to bind host 443.

```bash
./scripts/k3d-create-record-platform-443-lb.sh
# Host then uses https://127.0.0.1:8443 (or set K3D_HOST_PORT=8443 when testing).

# To bind host 443 instead:
K3D_HOST_HTTPS_PORT=443 ./scripts/k3d-create-record-platform-443-lb.sh
```

If host 127.0.0.1:443 (or 8443) is not reachable after create, run **`./scripts/diagnose-k3d-443-host.sh`** (checks who uses 443, docker port, suggests 8443 or freeing 443).

### 2. Deploy Caddy with hostPort 443 (no LoadBalancer/NodePort for 443)

- **Deploy**: `infra/k8s/caddy-h3-deploy.yaml` already has `hostPort: 443` (TCP and UDP). The loadbalancer forwards host 443 → server node 443 → Caddy (hostPort).
- **Service**: Use ClusterIP only — apply `infra/k8s/caddy-h3-service-clusterip.yaml` (not `caddy-h3-service.yaml`). Or run `CADDY_USE_HOSTPORT=1 ./scripts/rollout-caddy.sh`.
- No NodePort 30443 in the path for QUIC; no docker-proxy on that port.

### 3. Host access (Mac)

- If the loadbalancer is reachable as `localhost:443` (or a published host port), use that.
- Your existing **setup-lb-ip-host-access.sh** (loopback alias + socat 443 → something) would then forward to **that** port (e.g. host 443 or the k3d-published port), not NodePort 30443.

So: **hostPort-based Caddy + loadbalancer publish 443** makes QUIC work; **NodePort UDP in k3d** stays broken because of docker-proxy.

---

## Host 443 vs 8443: Colima + k3d on macOS

### What in-cluster HTTP/3 (QUIC) 200 proves

When **in-cluster** QUIC to Caddy returns 200, that means:

- Caddy QUIC works
- Certs work
- Anti-affinity is irrelevant to this test
- NodePort is irrelevant (traffic never used it)
- kube-proxy UDP rules exist
- Pod networking is fine

**The cluster is healthy.** The problem is not Kubernetes, Caddy, or QUIC config.

### Why host 127.0.0.1:443 is not reachable

You are running:

- **k3d** inside Docker  
- **Docker** inside Colima  
- **Colima** inside macOS  
- and trying to bind **host 443**

That’s triple-layer networking. Docker port publish (e.g. `443/tcp -> 0.0.0.0:443`) succeeds **inside the Colima VM**, but **Colima does not forward that port to the macOS host**. So:

- **Mac → 127.0.0.1:443** → nothing
- **Colima VM** → port exists inside the VM

So in-cluster works (pod → Caddy inside the cluster) but the host cannot reach the same port. This is **Colima port-forwarding behavior**, not a Kubernetes bug.

### Why 443 is painful on macOS

Port 443 is:

- Privileged
- Often used or intercepted by system services
- Sometimes reserved or filtered by VPN software
- Sometimes filtered by the macOS firewall
- More likely to be problematic when forwarded through Colima/Docker

**8443** avoids privileged-port and forwarding quirks.

### The fix: use host 8443

**Stop binding host 443.** Use host **8443** instead.

1. Delete and recreate the cluster (script default is now 8443):

   ```bash
   k3d cluster delete record-platform
   ./scripts/k3d-create-record-platform-443-lb.sh
   ```

2. Test from the Mac:

   ```bash
   curl -k -I --http2 -H 'Host: record.local' https://127.0.0.1:8443/_caddy/healthz
   curl -k -I --http3-only --resolve 'record.local:8443:127.0.0.1' https://record.local/_caddy/healthz
   ```

That removes system port 443 conflicts, macOS/Colima forwarding edge cases, VPN/firewall interference, and privileged-port binding issues. **MetalLB, HA, anti-affinity, zero-downtime, and QUIC stay unchanged.** MetalLB is inside the cluster; which host port you publish (443 vs 8443) is a separate layer. There is no architectural downgrade.

### What you’re actually fighting

The stack is:

**macOS host → Colima VM → Docker → k3d loadbalancer → node → pod (QUIC)**

That stack is not designed to behave like bare metal for UDP on privileged ports. Using 8443 on the host is the stable choice.

### Senior answer

- **Not a Kubernetes problem:** architecture, HA, cert rotation, anti-affinity, QUIC config are fine.
- **Unstable variable:** macOS privileged port forwarding in nested virtualization (Colima → Docker → k3d).
- **Do this:** Delete cluster, recreate with 8443 host port (script default), keep MetalLB, HA, anti-affinity, rolling update. Stop touching port 443 on macOS. You will be stable.

---

## Architecture That Preserves HA

**Path:** LoadBalancer container → hostPort 443 → pod directly. No NodePort. No docker-proxy in UDP path.

### Cluster creation

Use **host 8443** so macOS/Colima don’t fight over 443 (see “Host 443 vs 8443” above):

```bash
./scripts/k3d-create-record-platform-443-lb.sh
# Uses 8443:443@loadbalancer by default. From Mac: https://127.0.0.1:8443
```

Or explicitly: `--port "8443:443@loadbalancer"` and `--port "8443:443/udp@loadbalancer"`. LB container still listens on 443; host uses 8443.

### Caddy deployment

Use either **hostNetwork: true** + **dnsPolicy: ClusterFirstWithHostNet**, or **hostPort 443** (TCP and UDP) on the container ports. LB forwards directly to the pod; no NodePort, no docker-proxy.

### Anti-affinity

Keep **requiredDuringSchedulingIgnoredDuringExecution** pod anti-affinity. With 2 nodes: pod A on server, pod B on agent; LB distributes traffic.

### Zero-downtime CA + leaf rotation

- **Rolling update:** `maxUnavailable: 0`, `maxSurge: 1` — new pod starts, becomes ready, then old pod drains.
- **Readiness:** `httpGet` on `/_caddy/healthz` (port 443, scheme HTTPS). Pod not ready ⇒ not in LB pool.
- **Cert rotation:** Rotate leaf, reload/restart Caddy; rolling restart; QUIC connections may drop on that pod, other replica stays live.

## Alternative: Avoid Nested Docker for QUIC

- **Colima + k3s** directly (no k3d): no docker-proxy; NodePort is handled by kube-proxy on the VM.
- **Kind** with careful port mapping can work if UDP is correctly published.

Nested Docker networking + UDP is fragile; reducing nesting (no k3d) or avoiding NodePort for QUIC (hostPort + LB publish) is the reliable approach.

## What Not To Do

- Do not add more socat layers or UDP forwarding to “fix” QUIC through the same NodePort.
- Do not tune QUIC or assume Caddy/kube-proxy is wrong when `ss` shows **docker-proxy** on the NodePort.

## References

- **Host 443 unreachable:** `scripts/diagnose-k3d-443-host.sh` (who uses 443, docker port, use 8443).
- **Docker-proxy / NodePort:** `scripts/diagnose-http3-lb-ip-under-the-hood.sh` (step 3 + interpretation).
- **HTTP/3 test (in-cluster + host):** `scripts/test-http3-k3d-443.sh` (use `K3D_HOST_PORT=8443` when using 8443).
- RCA and LB IP: `docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md`, `scripts/setup-lb-ip-host-access.sh`.
