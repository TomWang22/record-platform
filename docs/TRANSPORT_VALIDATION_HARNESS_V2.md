# Transport Validation Harness v2

Hardened harness: robust knee detection, correct Little's Law, runtime instability classifier, deterministic capture, clean report schema v2.

## 1. Robust knee detection (noise-resistant)

- **Script:** `scripts/lib/knee_detection_v3.py`
- **Rule:** Knee only when efficiency is below 60% of max for **3 consecutive steps** AND RPS does **not** recover to >30% within the **next 2 steps**.
- **Recovery guard:** If RPS recovers (e.g. next 2 steps have much higher RPS), that step is classified as **runtime instability**, not a knee.
- **Usage:** With `--v2`, validation uses v3 knee detector.

## 2. Little's Law (correct computation)

- **Formula:** λ = RPS (from best step = iterations/duration for that run), W = avg_latency_ms/1000, L = λ×W, utilization_percent = L/VUs×100.
- **Report v2:** `littles_law.lambda_rps`, `avg_latency_sec`, `inflight_concurrency`, `utilization_percent`.

## 3. Runtime instability classifier

- **Detection:** RPS drop >50% from previous step, then recovery >50% within next 2 steps, and latency spike >5× baseline p95.
- **Output:** `runtime_instability_detected: true`, `instability_steps: [70, 110]` (VUs where collapses were transient).
- **Interpretation:** Scheduler/harness noise, not structural ceiling.

## 4. Deterministic 3-layer packet capture (hard-fail)

- **Script:** `scripts/run-transport-capture-v3.sh`
- **Preflight:** Host and VM must see traffic to `K6_LB_IP`; interface from `route get` on macOS.
- **Validation:** Empty pcap → exit 1. No silent success.
- **Layers:** Host tcpdump (udp port 443), VM tcpdump (same), optional pod; then `transport_validator.py` for QUIC version, ALPN h3, no HTTP/2 in strict H3.

## 5. Clean report schema v2

- **Script:** `scripts/lib/build_ceiling_report_v2.py`
- **Structure:**
  - `transport_validation`: validated, quic_version, alpn, http2_detected
  - `performance`: h3_max_rps, knee_vus, knee_rps, p95_at_knee, plateau_detected, bound
  - `runtime_analysis`: runtime_instability_detected, instability_steps
  - `littles_law`: lambda_rps, avg_latency_sec, inflight_concurrency, utilization_percent
  - `scheduler`: coefficient_of_variation, contention_detected

## How to run

```bash
# Full validation with v2 harness (robust knee, runtime instability, report schema v2)
./scripts/run-transport-validation.sh --v2 --transport-gate

# With pcap validation (after capture)
./scripts/run-transport-validation.sh --v2 --transport-gate --pcap /path/to/node.pcap

# Deterministic capture (preflight + hard-fail on empty)
sudo ./scripts/run-transport-capture-v3.sh
```

## Expected behavior after v2

- Knee only when sustained drop (no false positive from transient stalls at e.g. 110 VUs).
- Runtime stalls reported in `instability_steps`, not as knee.
- Little's Law reflects actual λ and L (no zero from unused metrics).
- Transport validation: no silent nulls; validated=false when capture missing or invalid.
- Report is scientifically consistent for reproducibility (run 3 ramps, compare curves).
