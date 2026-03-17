# Transport Hardening V4 — QUIC Validation, Capture Stability, H3 Fallback

This document describes the V4 transport hardening: **strict QUIC validation** (no silent HTTP/3 fallback), **macOS-proof capture** (node-only, ring buffer, no `kubectl exec` tcpdump), and **why H3 falls back** inside Colima so you can detect and fix it.

## Goals

1. **Prove HTTP/3 is actually used** — no silent fallback to HTTP/2.
2. **Stable packet capture** — tcpdump must not be killed by macOS (no pipe/kubectl exec for the authoritative capture).
3. **Deterministic detection** — protocol, QUIC presence, ALPN, and TLS timing from one pipeline.

---

## Part 1 — Hardened QUIC Validation Harness

### 1. Strict H3 enforcement in k6

When **`STRICT_H3=1`** is set, any H3 request that does not negotiate HTTP/3 **fails the iteration** (throw). No logging-only mismatch; no empty proto allowed.

- **`scripts/k6-chaos-test.js`**: In `h3_request()`, if `STRICT_H3=1` and `res.proto` is not `"HTTP/3"` (or status ≠ 200), the script throws. Threshold `errors: rate<0.01` is added so the run fails if fallback occurs.
- **`scripts/load/k6-http3-complete.js`**: Same logic: use actual `result.proto` from the extension; when `STRICT_H3=1`, throw if status ≠ 200 or proto is not HTTP/3.

Usage:

```bash
STRICT_H3=1 .k6-build/bin/k6-http3 run scripts/k6-chaos-test.js
# or H3-only validation:
H2_RATE=0 STRICT_H3=1 .k6-build/bin/k6-http3 run scripts/load/k6-http3-complete.js
```

If QUIC fails or the stack falls back to TCP, the test fails instead of reporting 200 with empty/wrong proto.

### 2. QUIC presence guard (packet-level)

After capture, if **`STRICT_QUIC_VALIDATION=1`**:

- **No QUIC packets** in the node pcap → harness exits 1 (`❌ STRICT_QUIC_VALIDATION: No QUIC packets in node pcap`).
- Implemented in `scripts/lib/packet-capture-v2.sh`: `tshark -r "$node_pcap" -Y quic | wc -l`; if 0, `exit 1`.

### 3. ALPN guard

With **`STRICT_QUIC_VALIDATION=1`**:

- **No `h3` ALPN** in QUIC TLS handshake → harness exits 1 (`❌ STRICT_QUIC_VALIDATION: No h3 ALPN negotiated in QUIC`).
- Implemented in `packet-capture-v2.sh` via tshark ALPN extraction and `grep -q h3`.

---

## Part 2 — Capture Redesign (macOS-proof)

### Why captures were empty

- L2/L3 capture used **`kubectl exec pod -- tcpdump ...`**. That runs tcpdump inside the pod and streams over a pipe to the host.
- On macOS, that pipe/process can be **killed (SIGKILL)** by the system (OOM or sandbox). Result: **L1/L2/L3 all empty**, "Killed: 9 tcpdump".

### New rules

1. **Node-level capture is authoritative.** Pod-level (L2/L3) is optional.
2. **Run tcpdump inside the Colima VM only** — no `kubectl exec` for the main capture:
   - `colima ssh -- sudo tcpdump -i any ... -w /tmp/node-capture-v2.pcap &`
   - No PTY, no kubectl, no host-side pipe that macOS can kill.
3. **Default node-only on Colima:** When `colima` is available, **`CAPTURE_NODE_ONLY=1`** is set by default so L2/L3 are skipped and kubectl exec tcpdump is never started.
4. **Ring buffer:** **`CAPTURE_RING_BUFFER=1`** (default) uses `-C 100 -W 5` so tcpdump rotates files and does not exhaust memory.
5. **Stop with SIGINT only:** Node capture is stopped with **`kill -INT`** and up to 10s wait. **No `kill -9`** so tcpdump can flush the pcap. If it does not exit, we copy partial pcap and continue.
6. **Health check:** After starting node tcpdump, we sleep 1s and verify the PID is still alive; if not, we log and skip.

### Env knobs

