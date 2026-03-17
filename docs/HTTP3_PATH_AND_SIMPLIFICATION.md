# HTTP/3 Path Layers and Simplification (k3d + MetalLB)

**Goal:** Production-like path = **MetalLB LB IP only** for ingress and egress. Verification uses the LB IP (no NodePort fallback). We strive for HTTP/1.1, HTTP/2, and HTTP/3 via the LB IP; on k3d that requires socat (loopback alias + TCP/UDP 443 → NodePort). Docker bridge (18443) is only for tests that run inside containers (e.g. HTTP/3 curl on macOS when native QUIC to LB IP fails). If socat or Docker bridge are not needed for your path, they can be removed to simplify.

---

## 1. Current layers (host → Caddy)

| Layer | What it does | When it's used |
|-------|----------------|----------------|
| **NodePort direct** | Host → `127.0.0.1:30443` → k3d serverlb → Caddy | Default when no socat; HTTP/2 works if port 30443 is published. |
| **Loopback alias** | `ifconfig lo0 alias $LB_IP` so host can bind to MetalLB IP | Only when using **LB IP path** (run `setup-lb-ip-host-access.sh`). |
| **Socat** | Listens on LB_IP:443 (TCP + UDP), forwards to `127.0.0.1:30443` | Only when using **LB IP path**; makes `https://LB_IP` and HTTP/3 to LB_IP:443 work from host. |
| **Docker bridge** | Host socat `0.0.0.0:18443` → NodePort; containers use `host.docker.internal:18443` | When baseline/suites run **inside a container** and need to reach Caddy; adds VM↔host hop. |

**Path summary:**

- **Simplest (fewest hops):** Host → **NodePort** `127.0.0.1:30443` → k3d → Caddy.  
  - HTTP/2: works (TCP).  
  - HTTP/3: on **k3d + macOS**, host→NodePort **UDP** is often broken (Docker networking), so HTTP/3 from host can fail (e.g. connection refused).

- **MetalLB IP (production-like):** Host → **LB_IP:443** (alias) → **socat** (TCP+UDP) → `127.0.0.1:30443` → k3d → Caddy.  
  - Same final hop to NodePort; socat is an extra hop so we can use the LB IP.  
  - HTTP/2 via LB IP: works if socat TCP is running.  
  - HTTP/3 via LB IP: same host→NodePort UDP limit; can still fail on macOS.

- **In-cluster:** Pod → Caddy via cluster DNS or LB IP (no host, no NodePort).  
  - HTTP/2 and HTTP/3 both work. Use for **HTTP/3 verification** when host path fails.

---

## 2. What we target (production-like)

- **Verification and tests use the MetalLB LB IP only** — no NodePort fallback for pass/fail. If the host cannot reach the LB IP, we set up socat (on k3d) or fail hard.
- **Host → LB IP:** On k3d, host has no route to the MetalLB pool by default. Run `setup-lb-ip-host-access.sh` (loopback alias + socat TCP+UDP 443 → NodePort) so that `https://LB_IP` and HTTP/3 to LB_IP:443 work. That is the production-like path.
- **HTTP/3:** On macOS, native curl to LB IP:443 (QUIC) often works once socat is running (UDP 443 forwarded). If not, the baseline can use the Docker bridge (host.docker.internal:18443) so that HTTP/3 curl runs inside a container and reaches the same path. In-cluster HTTP/3 also verifies QUIC without the host.

## 3. What works today (k3d + macOS)

| From | To | HTTP/2 | HTTP/3 |
|------|----|--------|--------|
| Host | LB IP (with socat) | ✅ | ✅ (with socat UDP 443; or Docker bridge 18443) |
| Host | NodePort 127.0.0.1:30443 | ✅ (not used for verification) | ❌ (UDP often doesn’t reach k3d) |
| Pod | Caddy (cluster DNS / LB IP) | ✅ | ✅ |

So:

- **Verification:** Use **LB IP only** (socat on k3d). No NodePort fallback for MetalLB verification.
- **HTTP/3 from host:** Use socat UDP 443 to LB IP, or Docker bridge 18443 when tests run in a container.

---

## 4. Simplification (if you want to remove layers)

- **Socat:** Required on k3d for production-like host → LB IP. Do not remove if verification must use LB IP from the host.
- **Docker bridge (18443):** Only needed when HTTP/3 tests run inside a container (e.g. macOS and native curl QUIC to LB IP fails). If native curl to LB IP works with socat, you can avoid starting the Docker bridge listener and simplify.
- **NodePort:** Not used for MetalLB verification; kept for k3d’s internal path (socat forwards to it). No separate “NodePort-only” verification.

---

## 5. If something doesn’t work

1. **HTTP/2 to NodePort fails**  
   - Check nothing else is using 30443: `lsof -i :30443`. If SSH or another process binds it, free it or use another port.  
   - Confirm k3d publishes 30443: `docker port k3d-record-platform-serverlb` (expect 30443/tcp and 30443/udp).

2. **HTTP/2 to LB IP fails**  
   - Run: `sudo LB_IP=<Caddy EXTERNAL-IP> NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh`.  
   - Check socat: TCP and UDP PIDs in `/tmp/lb-ip-forward-*`.

3. **HTTP/3 from host fails (expected on k3d + macOS)**  
   - Use in-cluster check: `./scripts/verify-caddy-http3-in-cluster.sh`.  
   - Do **not** rely on host HTTP/3 for pass/fail on this setup.

4. **Port 30443 taken by SSH**  
   - Host TCP 30443 will go to SSH, not k3d. Free 30443 for k3d or use a different NodePort and republish in k3d.

---

## 6. References

- **Runbook:** #58 (HTTP/3 Docker bridge), #61 (GSO), #62 (HTTP/3 fallback).  
- **Docs:** `docs/K3D_METALLB_INGRESS_EGRESS.md`, `docs/RCA-HTTP3-CURL-EXIT-28.md`, `docs/HTTP3-LB-IP-FIX-CHECKLIST.md`.  
- **Scripts:** `setup-lb-ip-host-access.sh`, `verify-caddy-http3-in-cluster.sh`, `k3d-status-and-http3-debug.sh`.
