# k3d + MetalLB: Ingress and Egress (LB IP vs NodePort)

## Why we need this

- **MetalLB** gives LoadBalancer services an external IP (e.g. `192.168.106.241`) from a pool.
- On **k3d**, nodes run inside Docker. The LB IP is only visible inside the Docker network.
- On **macOS** (and Windows), Docker does not expose that network to the host, so the host cannot route to the LB IP directly.

So by default, **host → Caddy** works via **NodePort** (e.g. `127.0.0.1:30443`), not via the LB IP. To make **HTTP/1.1, HTTP/2, and HTTP/3 all work via the LB IP** from the host (no NodePort fallback), we use a one-time setup.

## Ingress (host → cluster)

| Path | When it works |
|------|----------------|
| **Cluster DNS** (e.g. `caddy-h3.ingress-nginx.svc.cluster.local`) | From **inside** the cluster (pods). Step 4 verifies this. |
| **LB IP** (e.g. `https://192.168.106.241`) | From host only after **LB IP host setup** (see below). |
| **NodePort** (e.g. `https://127.0.0.1:30443`) | From host when k3d port mapping publishes the NodePort. |

### Making LB IP work from the host (once)

Run (or let MetalLB verification run it for you):

```bash
LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh
```

This script:

1. Adds the LB IP as a **loopback alias** on the host (`lo0` on macOS, `lo` on Linux) so the host can bind to it.
2. Starts **socat** forwarders (TCP 443 and UDP 443) from that IP to `127.0.0.1:NODEPORT`.

Then:

- `curl https://192.168.106.241/_caddy/healthz` (HTTP/1.1, HTTP/2) works.
- HTTP/3 (QUIC) to `192.168.106.241:443` works (UDP forwarder).

**Requirements:** `socat` (`brew install socat`), and **sudo** for the alias and for binding port 443.

**To tear down later:**

```bash
# macOS
sudo kill $(cat /tmp/lb-ip-forward-192_168_106_241-tcp.pid /tmp/lb-ip-forward-192_168_106_241-udp.pid 2>/dev/null)
sudo ifconfig lo0 -alias 192.168.106.241
```

## Egress (cluster → LB IP)

From **pods**, the LB IP (192.168.106.x) is often **not routable** on k3d because the pod network (e.g. 10.42.x.x) does not have a route to the MetalLB pool. So:

- **In-cluster traffic to Caddy** should use **cluster DNS**: `caddy-h3.ingress-nginx.svc.cluster.local` (step 4).
- **In-cluster traffic to LB IP** (step 4b) may fail on k3d; that is expected. NodePort and cluster DNS are the right paths from inside the cluster.

## Summary

| Source   | Target        | Use                    |
|----------|---------------|------------------------|
| Host     | Caddy HTTPS   | LB IP (after setup) or NodePort |
| Pod      | Caddy HTTPS   | Cluster DNS (not LB IP) |
| Host     | HTTP/3 (QUIC)| LB IP (after setup) or NodePort |

After running `setup-lb-ip-host-access.sh` once, verification and test suites can use the **LB IP** for all three protocols with no NodePort fallback.

**Real L2 (ARP, asymmetric, BGP):** On k3d the host path is loopback + socat, so L2/ARP tests are simulated. For real L2 verification use Colima k3s: see **docs/METALLB_INGRESS_EGRESS_AND_REAL_L2.md** and `METALLB_VERIFY_COLIMA_L2=1`.

## svclb (Klipper LB) pods Pending

With MetalLB, Caddy’s LoadBalancer service gets an external IP from the pool. k3d also creates **svclb-caddy-h3** pods (Klipper LB) that try to bind the service’s NodePort(s) on each node. You may see:

- `svclb-caddy-h3-*` in **Pending** with: `didn't have free ports for the requested pod ports` and/or `didn't satisfy plugin(s) [NodeAffinity]`.

That usually means something is already using the NodePort (e.g. 30443) on a node, or node affinity prevents scheduling. **Traffic is still correct**: MetalLB has already assigned the LB IP to the service, and NodePort is published by kube-proxy. The svclb pods are redundant when using MetalLB. You can:

- Ignore the Pending svclb pods (recommended when MetalLB is in use), or
- Free the NodePort on the nodes if you need svclb for another reason, or
- Exclude the service from Klipper LB via annotation if your k3d version supports it (see k3d docs).

Preflight and test suites do **not** depend on svclb being Running when MetalLB is configured.
