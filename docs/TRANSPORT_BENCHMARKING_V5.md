# Transport Benchmarking V5

Deterministic transport benchmarking: structured `transport-summary.json`, H2 vs H3 comparison, and automatic H3 ramp-to-failure.

## 1. transport-summary.json (per run)

After each k6 run (H2 or H3), the chaos script writes **transport-summary.json** in the current working directory:

```json
{
  "protocol": "h3",
  "vus": 20,
  "iterations": 97207,
  "rps": 1046.17,
  "error_rate": 0.0002,
  "timeout_rate": 0.0002,
  "latency_ms": {
    "avg": 10.83,
    "p90": 11,
    "p95": 18,
    "max": 30033
  }
}
```

- **H3-only run:** `H2_RATE=0 STRICT_H3=1` (protocol = `"h3"`, metrics from `h3_latency`, `h3_strict_fail`, `h3_timeout`).
- **H2 run:** run with H2 only (no xk6-http3 or H2_RATE>0 and no STRICT_H3); protocol = `"h2"`.

## 2. H2 vs H3 comparison

1. Run H2-only, then copy the summary:  
   `cp transport-summary.json h2-summary.json`
2. Run H3-only, then copy:  
   `cp transport-summary.json h3-summary.json`
3. Compare:

```bash
python3 scripts/lib/compare-transport.py h2-summary.json h3-summary.json
```

Output (example):

```json
{
  "rps_delta_pct": -4.1,
  "p95_delta_ms": 2.3,
  "error_rate_delta": 0.00018
}
```

Or with default filenames in the current directory:

```bash
python3 scripts/lib/compare-transport.py
```

## 3. H3 ramp until break

Ramp H3 VUs (10 → 200 by default) and stop when a break threshold is hit:

- **error_rate** > 1%
- **timeout_rate** > 1%
- **p95** > 5× **avg** (latency blow-up)

```bash
./scripts/run-h3-ramp.sh
```

Options:

- `--start N`  Start VUs (default 10)
- `--step N`   Step (default 10)
- `--max N`    Max VUs (default 200)

Requires:

- `.k6-build/bin/k6-http3` (build with `./scripts/build-k6-http3.sh`)
- `K6_LB_IP` set if running from host against MetalLB

When the ramp breaks, the script writes **h3-capacity-report.json**:

```json
{
  "h3_max_vus": 120,
  "h3_max_rps": 6100,
  "break_at_vus": 130,
  "failure_threshold": "error_rate_or_timeout_or_p95",
  "p95_at_last_ok_ms": 220
}
```

## 4. Breakpoint evaluator (standalone)

Check whether a single run is within limits:

```bash
python3 scripts/lib/evaluate-breakpoint.py transport-summary.json
# exit 0 = healthy, exit 1 = broke
```

## 5. Optional: host vs in-cluster

Run the same ramp:

- **Host → LB IP:** `K6_LB_IP=192.168.64.240 ./scripts/run-h3-ramp.sh`
- **In-cluster:** run k6 as a job targeting ClusterIP (no `K6_LB_IP`)

Compare capacity reports to see whether NAT (host path) or Caddy/kernel (in-cluster) is the limiter.

---

## 6. Transport Validation Engine (8-layer)

Full transport characterization: knee detection, pcap validation, bottleneck classification, and comparison modes.

### Run full validation (ramp + knee + report)

```bash
./scripts/run-transport-validation.sh
```

**Env:** The script exports **K6_LB_IP** (default 192.168.64.240), **H2_RATE=0**, **STRICT_H3=1** at the start, so the health gate and k6 use the same values as the manual command. You do not need to set them yourself unless overriding (e.g. `K6_LB_IP=192.168.5.240 ./scripts/run-transport-validation.sh`).

Options:

- `--warmup` — run 10 VUs for 20s and discard before ramp (Layer 8).
- `--pcap PATH` — run transport_validator.py on pcap after ramp (Layer 1+2+6; requires tshark).
- `--bbr-vs-cubic` — run ramp with BBR, then with CUBIC (Colima sysctl), and write `transport_comparison_input.json` with `bbr_vs_cubic_delta_percent`.
- `--start N`, `--step N`, `--max N` — passed through to run-h3-ramp.sh.

