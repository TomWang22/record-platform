# Transport Research Core v7–v9 — Cursor-Ready Engineering Spec

Stabilize capture layer, redesign knee detection for plateau-saturated QUIC systems, and add research-grade transport forensics. Clean task breakdown for implementation.

---

## Objective

- **Deterministic packet capture**: impossible to silently fail; empty pcap = hard failure.
- **Plateau-aware knee detection**: efficiency-based inflection, not cliff-only.
- **Bound classification v2**: BBR vs CUBIC, UDP loss, CPU vs network vs transport vs buffer vs scheduler.
- **QUIC loss + congestion diff + Little's Law + scheduler contention**: full transport observatory.

---

## Path Topology (Deterministic)

```
k6 (host)
  ↓
macOS network stack
  ↓
Colima NAT bridge
  ↓
Linux VM (eth0 / interface from ip route get $K6_LB_IP)
  ↓
kube-proxy (iptables DNAT)
  ↓
MetalLB LoadBalancer IP
  ↓
Caddy (H3 listener UDP 443)
  ↓
Envoy (h2c upstream)
  ↓
Service pods
```

**Capture mapping**

| Layer | Capture tool        | Validates              |
|-------|---------------------|------------------------|
| L1    | macOS tcpdump       | UDP leaves host        |
| L2    | VM tcpdump          | NAT integrity          |
| L3    | Pod sidecar (Caddy) | App-layer arrival      |

**Validation logic**

| Observation           | Diagnosis              |
|-----------------------|------------------------|
| L1 present, L2 absent | macOS→VM drop         |
| L2 present, L3 absent | kube-proxy / DNAT     |
| L3 present, no QUIC   | fallback              |
| All present, loss gaps| congestion            |
| No loss, CPU saturation | compute bound         |

---

## TASK GROUP 1 — Deterministic Packet Capture (v3)

### T1. Interface auto-detection

- **Host (macOS)**: `sudo tcpdump -D`; auto-select interface that sees traffic to `$K6_LB_IP`. Validate with `sudo tcpdump -i any -nn host $K6_LB_IP -c 10`. If 0 packets in 3s → hard fail.
- **VM (Colima)**: Inside VM run `ip route get $K6_LB_IP`, extract interface (e.g. 5th field). Validate with `sudo tcpdump -i <iface> -nn port 443 -c 10`. If 0 packets → fail.

### T2. Blocking capture orchestration

- Start capture **before** ramp.
- Stop after drain (e.g. 2–5s).
- Validate file size: empty pcap → exit 1.
- Count packets with `tcpdump -r <pcap> | wc -l` (or tshark) and log per layer.

### T3. QUIC extraction module (existing + strict)

- Extract: `quic.version`, `tls.handshake.extensions_alpn_str`, UDP/TCP packet counts.
- Fail if: no QUIC initial, ALPN ≠ h3, TCP fallback detected.
- Output shape:
  ```json
  {
    "quic_version": "0x00000001",
    "alpn": "h3",
    "udp_packets": 124221,
    "tcp_packets": 0,
    "transport_validated": true
  }
  ```

**Deliverable**: `scripts/run-transport-capture-v3.sh` — preflight → capture → ramp → stop → mandatory validation; empty pcap = hard failure.

---

## TASK GROUP 2 — Plateau-aware knee detector

### T4. Efficiency curve

- Per step: `efficiency = rps / vus`.
- Track derivative (Δefficiency / ΔVUs) if needed.

### T5. Inflection detection

- Baseline: `avg(efficiency[10..40])` or first N steps (e.g. indices 2–8).
- Knee when: `efficiency < baseline * 0.85` **and** p95 growth factor > 2× baseline p95 (e.g. p95_at_step / p95_baseline > 2).
- Alternative: knee = first step where efficiency drops ≥15% and p95 growth > 2×.

### T6. Bound classifier v2

