# Root Cause Analysis: HTTP/3 (QUIC) and MetalLB Networking

**Purpose:** Explain **why** HTTP/3 fails on both LB IP and NodePort when it does, and **why** “real” MetalLB networking requires Colima k3s. This is root cause, not symptom.

---

## 1. What we need

- **HTTP/3 (QUIC)** must work over **both** paths:
  1. **LB IP** (e.g. `https://192.168.106.241`) — primary, explicitly tested.
  2. **NodePort** (e.g. `https://127.0.0.1:30443`) — tested alongside, not as fallback.

- **MetalLB “real” networking:** L2/ARP, native LB IP reachability from the host (no socat), optional BGP. That setup is **Colima k3s**, not k3d.

---

## 2. Data path (k3d)

### 2.1 HTTP/3 via NodePort

```
Host (curl --http3-only)
  → 127.0.0.1:30443 UDP
  → [must be bound on host]
  → k3d serverlb container (port mapping 30443:30443/udp)
  → k3s node (server)
  → Caddy NodePort 30443 (UDP)
  → Caddy pod (QUIC)
```

**Who listens on 127.0.0.1:30443 UDP?** Only if **k3d** published the NodePort as **UDP** at cluster create. Docker binds `0.0.0.0:30443` (UDP) on the host and forwards into the serverlb container. If the cluster was created **without** `--port 30443:30443/udp@server:0`, then **nothing** on the host listens on UDP 30443 → **connection refused**.

### 2.2 HTTP/3 via LB IP (k3d)

```
Host (curl --http3-only to 192.168.106.241:443)
  → 192.168.106.241:443 UDP (loopback alias on host)
  → socat (UDP 443 → 127.0.0.1:30443)
  → 127.0.0.1:30443 UDP
  → [same as NodePort path above]
  → k3d serverlb → node → Caddy
```

So **both** paths ultimately go through **host 127.0.0.1:30443 UDP**. If that is not bound (because k3d did not publish UDP 30443), **both** fail with “connection refused”.

### 2.3 Docker Desktop for Mac: UDP port forwarding broken