Output (in `TRANSPORT_VALIDATION_OUT` or repo root):

- **ramp_steps.json** — per-step rps/latency (from run-h3-ramp.sh --collect-steps).
- **knee_result.json** — knee detection (2 consecutive &lt;3% gain + &gt;20% p95 acceleration).
- **transport_validation.json** — pcap validation (QUIC version, ALPN, no HTTP/2, TLS 1.3, retry ratio, stream frames); only when `--pcap` is set.
- **bottleneck_result.json** — classification: `cpu` | `crypto` | `transport` | `no_quic_listener`; and `transport_state`: `saturated` | `no_quic_listener`.
- **transport_ceiling_report.json** — unified report: `h3_max_rps`, `knee_vus`, `knee_rps`, `p95_at_knee`, `congestion_bound`, `transport_validated`, `bbr_vs_cubic_delta_percent`, etc.

- **bottleneck_result.json** — classification: `cpu` | `crypto` | `transport` | `no_quic_listener`, and `transport_state`: `saturated` | `no_quic_listener`.
- **transport_ceiling_report.json** — unified report: `h3_max_rps`, `knee_vus`, `knee_rps`, `p95_at_knee`, `congestion_bound`, **`transport_state`** (no_quic_listener = dead infra, not saturation), `transport_validated`, `bbr_vs_cubic_delta_percent`, etc.

### Pre-ramp health gate (stability hardening)

Before every ramp, **run-h3-ramp.sh** and **run-transport-validation.sh** run a health gate (unless `SKIP_HEALTH_GATE=1`):

1. **Nodes Ready** — `kubectl get nodes`; fail if any node not Ready.
2. **Caddy Running** — at least one `caddy-h3` pod Running in `ingress-nginx`.
3. **Service on 443** — at least one svc exposing 443 (LoadBalancer or NodePort).
4. **Active QUIC probe** — `curl --http3-only -k https://<K6_LB_IP>/_caddy/healthz` returns 200.

If the gate fails, the ramp is aborted so you don’t burn 15 minutes on dead infra (e.g. k3s stopped but MetalLB still holds the IP → UDP 443 blackholed, every request hits 10s timeout).

**Run the gate standalone:** It uses the same **K6_LB_IP** default (192.168.64.240) and exports it. Override if needed: `K6_LB_IP=192.168.5.240 ./scripts/pre-ramp-health-gate.sh`

```bash
./scripts/pre-ramp-health-gate.sh
# QUIC_PROBE_URL=https://192.168.64.240/_caddy/healthz  # default from K6_LB_IP
# SKIP_QUIC_PROBE=1   # skip curl when no HTTP/3 curl
# SKIP_HEALTH_GATE=1  # skip gate when running ramp/validation
# QUIC_PROBE_REPEAT=10  # require 10 consecutive 200s (UDP stability check)
```

**Run gate once, not twice:** `run-transport-validation.sh` runs the health gate once at the start, then calls `run-h3-ramp.sh` with **SKIP_HEALTH_GATE=1** so the ramp script does *not* run the gate again. Running the gate twice in quick succession can trigger UDP churn (Colima NAT/conntrack) and cause the second probe to fail intermittently even when QUIC is fine.