- **Signals**:
  - BBR ≈ CUBIC → CPU bound.
  - BBR >> CUBIC → Network bound.
  - UDP loss / retries → Transport bound.
  - Tail-only spike, variance high → Buffer / scheduler bound.
- **Inputs**: ramp steps, optional validation JSON, optional BBR vs CUBIC delta (from comparison or pcap diff).
- **Output**: `congestion_bound` in { cpu, transport, network, buffer, scheduler }, optional `bound_confidence` [0–1].

**Deliverable**: `scripts/lib/knee_detection_v2.py` (or extend `knee_detection.py`) and `scripts/lib/bottleneck_classifier_v2.py` (or extend `bottleneck_classifier.py`).

---

## TASK GROUP 3 — Publishable output (ceiling report v2)

### T7. transport_ceiling_report_v2.json

Add fields:

- `efficiency_curve`: list of `{ "vus", "rps", "efficiency" }` per step.
- `plateau_detected`: boolean.
- `transport_validated`: boolean (from pcap validation).
- `bound_confidence`: float 0–1 (when classifier v2 is used).
- `littles_law`: `{ "lambda_rps", "avg_latency_sec", "inflight_concurrency_estimate", "concurrency_utilization_percent" }`.
- `scheduler_contention`: `{ "latency_variance", "coefficient_of_variation", "scheduler_contention_detected" }` (optional).

**Deliverable**: extend `scripts/lib/build_ceiling_report.py` to emit v2 shape; keep backward compatibility.

---

## MODULE A — QUIC loss analyzer

- **Extract**: packet numbers via `tshark -r capture.pcap -Y quic -T fields -e quic.packet_number` (and frame.time_epoch, quic.packet_type).
- **Gap detection**: sort packet numbers; for each consecutive pair, if `packet_numbers[i] - packet_numbers[i-1] > 1` then gap size = difference - 1; sum lost packets.
- **Burst loss**: consecutive gaps in same RTT window (e.g. same 10ms bucket) → burst_loss_detected.
- **Reordering**: packet_number decreases in stream → reordering_detected.
- **Output**:
  ```json
  {
    "total_packets": 182332,
    "gap_events": 12,
    "lost_packets_estimated": 34,
    "loss_rate_percent": 0.018,
    "reordering_detected": false,
    "burst_loss_detected": false
  }
  ```

**Deliverable**: `scripts/lib/quic_loss_analyzer.py` — input pcap path, output JSON (stdout or file).

---

## MODULE B — Congestion control diff engine (BBR vs CUBIC pcaps)

- **Input**: two pcap paths (e.g. BBR capture, CUBIC capture).
- **Extract per pcap**: avg RTT (from frame.time_delta or tshark RTT if available), loss rate (via QUIC loss analyzer), total UDP packets, burst loss events.
- **Delta**: rtt_delta_percent, loss_delta_percent.
- **Conclusion**: `cpu_bound_not_transport` | `network_bound` | `congestion_bound` from BBR vs CUBIC comparison.
- **Output**:
  ```json
  {
    "bbr": { "avg_rtt_ms": 2.1, "loss_rate_percent": 0.02, "burst_loss_events": 1 },
    "cubic": { "avg_rtt_ms": 2.4, "loss_rate_percent": 0.03, "burst_loss_events": 2 },
    "delta": { "rtt_delta_percent": -12.5, "loss_delta_percent": -33.3 },
    "conclusion": "cpu_bound_not_transport"
  }
  ```

**Deliverable**: `scripts/lib/congestion_diff_engine.py` — two pcap paths, output JSON.

---

## MODULE C — Deterministic 3-layer capture v3

- Implement T1–T3 in a single script.
- Pre-ramp: host preflight (traffic to LB IP), VM interface detection, VM preflight (port 443).
- Start host + VM capture; optional L3 (pod) if available.
- Run ramp (single k6 run at CAPTURE_VUS / CAPTURE_DURATION, or full run-h3-ramp with --collect-steps).
- Stop capture; drain; copy VM pcap to host.
- Validate: every required layer must have non-empty pcap; else exit 1.
- Log packet counts per layer (tcpdump -r ... | wc -l or equivalent).