Even when k3d **does** publish UDP 30443 (Docker port mapping and serverlb listening on UDP 30443 are correct), **Docker Desktop for Mac** has a known limitation: **UDP traffic between host and containers can be one-way or dropped** (see [docker/for-mac#7717](https://github.com/docker/for-mac/issues/7717)). So:

- **TCP to NodePort works** (e.g. `curl --http2` to `127.0.0.1:30443` → 200).
- **UDP to NodePort fails** (e.g. `curl --http3-only` to `127.0.0.1:30443` → connection refused or no response).

Diagnostic step 5 (NodePort HTTP/3 direct) will then show **000**; socat to LB IP also fails because it forwards to the same broken 127.0.0.1:30443 UDP path.

**Root cause in that setup:** Docker Desktop’s UDP forwarding from the Mac host to the VM/containers (or the response path back) is broken or unreliable, not k3d or socat.

**Workarounds:**

- **Option A (recommended for k3d):** Expose Caddy on **443** via the k3d loadbalancer so host hits `localhost:443` instead of NodePort. Recreate the cluster with `scripts/k3d-create-2-node-cluster.sh` (it now includes `--port 443:443@loadbalancer` and `--port 443:443/udp@loadbalancer`). Caddy deployment uses `hostPort: 443` so the server node listens on 443; the loadbalancer forwards to the same port on the server. Then test: `NGTCP2_ENABLE_GSO=0 curl --http3-only -k --resolve record.local:443:127.0.0.1 https://record.local/_caddy/healthz`. The baseline and diagnostic (step 5b) probe localhost:443 first when applicable.
- Use **Colima** (different VM/networking; run k3s with Colima and avoid Docker’s port forwarding for NodePort), or
- Run **k3d with Colima as the Docker runtime** and test if UDP works there, or
- Accept that **HTTP/3 from the Mac host** may not work with k3d + Docker Desktop; use HTTP/2 or test HTTP/3 from inside the cluster / from another machine.

---

## 3. Root cause (single point of failure)

| Symptom | Root cause |
|--------|------------|
| HTTP/3 via LB IP fails (curl exit 7, connection refused) | Host UDP 30443 not bound, **or** Docker Desktop for Mac UDP forwarding broken (see §2.3). |
| HTTP/3 via NodePort fails (curl exit 7, connection refused) | Same: host UDP 30443 not bound, **or** Docker Desktop for Mac UDP forwarding broken. |

**If `verify-k3d-30443-udp.sh` passes but NodePort HTTP/3 still returns 000:**  
Docker Desktop for Mac is likely dropping or not completing UDP to the serverlb container (§2.3). Use Colima or another runtime, or accept no HTTP/3 from the host.

**Why is UDP 30443 not bound?** (when it’s a k3d create issue)

- k3d publishes ports from the **serverlb** container to the host.
- **Default `--port` in k3d is TCP only.** So `--port 30443:30443@server:0` binds **TCP** only.
- QUIC is **UDP**. You must **also** publish UDP: `--port 30443:30443/udp@server:0`.
- If the cluster was created **before** the UDP line was added, or with a script that omitted it, the host **never** gets a UDP 30443 binding.
- **You cannot add UDP to an existing k3d port** via `k3d cluster edit --port-add` in a reliable way (serverlb replace can break the API). So the **only** fix is: **recreate the cluster** with a create script that includes both TCP and UDP 30443.

**Conclusion:**  
**Root cause = k3d cluster was not created with UDP 30443 published to the host.**  
Fix: **Recreate the cluster** with `./scripts/k3d-create-2-node-cluster.sh` (which includes both `--port 30443:30443@server:0` and `--port 30443:30443/udp@server:0`), then run `setup-lb-ip-host-access.sh` so the LB IP path works.

For **HTTP/3 works on NodePort but fails on LB IP**, the break is in the host path (alias → socat → forward). Use the deterministic checklist: [HTTP3-LB-IP-FIX-CHECKLIST.md](./HTTP3-LB-IP-FIX-CHECKLIST.md).

---

## 4. How to verify (before/after)

1. **Check k3d port bindings**  
   Run:
   ```bash
   ./scripts/verify-k3d-30443-udp.sh
   ```
   It checks whether the serverlb container has **both** TCP and UDP 30443 published. If UDP is missing, it tells you to recreate the cluster.

2. **Probe HTTP/3**  
   - NodePort: `curl --http3-only -k --connect-timeout 5 https://127.0.0.1:30443/_caddy/healthz`
   - LB IP (after setup): `curl --http3-only -k --connect-timeout 5 --resolve record.local:443:192.168.106.241 https://record.local/_caddy/healthz`  
   If both fail with connection refused, the host is not listening on UDP 30443 → recreate cluster.

3. **After recreate**  
   - Re-deploy workloads, install MetalLB, run preflight.
   - Run `LB_IP=<pool_ip> NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh` (with sudo if needed).
   - Re-run verification and baseline; both LB IP and NodePort HTTP/3 should pass with `--http3-only`.

---

## 5. Why Colima k3s = “real” MetalLB networking

On **k3d**:

- Nodes run **inside Docker**. The MetalLB “external” IP (e.g. 192.168.106.241) is only meaningful **inside** the Docker network.
- The **host** cannot route to that IP. So we **fake** it: loopback alias + socat so that traffic to the LB IP is forwarded to NodePort on the host. That is **not** real L2; it’s a redirect to the same NodePort path.

On **Colima k3s**:

- Nodes run in a **Linux VM** with **real** network interfaces.
- MetalLB can advertise the LB IP on that VM network (L2/ARP). If the host (or other VMs) is on the same L2 or has a route to that subnet, the **LB IP is natively reachable** — no loopback alias, no socat.
- So: **real L2**, real ARP, real asymmetric routing, and BGP (if you run a BGP router and peer with MetalLB) are meaningful.

**When to use Colima for networking:**

- When you want **real** MetalLB behaviour (native LB IP, L2/ARP, optional BGP).
- Preflight supports this via **step 3c1c** when `METALLB_VERIFY_COLIMA_L2=1`: it switches to Colima, runs MetalLB + real L2 verification, then switches back to k3d. See **docs/METALLB_INGRESS_EGRESS_AND_REAL_L2.md**.

**Summary**

| Environment | LB IP from host | HTTP/3 (both paths) | Real L2/ARP/BGP |
|-------------|------------------|----------------------|------------------|
| **k3d** | Via loopback + socat (setup script) | Works only if UDP 30443 published at create | Simulated |
| **Colima k3s** | Native (if network allows) | NodePort/LB IP as configured on VM | Real (use for L2 verification) |

---

## 5a. Colima: MetalLB pool must be on VM L2 (192.168.5.x)

**The smoking gun:** If the pool is `192.168.1.240-192.168.1.250` (home LAN) but the Colima VM’s bridge is **eth0 = 192.168.5.x**, the host cannot reach the LB IP. The verify script then falls back to the no-sudo forward (127.0.0.1:8443 → VM NodePort). That path is TCP+UDP socat; QUIC over it is fragile and HTTP/3 often fails. So **HTTP/3 isn’t broken — the LB IP is on the wrong subnet.**

**Why it worked before:** When the pool was `192.168.5.240-192.168.5.250`, it matched the VM’s **eth0** (192.168.5.1/24). So: Mac → 192.168.5.240 → direct L2 → speaker → Caddy. No forwarder, no UDP translation, QUIC stable.

**Why 192.168.1.x breaks it:** The VM is not on your physical LAN’s L2. MetalLB advertises 192.168.1.240, but the VM has no interface on 192.168.1.x (you see eth0=192.168.5.x, col0=192.168.64.x). ARP doesn’t resolve, traffic doesn’t reach the VM directly, and the script falls back to socat → HTTP/3 fails.

**Rule:** The advertised LB pool must be in the **same L2 broadcast domain** as the speaker (the VM’s bridge). For Colima that is **192.168.5.x** (eth0).

**Fix:**

1. Re-apply the pool on the VM subnet:  
   `./scripts/apply-metallb-pool-colima.sh`  
   (uses `METALLB_POOL=192.168.5.240-192.168.5.250` by default.)
2. If caddy-h3 still has the old EXTERNAL-IP, delete and re-apply the service:  
   `kubectl -n ingress-nginx delete svc caddy-h3`  
   then re-apply your Caddy service manifest so it gets a new IP from the pool.
3. Confirm: `kubectl -n ingress-nginx get svc caddy-h3` → EXTERNAL-IP **192.168.5.240**.
4. Add a host route if the Mac is not on 192.168.5.x:  
   `sudo route -n add 192.168.5.0/24 <colima_node_ip>`  
   (see Runbook “Host cannot reach Caddy via MetalLB LB IP”.)

**Prevention:** `install-metallb-colima.sh` now defaults to `METALLB_POOL=192.168.5.240-192.168.5.250`. The verify script warns when it sees an LB IP in 192.168.1.x on Colima and suggests the fix above.

---

## 5b. Colima: L2 + BGP together and QUIC after speaker restart (ERR_HANDSHAKE_TIMEOUT)

**Yes: both L2 and BGP are enabled at the same time** when you use the default Colima install. The flow is:

1. `install-metallb-colima.sh` applies **IPAddressPool** and **L2Advertisement** (ARP for the pool).
2. If no BGPPeer exists, it then runs **install-metallb-frr-bgp.sh**, which deploys FRR and applies **BGPPeer** + **BGPAdvertisement** for the same pool.

So the same LB IP (e.g. 192.168.5.240) is advertised **both** via L2 (ARP) **and** via BGP. That is by design for advanced verification and multi-path testing, but on **single-node Colima** it can make QUIC sensitive to churn.

**What you see**

- Verify reports “HTTP/3 verified” (step 6) when the path is stable.
- The **advanced** section then runs a **route-flap test**: it deletes the MetalLB speaker pod (`kubectl delete pod speaker-xxxx`).
- After that, manual `curl --http3-only` can fail with **`ERR_HANDSHAKE_TIMEOUT`** (ngtcp2: UDP left the host but the QUIC handshake never completed).
- HTTP/1.1 and HTTP/2 still work (TCP retries; QUIC does not in the same way).

So **QUIC breaks after speaker restart until L2/BGP converge again**. TCP hides brief instability; QUIC exposes it.

**Why**

- Speaker restart forces ARP re-announcement, BGP re-announcement, route/interface re-binding.
- QUIC is stateful over UDP; the QUIC Initial packet does not retry like TCP SYN.
- Stale ARP or a brief period where return packets use the wrong interface/MAC can cause the handshake to time out.
- With **L2 and BGP both on**, the same IP is announced over two mechanisms; convergence after a restart can take a few seconds and during that window UDP/QUIC can fail while TCP still works.

**How to confirm**

When QUIC fails with handshake timeout:

```bash
arp -a | grep 192.168.5.240
ping -c 2 192.168.5.240
arp -a | grep 192.168.5.240
```

If the MAC for 192.168.5.240 changes or the ARP entry refreshes after ping, the path was unstable. You can also run `tcpdump -ni any udp port 443` and in another terminal run the failing `curl --http3-only`; if you see outbound UDP but no response, the return path (ARP/route) was broken briefly.

**Options**

1. **Wait for convergence**  
   After the verify script (or any speaker restart), wait **15–20 seconds**, then retry:
   ```bash
   NGTCP2_ENABLE_GSO=0 /opt/homebrew/opt/curl/bin/curl --http3-only -k https://192.168.5.240/_caddy/healthz
   ```
   If it works after a short wait, the issue is convergence timing.

2. **Single-node Colima: L2-only for stable QUIC**  
   If you do not need BGP, use **only L2** so there is a single advertisement path and less churn after speaker restart:
   - Run the stable-profile script:  
     `./scripts/metallb-colima-l2-only.sh`  
     (deletes BGPAdvertisement and BGPPeer; keeps pool and L2Advertisement.)
   - Or manually:  
     `kubectl -n metallb-system delete bgpadvertisement --all`  
     `kubectl -n metallb-system delete bgppeer --all`
   - See **docs/METALLB_SINGLE_NODE_VS_BGP.md** for the two profiles (single-node stable vs BGP chaos).

3. **Keep L2 + BGP**  
   If you need BGP for multi-node or external routing, accept that QUIC may be briefly broken right after speaker (or network) churn until ARP/BGP converge. Use a short delay or retries for HTTP/3 checks after route-flap tests.

**Summary**

| Setup              | QUIC after speaker restart (single-node) |
|--------------------|-------------------------------------------|
| L2 only            | Usually stable once ARP is settled        |
| L2 + BGP           | May see ERR_HANDSHAKE_TIMEOUT until L2/BGP converge (e.g. 15–20 s) |

The infra is not fundamentally broken; QUIC is exposing transient L2/BGP convergence that TCP masks.

---

## 6. Rebuild checklist (k3d)

When HTTP/3 fails on **both** LB IP and NodePort:

1. **Verify root cause:**  
   `./scripts/verify-k3d-30443-udp.sh`  
   If it reports “UDP 30443 not published”, continue.

2. **Recreate cluster:**  
   ```bash
   k3d cluster delete record-platform   # or your CLUSTER_NAME
   ./scripts/k3d-create-2-node-cluster.sh
   ```

3. **Wait for nodes Ready:**  
   `kubectl get nodes -w`

4. **Deploy + MetalLB:**  
   - `kubectl apply -k infra/k8s/base --validate=ignore --request-timeout=180s`
   - `./scripts/install-metallb-chunked.sh`
   - Apply Caddy/MetalLB pool as in preflight.

5. **LB IP host setup (for LB IP path):**  
   ```bash
   LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh
   ```  
   (Use the actual EXTERNAL-IP from `kubectl -n ingress-nginx get svc caddy-h3`; sudo when prompted.)

6. **Re-run verification:**  
   - MetalLB verification (step 6 and 6b with `--http3-only`).
   - Baseline: both “HTTP/3 via LB IP” and “HTTP/3 via NodePort” should pass.

---

## 7. Under-the-hood diagnostic (HTTP/3 via LB IP fails, NodePort works)

When **NodePort HTTP/3 works** but **LB IP HTTP/3 fails**, use the host-level diagnostic to see what’s happening on the path:

```bash
LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/diagnose-http3-lb-ip-under-the-hood.sh
```

(Or omit `LB_IP`/`NODEPORT` to auto-detect from the cluster.)

It will:

1. **UDP forwarder and listeners** — Show whether the socat UDP process is running and what is listening on UDP 443 (lsof).
2. **Socat UDP log** — Tail of `/tmp/lb-ip-socat-udp.log` (bind errors, permission, etc.).
3. **Packet capture on loopback** — Run `tcpdump -i lo0 udp port 443` for ~12s while sending one `curl --http3-only` to the LB IP, then report how many UDP 443 packets were seen.

Interpretation:

- **No UDP 443 packets on lo0** — Traffic from curl is not reaching the host for that IP (e.g. no listener, firewall, or curl not using the LB IP).
- **Packets seen but HTTP/3 still fails** — Socat may be receiving but not forwarding; check the socat log and try running socat manually with `-d`:  
  `sudo socat -d UDP-LISTEN:443,reuseaddr,bind=$LB_IP UDP:127.0.0.1:$NODEPORT 2>&1 | tee /tmp/lb-ip-socat-udp-verbose.log`

**Socat log patterns:**

- **`Address already in use`** — Something else is bound to UDP 443 (or the LB IP). The UDP forwarder never starts. Run the diagnostic (step 4 shows who holds the port); kill that process, then run `setup-lb-ip-host-access.sh` again. The setup script now kills any existing socat on UDP 443 before starting.
- **`Connection refused`** — Socat is receiving on LB IP:443 but the forward target 127.0.0.1:30443 (UDP) is refusing: nothing is listening there (e.g. k3d did not publish UDP 30443, or Caddy is down). Fix k3d ports or Caddy, then re-run setup. **Note:** Socat exits when it hits this error, so the setup script runs the UDP forwarder in a **restart loop** (while true; do socat ...; sleep 1; done) so the listener is restarted if socat exits; the stored PID is the loop process.

MetalLB verify step 6c (when NodePort OK but LB IP fails) prints the same script invocation.

---

## 7a. Colima + host k6: `timeout: no recent network activity` under concurrency

**Symptom:** k6 HTTP/3 load test (from host) shows intermittent timeouts. Some requests succeed, others fail with:

```
timeout: no recent network activity
```

**What this is:** A Go QUIC client idle timeout (~15s default). The QUIC connection is established, but return UDP packets stall mid-flight. After the idle window elapses, the client gives up.

**Root cause:** QUIC path instability through nested virtualization:

```
macOS → Colima VM → k3s → MetalLB → Caddy pod
```

UDP state tables (conntrack/NAT) in that path are shallow. Under concurrency (e.g. 20+ VUs):

- UDP conntrack exhaustion
- UDP NAT timeout
- MTU fragmentation (QUIC large packets)

HTTP/2 is stable because TCP retransmits and tolerates packet loss. QUIC does not in the same way.

**Why some requests succeed:** A few QUIC connections complete; others stall. The ~15s timeout aligns with the Go QUIC idle timer. If you see `status 0` on “success”, the QUIC stream closed before full HTTP response — again consistent with packet loss mid-stream.

**Mitigations (in order of impact)**

| Fix | Effect |
|-----|--------|
| **Colima QUIC-safe VUs** | `rotation-suite.sh` auto-applies when Colima + `ROTATION_H2_KEYLOG=1` (k6 on host): H3 5–20 VUs, 30 req/s. Set `K6_STRESS_H3=1` to override. |
| **Higher H3 timeout** | k6-chaos-test.js uses `K6_H3_TIMEOUT=30s` (default) instead of ~15s. Reduces idle-timeout false positives when packets are delayed. |
| **Lower concurrency** | Use 5 VUs for H3 correctness validation; HTTP/2 for stress/high RPS. |
| **k6 in-cluster** | Run k6 as a pod so `k6 → Caddy ClusterIP` stays inside the cluster. Zero host NAT; QUIC stabilizes. |

**Recommended strategy**

- **Correctness:** Use HTTP/3 at low VU (e.g. 5–20) to validate protocol and rotation.
- **Stress / high RPS:** Use HTTP/2 (TCP survives NAT) or run k6 inside the cluster.

**References**

- `scripts/k6-chaos-test.js` — `K6_H3_TIMEOUT` env, H3 timeout
- `scripts/rotation-suite.sh` — Colima + host k6 QUIC-safe H3 VU limits
- `scripts/load/k6-http3-complete.js` — “5 VUs is safer” for QUIC on Colima

---

## 7b. Rotation diagnostics: UDP stats, BBR vs CUBIC, Caddy outside VM, QUIC cwnd

### 1. Capture UDP packet loss % (rotation suite)

Run the rotation suite with `ROTATION_UDP_STATS=1` to capture UDP stats before and after k6 load:

```bash
ROTATION_UDP_STATS=1 ./scripts/rotation-suite.sh
```

Artifacts in `$WIRE_CAPTURE_DIR` (e.g. `/tmp/rotation-wire-*`):

| File | Source | What to look for |
|------|--------|------------------|
| `caddy-*-snmp-{pre,post}.txt` | Caddy pod `/proc/net/snmp` | `Udp:` line — InDatagrams, InErrors, RcvbufErrors, SndbufErrors |
| `caddy-*-netstat-{pre,post}.txt` | Caddy pod `netstat -su` | packet receive errors, buffer errors, receive queue overflow |
| `caddy-*-ss-{pre,post}.txt` | Caddy pod `ss -u -a -i` | rcvbuf, wmem, drops — if drops climb during load → UDP queue pressure |
| `colima-vm-netstat-{pre,post}.txt` | Colima VM | Same as above for the VM layer |

**Manual capture inside Caddy pod:**

```bash
kubectl -n ingress-nginx exec -it deployment/caddy-h3 -- netstat -su
kubectl -n ingress-nginx exec -it deployment/caddy-h3 -- ss -u -a -i
```

If `drops` or `RcvbufErrors` climb during load → confirmed UDP queue pressure.

### 2. Compare BBR vs CUBIC (HTTP/2 only)

BBR often increases throughput and lowers p99 under VM jitter. Run inside the Colima VM:

```bash
# Check current
colima ssh -- sysctl net.ipv4.tcp_congestion_control

# Switch to BBR (persists until VM restart)
colima ssh -- sudo sysctl -w net.ipv4.tcp_congestion_control=bbr

# Re-run rotation (H2 only for clean comparison)
K6_HTTP2_ONLY=1 ./scripts/rotation-suite.sh
```

Compare throughput and p99 before/after. To revert: `sysctl -w net.ipv4.tcp_congestion_control=cubic`.

### 3. Run Caddy outside the VM (critical experiment)

Run Caddy directly on the macOS host and hit it with k6. If throughput jumps from ~314 req/s to 500+ req/s:

- **Bottleneck:** VM networking (Colima NAT, not Caddy, QUIC, TLS, or cert rotation).

**Steps:**

1. Build/run Caddy on host with same config and certs.
2. Point k6 at `https://127.0.0.1:443` or `https://record.local:443` (host Caddy).
3. Run: `K6_HTTP2_ONLY=0 K6_RESOLVE=record.local:443:127.0.0.1 ./scripts/run-k6-chaos.sh local`

If H3 throughput increases significantly on host → VM path is the constraint.

### 4. QUIC congestion window analysis (Wireshark + SSLKEYLOGFILE)

Use the pcaps from rotation (with `ROTATION_H2_KEYLOG=1` so `SSLKEYLOGFILE` is set):

1. Open `$WIRE_CAPTURE_DIR/caddy-rotation-*.pcap` in Wireshark.
2. Preferences → Protocols → TLS → (Pre)-Master-Secret log filename → point to `$ROTATION_SSLKEYLOG`.
3. Filter: `quic`.
4. Inspect QUIC connections:
   - **Initial cwnd** — how large is the first burst?
   - **Growth slope** — does cwnd grow or plateau early?
   - **Loss events** — retransmits, ACK gaps.
   - **Retransmits** — frequent retransmits → packet loss constraining cwnd.

If cwnd plateaus early and retransmits are high → packet loss is constraining QUIC throughput.

**tshark (CLI):**

```bash
tshark -r caddy-rotation-*.pcap -o tls.keylog_file:$ROTATION_SSLKEYLOG -Y quic -T fields -e quic.frame_type -e quic.ack
```

---

## 8. References

- **scripts/k3d-create-2-node-cluster.sh** — Creates cluster with TCP + UDP 30443.
- **scripts/k3d-fix-30443-or-recover.sh** — Port check and recovery options; use **RECREATE=1** to delete and recreate.
- **scripts/verify-k3d-30443-udp.sh** — Checks that UDP 30443 is published by k3d.
- **docs/K3D_METALLB_INGRESS_EGRESS.md** — k3d LB IP host setup.
- **docs/METALLB_INGRESS_EGRESS_AND_REAL_L2.md** — When and how to use Colima for real L2.
- **docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md** — Order of operations and HTTP/3 note.
- **scripts/diagnose-http3-lb-ip-under-the-hood.sh** — Host tcpdump + socat log when HTTP/3 via LB IP fails (NodePort OK).
