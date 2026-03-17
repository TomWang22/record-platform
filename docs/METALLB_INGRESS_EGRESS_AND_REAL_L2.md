# MetalLB: Ingress, Egress, and Real L2 (k3d vs Colima)

This doc explains how **ingress** (host → cluster) and **egress** (cluster → LB IP / external) work with MetalLB, and when to use **k3d** vs **Colima k3s** for real L2 (ARP, asymmetric routing, BGP).

## Cluster roles

| Cluster | Role | MetalLB / L2 |
|--------|------|---------------|
| **k3d** | **System under test** — preflight, suites, load, pgbench. Default for the pipeline. | MetalLB works; **ingress/egress configured in step 3c1b**: host → LB IP via **loopback alias + socat** (`setup-lb-ip-host-access.sh`); pods → Caddy via **cluster DNS**. L2/ARP/BGP are **simulated** (host not on pod L2). |
| **Colima k3s** | **Real L2 verification only** — optional step 3c1c when you need real ARP, asymmetric routing, BGP. | **Ingress/egress configured in step 3c1c**: `ensure-colima-metallb-for-l2.sh` installs MetalLB + pool + L2 + Caddy LoadBalancer on Colima so real tests have an LB IP; host → LB IP (real L2 when host and VM share a network). **Real ARP**, dual-path curl, BGP session meaningful. |

So: **k3d = system**; **Colima = real L2** when you need it. Preflight and suites stay on k3d; only step 3c1c runs on Colima when `METALLB_VERIFY_COLIMA_L2=1`.

See **ADR 010** (`docs/adr/010-metallb-l2-verification-isolated-to-colima.md`) for the decision.

---

## Ingress (host → cluster)

### k3d

- **LB IP** (e.g. `192.168.106.241`) is inside the Docker network; the host cannot route to it directly.
- **Setup:** Run once (or let MetalLB verification run it):
  ```bash
  LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh
  ```
  This adds a **loopback alias** for the LB IP and **socat** forwarders (TCP 443 + UDP 443 → NodePort 30443). Then HTTP/1.1, HTTP/2, and HTTP/3 work from the host via the LB IP.
- **NodePort:** `https://127.0.0.1:30443` works without the above (k3d publishes the NodePort).
- Details: **docs/K3D_METALLB_INGRESS_EGRESS.md**.

### Colima k3s

- The Colima VM has real interfaces. If the MetalLB pool is on a network the host can reach (e.g. bridge), the **LB IP is natively reachable** from the host — no loopback alias or socat required for real L2 tests.
- Ingress to Caddy: use LB IP or NodePort as appropriate for your Colima networking.

---

## Egress (cluster → LB IP / external)

### k3d

- **Pods** often have **no route** to the MetalLB pool (192.168.106.x); the pod network (10.42.x.x) is separate from the Docker bridge the LB IP lives on.
- **In-cluster traffic to Caddy:** use **cluster DNS**: `caddy-h3.ingress-nginx.svc.cluster.local` (MetalLB verification step 4). Do **not** rely on pods reaching the LB IP.
- **In-cluster curl to LB IP** (step 4b) may fail on k3d; that is expected. Step 4b1 (hostNetwork pod from node) can still reach the LB IP when routes are added for testing.

### Colima k3s

- With real L2, pods and nodes can have routes to the MetalLB pool; in-cluster traffic to the LB IP can be tested meaningfully (asymmetric routing, multi-pool, etc.).

---

## When you need real L2 (ARP, asymmetric, BGP)

Real **ARP**, **asymmetric routing** (dual-node curl), and **BGP** behaviour require a real network: the host or nodes must be on the same L2 as the MetalLB pool, not behind a loopback alias + socat.

- **On k3d:** The host path to the LB IP is via loopback + socat, so the host is **not** on the pod L2. GARP from a pod doesn’t affect the host; asymmetric tests from nodes often show “expected on k3d” (no route to pool).
- **On Colima k3s:** With real interfaces and L2, ARP poisoning simulation, dual-path curl, and BGP (with FRR) are meaningful.

### Colima networking for L2 and HTTP/3

For **real L2 correctness** and **HTTP/3** (QUIC) to work properly from the host to the Colima VM:

- Start Colima with **`--network-address`** so the VM gets a bridge address the host can reach.
- Use **k3s with the VM bridge network** so MetalLB L2 and NodePort UDP (QUIC) are on a network path the host can use (no Docker Desktop UDP quirks).

Example: `colima start --with-kubernetes --network-address` (and ensure k3s uses the VM bridge). Then LB IP and UDP 443 are on a real L2 segment; HTTP/3 and L2 verification behave correctly.

### How to run real L2 verification

1. **Colima must be running:**  
   `colima start --with-kubernetes`  
   (For L2/HTTP/3 correctness, use `--network-address` and VM bridge as above.)

2. **Run preflight with MetalLB and Colima L2:**  
   ```bash
   METALLB_ENABLED=1 METALLB_VERIFY_COLIMA_L2=1 REQUIRE_COLIMA=0 ./scripts/run-preflight-scale-and-all-suites.sh
   ```
   - Preflight and suites stay on **k3d**.
   - **Step 3c1b:** MetalLB verification (thorough suite) runs on **k3d**. **Ingress/egress for k3d** are configured here: host → LB IP via `setup-lb-ip-host-access.sh` (loopback + socat); pods → Caddy via cluster DNS. Advanced (ARP/asymmetric) is simulated on k3d; with `METALLB_VERIFY_COLIMA_L2=1` advanced is skipped on k3d.
   - **Step 3c1c:** Preflight switches to **Colima**, runs **ensure-colima-metallb-for-l2.sh** (MetalLB + pool + L2 + Caddy LoadBalancer so **ingress/egress for Colima** are configured and real L2 tests have an LB IP), then **verify-metallb-colima-l2-only.sh** (real ARP poisoning, asymmetric, BGP), then switches back to k3d.

3. **Standalone (no preflight):**  
   ```bash
   kubectl config use-context colima
   ./scripts/verify-metallb-colima-l2-only.sh
   ```
   Or with full basic + advanced on Colima:  
   `METALLB_VERIFY_COLIMA_FULL=1 ./scripts/verify-metallb-colima-l2-only.sh`

If Colima is not running when `METALLB_VERIFY_COLIMA_L2=1`, preflight will warn and skip step 3c1c; 3c1b on k3d still runs.

---

## Summary

| What | k3d | Colima k3s |
|------|-----|------------|
| **Ingress (host → Caddy)** | LB IP via loopback + socat; or NodePort | LB IP natively if network allows |
| **Egress (pod → Caddy)** | Use cluster DNS; LB IP from pods often not routable | LB IP can be routable (real L2) |
| **ARP / asymmetric / BGP** | Simulated (socat path; host not on pod L2) | Real L2 — use for real tests |
| **Preflight default** | Yes (system under test) | No; only step 3c1c when `METALLB_VERIFY_COLIMA_L2=1` |

**References**

- **docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md** — Root cause: why HTTP/3 fails on both LB IP and NodePort (UDP 30443); when to rebuild k3d; why Colima = real MetalLB networking.
- **docs/K3D_METALLB_INGRESS_EGRESS.md** — k3d LB IP host setup and ingress/egress.
- **docs/METALLB_ADVANCED.md** — BGP, route flaps, ARP sim, asymmetric, multi-subnet.
- **docs/adr/010-metallb-l2-verification-isolated-to-colima.md** — Why L2 verification is isolated to Colima.
