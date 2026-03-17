# Transport Validation Engine (8-Layer)

Deterministic transport characterization: TLS/ALPN validation, knee detection, bottleneck classification, and BBR vs CUBIC / MetalLB vs NodePort comparison.

## Layers

| Layer | Component | What it does |
|-------|-----------|----------------|
| **1** | TLS + ALPN + QUIC | Extract QUIC version from pcap; enforce ALPN=h3; fail if any HTTP/2 frame; TLS 1.3 only |
| **2** | UDP integrity | UDP error deltas (netstat); QUIC retry packet ratio; RTT variance (from pcap) |
| **3** | Knee detection | Smooth RPS curve; knee = 2 consecutive &lt;3% throughput gain + &gt;20% p95 latency acceleration; concurrency plateau |
| **4** | Comparative engine | BBR vs CUBIC (sysctl toggle + two ramps); MetalLB vs NodePort (manual or scripted) |
| **5** | Capture | Node-level tcpdump (Colima VM); optional in-cluster sidecar; see PACKET_CAPTURE_V2.md |
| **6** | QUIC deep validation | Handshake completion ratio; QUIC stream frames present; fail on silent HTTP/2 (http2.settings) |
| **7** | Bottleneck classifier | cpu \| crypto \| transport from RTT variance, UDP errors, retry ratio, latency shape |
| **8** | Guardrails | Warmup discard (10 VUs, 20s); single-variable comparison; optional variance check |

## Quick run

```bash
# Ramp + knee + bottleneck + report (no pcap)
./scripts/run-transport-validation.sh

# With warmup and pcap validation (requires tshark)
./scripts/run-transport-validation.sh --warmup --pcap /path/to/node-capture.pcap

# BBR vs CUBIC (two full ramps)
./scripts/run-transport-validation.sh --bbr-vs-cubic
```

## Output files

- **transport_ceiling_report.json** — `h3_max_rps`, `knee_vus`, `knee_rps`, `p95_at_knee`, `congestion_bound`, `transport_validated`, `bbr_vs_cubic_delta_percent`, etc.
- **ramp_steps.json** — per-step `vus`, `rps`, `latency_ms` (for knee and plots).
- **knee_result.json** — `knee` (vus, rps, p95_at_knee_ms), `max_rps`, `concurrency_plateau_at_index`.
- **transport_validation.json** — pcap validation result (valid, quic_version, alpn_h3, http2_frames, tls13_only, quic_retry_ratio, handshake_complete_ratio, quic_stream_frames).
- **bottleneck_result.json** — `bottleneck_class`: `cpu` | `crypto` | `transport`.

## Scripts

| Script | Purpose |
|--------|---------|
| `run-transport-validation.sh` | Orchestrator: ramp (--collect-steps), knee, validator (if --pcap), classifier, report |
| `run-h3-ramp.sh --collect-steps` | Ramp H3 VUs and write ramp_steps.json |
| `scripts/lib/knee_detection.py` | Knee + concurrency plateau from ramp_steps.json |
| `scripts/lib/transport_validator.py` | Pcap validation (tshark): QUIC, ALPN, no HTTP/2, TLS 1.3, retry, streams |
| `scripts/lib/bottleneck_classifier.py` | Classify bottleneck from ramp + validation |
| `scripts/lib/build_ceiling_report.py` | Build transport_ceiling_report.json from all artifacts |

## See also

- **docs/TRANSPORT_BENCHMARKING_V5.md** — transport-summary.json, H2 vs H3 comparison, ramp, breakpoint.
- **docs/TRANSPORT_HARDENING_V4.md** — strict H3, node-only capture, QUIC/ALPN guards.
- **docs/PACKET_CAPTURE_V2.md** — 3-layer capture and transport-summary from pcap.