**Deliverable**: `scripts/run-transport-capture-v3.sh` (see TASK GROUP 1).

---

## MODULE D — Plateau-aware knee detector v2

- Efficiency-based detection (T4–T5).
- Bound classification integration (T6).
- Output: knee_result.json compatible with existing report builder, plus `efficiency_curve`, `plateau_detected`.

**Deliverable**: `knee_detection_v2.py` + wiring in `run-transport-validation.sh` (optional flag to use v2).

---

## MODULE 5 (v9) — Live ramp telemetry model

- At each VU step: RPS, avg latency, p95, efficiency (RPS/VU), error_rate, timeout_rate, optional inferred loss, optional cwnd estimate.
- Real-time signals: efficiency, latency_growth = p95/avg, tail_ratio = p99/p95.
- Interpretation: efficiency dropping → saturation; tail_ratio rising → queuing; etc.
- **Output**: optional live JSON per step (for dashboard or post-run analysis). Can be implemented as extension of ramp_steps.json schema.

---

## MODULE 6 (v9) — Little's Law saturation model

- L = λ × W: λ = RPS, W = avg latency (seconds), L = in-flight concurrency estimate.
- Example: λ = 19254, W = 0.0026s → L ≈ 50.
- Concurrency utilization = L / VUs × 100%.
- **Output**: add to ceiling report: `littles_law.lambda_rps`, `avg_latency_sec`, `inflight_concurrency_estimate`, `concurrency_utilization_percent`.

---

## MODULE 7 (v9) — Scheduler contention detector

- Variance(latency_samples), coefficient_of_variation = stddev / mean.
- CV < 0.5 → stable; 0.5–1.0 → mild contention; > 1.0 → heavy scheduling contention.
- If avg stable, p95 growing, variance rising, no packet loss → scheduler contention.
- **Output**: add to ceiling report or knee result: `scheduler_contention_detected`, `coefficient_of_variation`, `latency_variance`.

---

## Implementation order (recommended)

1. **T1–T3 + Module C**: `run-transport-capture-v3.sh` (preflight, capture, validation, hard fail).
2. **T4–T6 + Module D**: `knee_detection_v2.py`, `bottleneck_classifier_v2.py`, wire into report.
3. **T7 + Modules 6–7**: extend `build_ceiling_report.py` (efficiency_curve, plateau_detected, Little's Law, scheduler_contention).
4. **Module A**: `quic_loss_analyzer.py`.
5. **Module B**: `congestion_diff_engine.py`.
6. **Module 5**: optional live telemetry schema/export.

---

## File checklist

| File | Purpose |
|------|---------|
| `scripts/run-transport-capture-v3.sh` | Deterministic capture; preflight; hard fail on empty |
| `scripts/lib/knee_detection_v2.py` | Plateau-aware knee + efficiency curve |
| `scripts/lib/bottleneck_classifier_v2.py` | Bound classifier v2 (BBR/CUBIC, loss, scheduler) |
| `scripts/lib/quic_loss_analyzer.py` | QUIC packet number gaps, loss rate, burst |
| `scripts/lib/congestion_diff_engine.py` | BBR vs CUBIC pcap diff, conclusion |
| `scripts/lib/build_ceiling_report.py` | v2 fields: efficiency_curve, plateau, Little's Law, scheduler |
| `docs/TRANSPORT_RESEARCH_V7_V9.md` | This spec |

---

## Final state

After implementation:

- Deterministic QUIC validation (no silent empty pcaps).
- Deterministic ALPN + QUIC version extraction.
- Plateau-aware knee detection and correct bottleneck classification.
- QUIC-level loss telemetry and BBR vs CUBIC pcap diff.
- Research-grade transport ceiling report with Little's Law and scheduler contention signals.
