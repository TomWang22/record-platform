# Transport-Layer Study Plan

After QUIC tuning (sysctls, Caddy resources, k6 VU headroom), these experiments yield a full transport-layer study.

## Where This Fits

- **Rotation suite** = test **5/9** in `run-all-test-suites.sh`; invokes `scripts/rotation-suite.sh`
- **Preflight** → `run-preflight-scale-and-all-suites.sh` → step 7 runs `run-all-test-suites.sh` (all 9 suites)
- Wire capture, protocol verification, and k6 chaos already run inside rotation-suite; transport experiments extend that

## Running It

**Default from preflight:** Step 7 exports `ROTATION_H2_KEYLOG=1` and `ROTATE_CA=1`; rotation suite uses them.

**Transport experiments:** Always on. Preflight runs transport study after suites (no skip option):
```bash
./scripts/run-preflight-scale-and-all-suites.sh
```
Run experiments only (standalone): `TRANSPORT_STUDY_EXPERIMENTS=1,3 ./scripts/run-transport-study-experiments.sh`

## Prerequisites

- **UDP buffers + BBR** applied in Colima VM (Step 8 plan): preflight 7a runs `./scripts/colima-quic-sysctl.sh` automatically, or run manually before rotation.
- Caddy resources bumped (2 CPU, 1Gi)
- k6 maxVUs increased (H2: 1000, H3: 1000)
- `ROTATION_UDP_STATS=1` (Colima default) for Experiment 1 UDP drop comparison

## Experiments

### 1. Capture UDP Packet Loss % and Receive Errors (automated)

**Goal:** Measure actual UDP loss during load; correlate with QUIC stalls.

**How:**
- Rotation suite captures wire (tcpdump) and, when `ROTATION_UDP_STATS=1`, runs `netstat -su` pre/post k6 in Colima VM.
- Transport study Experiment 1 parses `colima-vm-netstat-{pre,post}.txt` and diffs **packet receive errors**.
- If delta &gt; 0 → likely UDP queue overflow; increase buffers via `colima-quic-sysctl.sh`.

**Output:** UDP 443 packet count; pre/post packet receive errors delta. Files: `$WIRE_CAPTURE_DIR/colima-vm-netstat-{pre,post}.txt`

---

### 2. Compare QUIC Congestion Window Growth

**Goal:** See how QUIC’s congestion control behaves under load.

**How:**
- Requires SSLKEYLOGFILE + quic-go debug or qlog export
- Caddy/quic-go may expose qlog; check Caddy docs for QUIC tracing
- Alternative: infer from latency/RTT patterns (no decryption)

**Output:** CWnd vs time (or inferred throughput curve).

---

### 3. Compare BBR vs CUBIC for HTTP/2

**Goal:** TCP congestion control impact on H2 under load.

**How:**
- BBR is applied in preflight 7a (`colima-quic-sysctl.sh`). Experiment 3 reports current congestion control.
- For CUBIC baseline: `COLIMA_QUIC_SKIP_BBR=1 ./scripts/colima-quic-sysctl.sh` (reverts to cubic), then `H3_RATE=0 ./scripts/rotation-suite.sh` (H2-only). Compare throughput/p99 with BBR run.
- Optional: `TRANSPORT_STUDY_RUN_H2_BBR=1` runs an H2-only rotation after reporting BBR status.

**Note:** Colima/Lima VM may not have BBR; check with `sysctl net.ipv4.tcp_available_congestion_control`.

**Output:** BBR status; throughput and latency comparison (manual CUBIC vs BBR runs).

---

### 4. Disable MetalLB and Test NodePort Directly

**Goal:** Remove MetalLB from the path; isolate LB vs direct-node behavior.

**How:**
- Scale MetalLB controller to 0 (or disable)
- Use NodePort for Caddy (if not already)
- Point k6 at node IP:port instead of MetalLB IP
- Compare: latency, drops, “reached N active VUs” behavior

**Output:** MetalLB vs NodePort latency/throughput comparison.

---

### 5. Run Caddy Outside VM and Compare

**Goal:** Quantify Colima VM overhead for QUIC.

**How:**
- Run Caddy natively on macOS (or in Docker Desktop with host networking)
- Same Caddyfile, same certs
- k6 from host → local Caddy (no Colima)
- Compare: req/s at 0% failure, p99, drops

**Output:** Colima-in-VM vs native Caddy throughput/latency.

---

## Suggested Order

1. **UDP loss %** – Quick win; automated in Experiment 1.
2. **Apply sysctls** – `colima-quic-sysctl.sh` (preflight 7a); see `docs/QUIC_HARDENING_CHECKLIST.md`.
3. **MetalLB vs NodePort** – Experiment 4; simplifies path.
4. **Caddy outside VM** – Experiment 5; “ideal” ceiling.
5. **BBR vs CUBIC** – Experiment 3; BBR applied in 7a.
6. **k6 in-cluster** – Experiment 6; best transport isolation.
7. **QUIC CWnd** – Experiment 2; needs qlog.
