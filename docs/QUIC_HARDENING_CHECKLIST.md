# QUIC Hardening Checklist (Colima + k3s)

Transport-layer tuning for QUIC under nested virtualization (macOS → Colima VM → k3s → MetalLB → Caddy).

**Problem:** QUIC works but collapses under sustained concurrency—p99 ≈ 8–10s, timeouts ≈ 99%. Root cause: UDP buffer overflow, conntrack limits, receive queue overflow, CPU jitter. TCP/HTTP/2 is fine because TCP retransmits; QUIC stalls instead.

---

## 1. Apply Sysctls (Automated)

Preflight step 7a runs `./scripts/colima-quic-sysctl.sh` automatically. Or run manually before rotation:

```bash
./scripts/colima-quic-sysctl.sh
```

**What it sets:**

| Sysctl | Value | Why |
|--------|-------|-----|
| `net.core.rmem_max` | 2500000 | UDP receive buffer cap |
| `net.core.rmem_default` | 2500000 | Default receive buffer |
| `net.core.wmem_max` | 2500000 | UDP send buffer cap |
| `net.core.wmem_default` | 2500000 | Default send buffer |
| `net.core.netdev_max_backlog` | 5000 | Receive queue under burst |
| `net.netfilter.nf_conntrack_max` | 262144 | Conntrack table (UDP/QUIC sessions) |
| `net.ipv4.tcp_congestion_control` | bbr | H2 comparison baseline |

**Persist across VM restart:**
```bash
COLIMA_QUIC_PERSIST=1 ./scripts/colima-quic-sysctl.sh
```

**Check conntrack usage (inside VM):**
```bash
colima ssh -- cat /proc/sys/net/netfilter/nf_conntrack_count
```
If near `nf_conntrack_max` → packets dropped.

---

## 2. Increase VM CPU + Memory

QUIC is CPU-heavy. If Colima VM is under-provisioned:

```bash
colima stop
colima start --cpu 6 --memory 8
```

Check current: `colima status`

---

## 3. k6 H3 VU Tuning

Too many idle QUIC sessions overwhelm conntrack. Use a fixed small VU pool:

```bash
# Colima default is already conservative (5–20 VUs). After hardening, try:
H3_PRE_VUS=20 H3_MAX_VUS=50 ./scripts/rotation-suite.sh
```

Or in rotation/preflight: `export K6_H3_PRE_VUS=20 K6_H3_MAX_VUS=50`

---

## 4. MetalLB vs NodePort (Experiment 4)

Bypass MetalLB for pure transport testing:

```bash
kubectl -n kube-system scale deploy -l app=metallb --replicas=0
```

Point k6 at node IP:30443 (NodePort). If H3 stabilizes → MetalLB layer adds jitter.

---

## 5. Run k6 Inside Cluster (Best Test)

Remove macOS NAT and VM boundary:

```
k6 pod → ClusterIP → Caddy
```

If H3 suddenly scales to 200+ req/s → host virtualization is the limiter. **When host k6 shows "timeout: no recent network activity" on HTTP/3 phases**, run k6 in-cluster for true QUIC capacity. Manual setup; see `docs/TRANSPORT_LAYER_STUDY_PLAN.md` Experiment 6.

---

## 6. Caddy Idle Timeout

Caddyfile already has `idle_timeout 120s` in servers block. Prevents premature QUIC session death. 120s is more generous than 30s.

---

## Clean Engineering Path

1. Increase VM CPU + memory
2. Run `colima-quic-sysctl.sh` (or let preflight 7a do it)
3. Run H3-only test: `H3_RATE=0` or H2_RATE=0 for H3-only
4. Compare: MetalLB vs NodePort, host k6 vs in-cluster k6

---

## What “Good” Should Look Like

| Metric | Healthy QUIC | Your Current |
|--------|--------------|--------------|
| p50 | 1–3 ms | — |
| p95 | < 5 ms | — |
| p99 | < 20 ms | 8–10 s |
| timeouts | < 0.5% | ~99% |
| throughput | Close to H2 baseline | H3 collapses |

Current state = transport starvation, not app failure.
