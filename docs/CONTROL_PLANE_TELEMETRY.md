# Control-plane telemetry (Colima k3s)

**Purpose:** Capture API server and etcd pressure before/during/after preflight so we can see control-plane load and correlate with resets and failures.

---

## 1. What we capture

| Source | What it shows | How |
|--------|----------------|-----|
| **kubectl get --raw /readyz?verbose=1** | API server readiness (per check) | Always available |
| **kubectl get --raw /healthz** | API server liveness | Always available |
| **kubectl top nodes** | Node CPU/memory | Needs metrics-server (often present in k3s) |
| **kubectl top pods -A** | Pod CPU/memory | Same |
| **kubectl get --raw /metrics** | Full Prometheus metrics (apiserver, etcd, etc.) | On many Colima/k3s setups this is **already exposed**; if not, enable k3s **supervisor-metrics** (see below) |

---

## 2. Key metrics (when /metrics is enabled)

- **apiserver_current_inflight_requests** — Current in-flight requests (read vs mutating). High or at limit → pressure; correlates with connection resets.
- **apiserver_request_duration_seconds** — Request latency by verb/resource. Spikes during reissue step 2.
- **etcd_*** — etcd disk, latency, etc. (k3s embeds etcd; metrics come from same endpoint when supervisor-metrics is on.)

---

## 3. Enabling full metrics in k3s (supervisor-metrics)

K3s exposes `/metrics` on port 6443 only when started with **supervisor-metrics: true**.

**Colima:** Add to k3s config in the VM so the k3s process gets this flag.

1. In the Colima VM, create or edit the k3s drop-in, e.g.:
   ```bash
   colima ssh -- bash -c 'sudo mkdir -p /etc/rancher/k3s/config.yaml.d'
   # Add a drop-in that enables supervisor-metrics (check k3s docs for exact key)
   # Example (k3s 1.28+): supervisor-metrics might be under a different key; see https://docs.k3s.io/reference/metrics
   ```
2. K3s docs say: "When K3s is started with supervisor-metrics: true". So the k3s server flag is `--supervisor-metrics` or similar. Check:
   ```bash
   colima ssh -- k3s --help 2>&1 | grep -i metric
   ```
3. Restart k3s after changing config:
   ```bash
   colima ssh -- sudo systemctl restart k3s
   ```
4. After ~60s, try:
   ```bash
   kubectl get --raw /metrics
   ```

If you don’t enable supervisor-metrics, the script **capture-control-plane-telemetry.sh** still records readyz, healthz, and **kubectl top** (when metrics-server is available).

---

## 4. Script: capture-control-plane-telemetry.sh

**Single snapshot:**
```bash
./scripts/capture-control-plane-telemetry.sh --once
```

**Three snapshots 10s apart (e.g. during reissue):**
```bash
./scripts/capture-control-plane-telemetry.sh
```

**Save to file:**
```bash
./scripts/capture-control-plane-telemetry.sh --once > telemetry-$(date +%Y%m%d-%H%M%S).txt
```

**Run in parallel with preflight (separate terminal):**
```bash
# Terminal 1: start preflight
LOG="preflight-run-$(date +%Y%m%d-%H%M%S).log"
METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 RUN_FULL_LOAD=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"

# Terminal 2: capture telemetry every 15s while preflight runs (manual loop)
while true; do
  ./scripts/capture-control-plane-telemetry.sh --once >> telemetry-during-preflight.txt
  sleep 15
done
```

---

## 5. References

- **K3s metrics:** https://docs.k3s.io/reference/metrics  
- **Kubernetes component metrics:** https://kubernetes.io/docs/reference/instrumentation/metrics/  
- **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** — Why control plane is under pressure  
- **docs/CERT_LIFECYCLE_SINGLE_NODE_K3S_PLAN.md** — Reduce write amplification
