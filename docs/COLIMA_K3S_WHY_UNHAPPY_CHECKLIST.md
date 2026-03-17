# Colima k3s: everything that can make it unhappy

**One place** for all the things that can make Colima k3s flaky, slow, or unreachable. Use this when the API is down, preflight fails, or you want to see “what else could it be?”

---

## 0. Current situation: “stuck” or API down after preflight

**What you often see:** Reissue step 2 fails with `ServiceUnavailable` on the first GET (secret), then 12 retries, then `kubectl get nodes` and `/readyz` fail (empty output or “connection reset by peer”). You run tuning (CONSERVATIVE=1), k3s restarts, the script says “API server ready after 10s”, but the next `kubectl get nodes` from the host still fails. The reclaim script seems “stuck” (it’s just `docker builder prune` taking 1–2 minutes and printing a lot of lines).

**What’s going on:**

| Observation | Likely cause |
|-------------|--------------|
| First apply fails on **GET** (retrieve current secret) | API was already overloaded or degraded before we sent the first write. |
| 12 retries all fail | Retry storm made things worse; Phase 1 abort would have stopped after 1–2 attempts. |
| “API server ready” then host kubectl fails | **Tunnel (127.0.0.1:6443)** is flaky, or API accepts one request then resets the next. So “ready” ≠ stable over the tunnel. |
| Reclaim script “stuck” | `docker builder prune -af` is slow and verbose; it’s working, not hung. |

**Do this next (in order):**

1. **See if the API is reachable from inside the VM** (bypasses tunnel):
   ```bash
   colima ssh -- kubectl get nodes
   colima ssh -- kubectl get --raw /readyz?verbose=1
   ```
   - If these **succeed**: the control plane is up; the problem is the **host ↔ VM tunnel** (6443). Use in-VM kubectl for cert step 2 next time (step 2 below).
   - If these **fail**: the API is still degraded. Wait 2–3 minutes and try again, or do a full Colima restart (Phase B in reclaim doc).

2. **Re-establish tunnel from host** (if in-VM works):
   ```bash
   ./scripts/colima-forward-6443.sh
   kubectl get nodes
   ```
   If `kubectl get nodes` from host still fails after a few tries, prefer **in-VM** for all critical API calls (reissue step 2, applies).

3. **Next preflight: use in-VM for reissue step 2** so the flaky tunnel doesn’t kill cert rotation:
   ```bash
   REISSUE_STEP2_VIA_SSH=1 ./scripts/run-preflight-with-telemetry.sh
   ```
   Or run the full preflight script that passes that through (e.g. `run-preflight-scale-and-all-suites.sh` with `REISSUE_STEP2_VIA_SSH=1`).

4. **Reclaim script:** If it’s still running, let it finish (or run again with the quieter version: `./scripts/colima-k3s-reclaim-safe.sh --execute`). Then check `docker system df`.

**Summary:** When things look “stuck”, first **separate “API broken” from “tunnel broken”** by using `colima ssh -- kubectl get nodes`. Then re-forward 6443 or switch to in-VM kubectl for reissue; use Phase 1 abort so the next run doesn’t hammer the API with 12 retries.

---

## 1. Control-plane write burst (most common)

| What | Why it hurts | What to do |
|------|----------------|------------|
| **Too many mutating requests at once** | apiserver queues or rejects (503, connection reset). etcd has a small write budget on one node. | Health gate + abort in reissue; **CONSERVATIVE=1** tuning (max-mutating=100). |
| **Retry storm on apply** | 12 retries = 12× GET + 12× attempted write while API is already failing. | Phase 1 reissue: abort on first write failure; no retry storm. |
| **Cert reissue + load in same run** | Burst of secret applies plus watches/telemetry competes for same inflight limit. | Run cert rotation **or** load, not both. Phase order: sanity → certs → then load. |