**UDP stability (intermittent QUIC):** When the gate passes standalone but fails inside the validation script, or passes then fails on the next run, the cause is often **UDP path instability** (Colima VM NAT, connection tracking), not k3s or Caddy. QUIC is UDP; NAT must track UDP “connections”; under burst or fast retries conntrack can fill and new flows drop. To require a stable QUIC path before ramp, **run-transport-validation.sh** sets **QUIC_PROBE_REPEAT=10** by default (10 consecutive 200s); use `QUIC_PROBE_REPEAT=1` for a single probe. To inspect conntrack in the Colima VM: `colima ssh` then `sudo sysctl net.netfilter.nf_conntrack_count` and `sudo sysctl net.netfilter.nf_conntrack_max` — if count ≈ max, conntrack is saturated. If count ≪ max and QUIC is still flaky, try run k6 in-cluster, NodePort bypass, or restart Colima without running colima-quic-sysctl then gate + ramp. Optional: `sudo modprobe nf_conntrack` and `sudo sysctl -w net.netfilter.nf_conntrack_max=262144` (do not lower an already higher max). Alternatives: run k6 in-cluster (removes host/Colima NAT from path) or test NodePort directly to bypass MetalLB.

### Run k6 in-cluster (isolate UDP path)

To prove whether UDP instability is **outside** Kubernetes (host/Colima NAT) or inside (Caddy/k3s), run k6 as a **Job inside the cluster**. That removes macOS NAT, Colima VM NAT, and MetalLB from the path; traffic is pod → Caddy ClusterIP.

1. **Build the image:**  
   `docker build -f docker/k6-http3/Dockerfile -t k6-http3:dev .`

2. **Load into cluster (Colima/k3s):**  
   `docker save k6-http3:dev | colima ssh -- docker load`  
   (Or push to your registry and set the image in `infra/k8s/k6-incluster/job.yaml`.)

3. **Run one shot:**  
   `./scripts/run-k6-in-cluster.sh`  
   Output: **transport-summary-incluster.json** (and logs). Override: `H3_VUS=20 DURATION=60s ./scripts/run-k6-in-cluster.sh`.

**Interpretation:** If in-cluster run has **non-zero rps** and **no timeouts** while host-side gate/ramp is flaky, the instability is **outside** Kubernetes (virtualization/NAT). If in-cluster is also flaky, the issue is inside the cluster (Caddy, k3s, or cluster networking).

### “Cluster dead” vs “crypto bound”

When k3s or the ingress controller is down but MetalLB still advertises the LB IP, the client connects to something (TCP/UDP reachable) but **no process accepts QUIC**. Result:

- ~10,000 ms latency (timeout wall)
- iterations ≈ VUs / 10, throughput = 0
- ALPN unknown, QUIC version null, strict_fail = 100%

The classifier now treats this as **`transport_state: "no_quic_listener"`** (and **`congestion_bound: "no_quic_listener"`**), not “crypto”. Condition: **max_rps &lt; 1** and **p95 ≥ 8000 ms**. That means “dead infra, no server answering QUIC”, not saturation. The harness correctly refuses to report a ceiling in that case.

**Before re-running ramp after a restart:** Confirm ingress pod Running, UDP 443 exposed, then run a single-VU manual check (same env the scripts use: H2_RATE=0, STRICT_H3=1, K6_LB_IP):

```bash
H2_RATE=0 STRICT_H3=1 K6_LB_IP=192.168.64.240 H3_VUS=1 .k6-build/bin/k6-http3 run scripts/k6-chaos-test.js
```

Or run the health gate then the validation script; they export the same env internally. Expect: `h3_timeout ≈ 0`, `h3_strict_fail ≈ 0`, non-zero throughput, latency &lt; 50 ms. If that passes, run the ramp again.

### Knee detection (standalone)

```bash
python3 scripts/lib/knee_detection.py ramp_steps.json
```

### Pcap validation (standalone)

```bash
python3 scripts/lib/transport_validator.py /path/to/node-capture.pcap
# exit 0 = valid, exit 1 = invalid (no QUIC, HTTP/2 present, etc.)
```

### Bottleneck classification (standalone)

```bash
python3 scripts/lib/bottleneck_classifier.py ramp_steps.json [transport_validation.json]
```

### Build ceiling report (standalone)

```bash
python3 scripts/lib/build_ceiling_report.py [output_dir]
```

Reads `ramp_steps.json`, `knee_result.json`, `transport_validation.json`, `bottleneck_result.json`, and optional `transport_comparison_input.json` from the output dir, and writes **transport_ceiling_report.json**.
