# Colima k3s / etcd Tuning

Per **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**, the control plane is treated as rate-limited infrastructure. These tunings reduce API stalls and connection resets during burst writes (e.g. reissue step 2, many secret creates).

**Colima start script:** `./scripts/colima-start-k3s-bridged.sh` starts Colima with **12 CPU, 16 GiB RAM, 256 GiB disk** and passes the etcd/apiserver args below via `--k3s-arg` so tuning is applied from first boot. See **docs/COLIMA-K3S-METALLB-PRIMARY.md**.

## Applied values (safe for single-node Colima)

| Component | Option | Value | Rationale |
|-----------|--------|--------|-----------|
| kube-apiserver | max-requests-inflight | 800 | More headroom than default 400 for read traffic |
| kube-apiserver | max-mutating-requests-inflight | 400 | More headroom than default 200 for writes |
| kube-apiserver | default-watch-cache-size | 200 | Slightly larger watch cache |
| etcd | quota-backend-bytes | 8589934592 (8 GiB) | Avoid hitting default 2 GiB and triggering space alarms |
| etcd | max-request-bytes | 1572864 | Allow larger single requests |
| etcd | snapshot-count | 50000 | Tuning for compaction |

**Do not tune beyond this** — Colima is single-node; aggressive values can increase memory use or latency.

## How to apply

**Option A — Script (existing Colima VM)**  
From repo root:

```bash
./scripts/apply-k3s-etcd-tuning.sh
```

This writes a drop-in at `/etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml` in the Colima VM and restarts k3s. API is unavailable for ~30–60s.

**Conservative (Phase 3, single-node write budget):** To use a lower mutating limit (100 instead of 400) so the API queues writes instead of thrashing:

```bash
CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh
```

See **docs/ETCD_WRITE_BUDGET_PLAN.md** Phase 3 and **docs/COLIMA_K3S_FORENSIC_AND_TUNING.md**.

**Option B — Fresh Colima with tuning**  
If you use a Colima config file (e.g. `~/.colima/default/colima.yaml`), you can add under `kubernetes:`:

```yaml
kubernetes:
  enabled: true
  k3sArgs:
    - --kube-apiserver-arg=max-requests-inflight=800
    - --kube-apiserver-arg=max-mutating-requests-inflight=400
    - --kube-apiserver-arg=default-watch-cache-size=200
    - --etcd-arg=quota-backend-bytes=8589934592
    - --etcd-arg=max-request-bytes=1572864
    - --etcd-arg=snapshot-count=50000
```

Then start Colima with that config. VM must be created with these args; changing k3sArgs later may require a new profile.

## After tuning

- Re-establish tunnel if needed: `./scripts/colima-forward-6443.sh`
- Run preflight: `METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh`
- If failures persist, generate a failure report: `./scripts/generate-preflight-failure-report.sh < preflight-full-*.log`

## k3d multi-node (2+ nodes) — etcd / API tuning

k3d runs k3s in Docker. To reduce control-plane read/write pressure on a 2-node (or larger) k3d cluster, pass the same etcd and apiserver args when **creating** the cluster. k3d does not support editing k3s args on an existing cluster; you must create with args.

Example (create cluster with tuning):

```bash
k3d cluster create record-platform \
  --agents 2 \
  --k3s-arg "--kube-apiserver-arg=max-requests-inflight=800@server:0" \
  --k3s-arg "--kube-apiserver-arg=max-mutating-requests-inflight=400@server:0" \
  --k3s-arg "--kube-apiserver-arg=default-watch-cache-size=200@server:0" \
  --k3s-arg "--etcd-arg=quota-backend-bytes=8589934592@server:0" \
  --k3s-arg "--etcd-arg=max-request-bytes=1572864@server:0" \
  --k3s-arg "--etcd-arg=snapshot-count=50000@server:0"
```

If your cluster is already created by a script (e.g. `k3d cluster create ...` without these args), add them to that script and re-create the cluster, or accept default limits. Same values as Colima (see table above); do not exceed for stability.

## References

- **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**
- **docs/adr/005-control-plane-is-rate-limited.md**
- **docs/adr/006-colima-k3s-etcd-tuning.md** — ADR for applying this tuning via script.
- **docs/RCA-PREFLIGHT-CONTROL_PLANE-FAILURES.md** — RCA: what still breaks after tuning, MetalLB, current situation.
- **Runbook.md** item 32 (API 503 / reset-by-peer)