| Env | Effect |
|-----|--------|
| `CAPTURE_NODE_ONLY=1` | Only L1 (node) capture; no L2/L3 (default on Colima). |
| `CAPTURE_NODE_ONLY=0` | Restore L2/L3 (kubectl exec); use only when not on macOS or when debugging pod view. |
| `CAPTURE_RING_BUFFER=1` | Node tcpdump with `-C 100 -W 5` (default). |
| `CAPTURE_RING_BUFFER=0` | Single pcap file. |
| `STRICT_QUIC_VALIDATION=1` | After capture, exit 1 if no QUIC packets or no h3 ALPN. |

### Ring-buffer copy and merge

When ring buffer is used, the VM has `/tmp/node-capture-v2.pcap`, `.pcap1`, … After stop we copy all, then **mergecap** (if available) into `node-capture.pcap` for analysis.

---

## Part 3 — Why H3 Falls Back in Colima (Exact Explanation)

### Architecture

```
macOS (k6)
    ↓
Lima VM (Colima)
    ↓
containerd → Caddy pod
```

When k6 runs on the **macOS host**:

1. It sends UDP (QUIC) to the MetalLB IP.
2. Packets go through **host → Lima VM** NAT, then **VM → MetalLB** and into the cluster.
3. Under load, **macOS UDP NAT table** can fill; drops and retransmits increase.
4. **QUIC handshake** is more sensitive to loss than TCP; it can **time out**.
5. k6 (or the stack) **falls back to TCP** → Caddy serves **HTTP/2**.
6. You get **status 200** but **protocol blank or HTTP/2** — "H3" was not actually used.

So: **curl works** (single request, no concurrency, handshake succeeds). **k6 under load** can hit NAT exhaustion → QUIC fails → silent fallback.

### How to prove it

- **Test A — H3 only, no H2:** Disable H2 in Caddy or run k6 with `H2_RATE=0`. If k6 then fails entirely, QUIC under load is broken; if it passes, fallback was hiding the issue.
- **Test B — k6 inside cluster:** Run k6 as a pod, target Caddy via ClusterIP. If H3 scales normally, **host NAT** is the bottleneck (Experiment 6 in transport study).
- **Test C — UDP errors in VM:** Inside Colima, `netstat -su` before and after load; compare packet receive errors and drops (transport study Experiment 1).

### What to verify on the cluster

- **caddy-h3 Service** must expose **UDP 443**:
  - `kubectl -n ingress-nginx get svc caddy-h3 -o yaml`
  - You must see a port with `protocol: UDP` and `port: 443`. If UDP 443 is missing, QUIC cannot work for k6 (curl may still use a different path).
- **k6 options:** Use `http3: true` (or the xk6-http3 `http3.get`), `timeout: "5s"`, and **`--tls-sni record.local`** (or your host) so SNI matches; otherwise QUIC handshake can fail and fall back.

---

## Final Architecture After V4

```
Host k6 (STRICT_H3=1 optional)
    ↓
Colima VM capture only (authoritative, no kubectl exec)
    ↓
QUIC version extraction (tshark)
    ↓
ALPN verification (h2 / h3)
    ↓
TLS handshake timing
    ↓
transport-summary.json → baseline vs rotation diff
    ↓
STRICT_QUIC_VALIDATION=1 → fail if no QUIC or no h3 ALPN
```

You can then answer with certainty:

- Is QUIC actually negotiated?
- Is fallback happening?
- Is UDP dropping?
- Did rotation affect handshake latency or QUIC version?

---

## Quick reference

| Task | Command / Env |
|------|----------------|
| Strict H3 in chaos test | `STRICT_H3=1` with k6-http3 |
| Strict H3 in protocol script | `STRICT_H3=1` with k6-http3-complete.js |
| Node-only capture (default on Colima) | `CAPTURE_NODE_ONLY=1` (auto when colima present) |
| Enforce QUIC + h3 ALPN after capture | `STRICT_QUIC_VALIDATION=1` when calling stop_and_analyze_captures_v2 |
| Disable ring buffer | `CAPTURE_RING_BUFFER=0` |
| Verify caddy-h3 UDP 443 | `kubectl -n ingress-nginx get svc caddy-h3 -o yaml` |

See also: `docs/PACKET_CAPTURE_V2.md`, `docs/ROTATION_SUITE_ARCHITECTURE_FIX.md`.