**Docs:** `docs/COLIMA_K3S_FORENSIC_AND_TUNING.md`, `docs/ETCD_WRITE_BUDGET_PLAN.md`, `scripts/reissue-ca-and-leaf-load-all-services.sh` (REISSUE_PHASE1_ABORT=1).

---

## 2. Disk and storage

| What | Why it hurts | What to do |
|------|----------------|------------|
| **VM root or Colima disk near full** | etcd needs headroom; no space → etcd can stall or refuse writes. | Run `scripts/colima-k3s-storage-diagnostic.sh`; reclaim with `scripts/colima-k3s-reclaim-safe.sh --execute`. |
| **Build cache + dangling images** | Wastes space in Colima disk (Docker context = VM). | Safe reclaim: builder prune, container prune, image prune -f. See `docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md`. |
| **etcd quota / compaction** | etcd DB size or compaction lag can slow or block writes. | Check k3s dir size in diagnostic; apply tuning (quota-backend-bytes); avoid huge watch caches. |

**Docs:** `docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md`, `scripts/colima-k3s-storage-diagnostic.sh`.

---

## 3. Memory and CPU

| What | Why it hurts | What to do |
|------|----------------|------------|
| **VM RAM too low** | k3s + etcd + workloads compete; OOM or thrashing. | Increase Colima memory (`colima start --cpu 4 --memory 8` or edit profile). |
| **Node allocatable low** | Scheduler can’t place pods; kubelet under pressure. | `kubectl describe node` when API is up; increase VM resources. |
| **Single node does everything** | Control plane + data plane share same CPU/RAM. | Expect limits; don’t run heavy load during cert rotation. |

**Check:** Section 4 of storage diagnostic (`kubectl get nodes` when API up); `colima status`.

---

## 4. Network and API access

| What | Why it hurts | What to do |
|------|----------------|------------|
| **6443 not forwarded or stale** | `kubectl` from host fails (connection refused / timeout). | Run `scripts/colima-forward-6443.sh`; or use `REISSUE_STEP2_VIA_SSH=1` / `colima ssh` for kubectl. |
| **Tunnel flaky** | Port-forward drops; API “sometimes” works. | Prefer in-VM kubectl for critical steps: `colima ssh -- kubectl ...` or script that uses SSH. |
| **DNS or service mesh** | Extra hops or failures in cluster networking. | Isolate: test with simple `kubectl get nodes` first; then services. |

**Scripts:** `scripts/colima-forward-6443.sh`; reissue supports SSH path.

---

## 5. State and restarts

| What | Why it hurts | What to do |
|------|----------------|------------|
| **k3s been up “forever” after many failures** | Control plane may still be recovering from earlier write bursts. | Restart k3s: `colima ssh -- sudo systemctl restart k3s`; wait 60–90s; re-forward 6443. |
| **Full Colima restart** | Clears in-memory state; etcd data persists on disk. | `colima stop` then `colima start --with-kubernetes`; re-apply tuning. |
| **New Colima profile** | Fresh VM = fresh etcd; no leftover degradation. | After start: run `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh`, then forward 6443. |

**Docs:** `docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md` Phase B.

---

## 6. Tuning not applied or reverted

| What | Why it hurts | What to do |
|------|----------------|------------|
| **Default k3s limits** | Low max-mutating-inflight → quicker 503 under burst. | Run `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh` (once per profile). |
| **Tuning lost after Colima restart** | Script writes drop-in in VM; some restarts can reset. | Re-run tuning script after `colima start` if API is still flaky. |

**Docs:** `docs/COLIMA_K3S_TUNING.md`, `scripts/apply-k3s-etcd-tuning.sh`.

---

## 7. External load and timing

| What | Why it hurts | What to do |
|------|----------------|------------|
| **pgbench / k6 / heavy tests during cert work** | More CPU, more watches, more churn. | Run data-plane load only after cert rotation is done (or aborted). |
| **Too many watchers** | Each watch holds a read; can compete with GETs for apply. | Reduce parallel applies; use conservative tuning. |
| **Telemetry + apply at same time** | /metrics and readyz add read load during write burst. | Telemetry is read-only; still, phase cert apply away from heavy telemetry if possible. |

