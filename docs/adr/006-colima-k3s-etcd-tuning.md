# ADR-006: Colima k3s / etcd Tuning Applied via Script

**Status:** Accepted  
**Date:** 2026-02-08  
**Context:** Preflight and reissue hit connection reset and "apiserver not ready" when many API writes run in a burst. Colima k3s is single-node; default kube-apiserver and etcd limits are conservative and can be exceeded during reissue step 2 (multiple secret creates/patches) and subsequent applies/scale.

## Decision

We **apply explicit k3s and etcd tuning** on Colima to reduce API stalls and connection resets:

1. **Apply via script**  
   **scripts/apply-k3s-etcd-tuning.sh** writes a drop-in config at `/etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml` in the Colima VM and restarts k3s. The script is the single way to apply these values on an existing Colima profile.

2. **Values applied (do not exceed)**  
   - **kube-apiserver:** max-requests-inflight=800, max-mutating-requests-inflight=400, default-watch-cache-size=200.  
   - **etcd:** quota-backend-bytes=8589934592 (8 GiB), max-request-bytes=1572864, snapshot-count=50000.  
   Rationale: more headroom than k3s defaults for burst writes; larger etcd quota to avoid space alarms; safe for single-node. See **docs/COLIMA_K3S_TUNING.md**.

3. **When to run**  
   Once per Colima profile after start (or after a fresh teardown+start). Re-run after creating a new Colima profile if tuning is desired.

4. **No tuning beyond this**  
   We do not increase these values further for Colima single-node; aggressive values can increase memory use or latency without benefit.

## Consequences

- API server and etcd can absorb more concurrent and burst writes, reducing "connection reset by peer" and 503 during reissue and preflight.
- k3s restarts when the script runs; API is unavailable for ~30–60s. Preflight and other consumers should wait for API ready (script waits up to 90s).
- Tuning is optional but recommended; preflight and reissue are more reliable with it. Without tuning, rate-limiting (ADR-005, REISSUE_STEP2_SLEEP, recovery pass) still reduces but does not eliminate failures.

## References

- **docs/COLIMA_K3S_TUNING.md** — Values, Option A (script) and Option B (Colima config for new profile).
- **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md** — Section 2.2 k3s API & etcd tuning.
- **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** — Root cause and mitigations (tuning listed).
- **ADR-005** — Control plane is rate-limited; tuning supports that model.