**Rule:** Control-plane sanity → cert rotation (or abort) → then data-plane load. See `docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md`.

---

## 8. Quick “why is it unhappy?” flow

1. **API reachable?**  
   `kubectl get nodes`  
   - No → 6443 forward or tunnel; or restart k3s / Colima (sections 4, 5).

2. **Disk / space?**  
   `./scripts/colima-k3s-storage-diagnostic.sh`  
   - Root or Colima disk >85% or full → reclaim (section 2).

3. **Write burst / tuning?**  
   - Recent cert reissue or big apply? Use health gate + abort; apply **CONSERVATIVE=1** tuning (sections 1, 6).

4. **Pressure snapshot (when API up):**  
   `kubectl get --raw /metrics --request-timeout=10s 2>/dev/null | grep apiserver_current_inflight`  
   - mutating at or near limit → stop new writes; wait or restart k3s (sections 1, 5).

5. **Still flaky?**  
   Restart k3s, then full Colima restart; re-apply tuning and re-forward 6443 (section 5).

---

## 9. References (one line each)

| Doc / script | Purpose |
|--------------|---------|
| **docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md** | Every layer to analyze (1–12): VM, API, k3s, etcd, node, pods, controllers, network, disk, tuning, pipeline, load. |
| **docs/COLIMA_K3S_CRASH_LOOP_51820.md** | k3s crash loop (CRD to 127.0.0.1:51820 refused). Fix: full Colima restart; script: colima-k3s-recover-from-crash-loop.sh. |
| **docs/COLIMA_K3S_FORENSIC_AND_TUNING.md** | Wire-level why (read/write pressure, tuning checklist). |
| **docs/ETCD_WRITE_BUDGET_PLAN.md** | Health gate, abort, Phase 3 tuning. |
| **docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md** | What to reclaim, safe vs not, stabilize steps. |
| **docs/COLIMA_K3S_TUNING.md** | Tuning values and how to apply. |
| **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md** | Phases, rate limiting, MetalLB. |
| **scripts/colima-k3s-storage-diagnostic.sh** | VM disk, k3s size, Docker reclaimable. |
| **scripts/colima-k3s-reclaim-safe.sh** | Safe reclaim (builder, containers, dangling images). |
| **scripts/apply-k3s-etcd-tuning.sh** | Apply apiserver + etcd tuning (CONSERVATIVE=1). |
| **scripts/reissue-ca-and-leaf-load-all-services.sh** | Cert reissue with health gate + abort. |
| **scripts/colima-forward-6443.sh** | Forward API port to host. |
| **scripts/colima-k3s-cross-layer-diagnostic.sh** | Cross-layer: API (host + in-VM), nodes, pods, controllers, MetalLB, storage. |
| **scripts/stabilize-then-metallb.sh** | Stabilize API (restart k3s, wait, re-forward, tuning), then optional MetalLB with `--metallb`. |

---

**Write amplification / reconcilers:** Control-plane overload is **write amplification** from **multiple independent reconcilers** (our applies, k3s controllers, MetalLB, ingress) all writing at once; removing accidental throttles makes it worse. See **docs/CONTROL_PLANE_RECONCILER_WRITE_AMPLIFICATION.md**. Order: stabilize API → MetalLB (separate run) → then certs/rest. Run `./scripts/stabilize-then-metallb.sh` then `./scripts/stabilize-then-metallb.sh --metallb` when API is stable.

**Bottom line:** Colima k3s is “unhappy” when we **exceed its write burst budget**, run out of **disk or memory**, or lose **API access** (tunnel/6443). Fix: **reclaim space**, **tune conservative**, **gate and abort** on reissue, **restart k3s** when needed, and **phase load after certs**.
