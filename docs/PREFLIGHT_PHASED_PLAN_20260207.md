# Preflight Phased Plan — Freeze, Read/Write Split, Guardrails

**Date:** 2026-02-07  
**Status:** Accepted (implementation in progress)  
**Goal:** Eliminate nondeterminism so that `kubectl get nodes` and `kubectl create ns` are boring and stable. Good runs become reproducible by forcing a strict ordering every time.

---

## Why this works (and why a “good run” happened)

A “good run” happened when by accident:

- Writes didn’t overlap  
- Cert rotation happened when the API was idle  
- pgbench hadn’t started yet  
- MetalLB wasn’t hammering endpoints  

Then one variable changed → collapse. This plan **forces that lucky ordering every time**.

---

## PHASE 0 — Freeze the environment (one-time)

**Goal:** Eliminate nondeterminism.

**Cursor / implementation tasks:**

- Enforce **Colima only** (no Kind, no Docker Desktop Kubernetes).
- **Single k3s cluster**, single kubeconfig source.
- **Explicitly ban parallel kubectl writers** (no concurrent apply/create/delete/patch from multiple processes).

**Hard rules (Phase 0 baseline):**

- No pgbench  
- No k6  
- No MetalLB  
- No cert rotation (in the “freeze” baseline run; cert rotation is Phase 2 only)

**Outcome:** `kubectl get nodes` and `kubectl create ns` are boring and stable.

**Implementation:** Script `scripts/preflight-phase0-freeze-check.sh` (or equivalent) verifies: context is Colima; no Kind; optional env `PREFLIGHT_PHASE0=1` skips reissue, MetalLB, pgbench, k6 so the run is read-only + minimal writes (e.g. create ns only). Preflight already rejects Kind; Phase 0 adds explicit “freeze” mode and single-writer guardrail (flock for writes).

---

## PHASE 1 — Split preflight into READ vs WRITE

This is the key architectural fix.

### Phase 1A — Read-only checks

**Allowed:**

- `kubectl get`
- `kubectl describe`
- Health checks
- TLS verification
- `/version`

**Forbidden:**

- apply, create, delete, patch

**Rule:** If anything fails here → **abort immediately**. No writes have happened yet, so the cluster is unchanged.

**Implementation:** Preflight runs a dedicated “Phase 1A” block first: get nodes, get namespaces, optional describe, API /version, TLS check. Log: `[PHASE 1A] READ OK` or `[PHASE 1A] FAIL <reason>`. Exit 1 on failure.

### Phase 1B — Serialized writes (mutexed)

All writes must:

1. **Acquire a lock** (flock or lockfile).
2. **Run one at a time** (no parallelism).
3. **Have a hard timeout** per write.
4. **Stop on first failure** (no silent retries that hide failure).

**Includes:**

- Secret creation  
- Cert rotation  
- Endpoint changes  
- MetalLB manifests (later, when enabled)

**Rules:** No loops that retry forever, no parallelism, no retries that hide failure. One retry with explicit log is acceptable; then abort.

**Implementation:** Preflight “Phase 1B” wraps all write operations (reissue step 2, applies, scale, etc.) in a single flock (e.g. `PREFLIGHT_WRITE_LOCK_FILE=/tmp/preflight-write.lock`). Each write has a timeout (e.g. 30s). On 503 or connection reset during a write → increment error counter and abort (Phase 5). Log: `[PHASE 1B] WRITE <name> OK` or `[PHASE 1B] WRITE <name> FAIL`.

---

## PHASE 2 — Cert rotation is its own lifecycle

Cert rotation is where most pain comes from.

**Rules:**

- Cert rotation **never** overlaps with: scaling, pgbench, MetalLB, service restarts (except the restarts that are part of the cert flow).
- **Cert flow:**
  1. Pause all other activity.  
  2. Rotate CA / leaf.  
  3. Wait for API idle.  
  4. Verify with read-only calls.  
  5. Resume.

- If cert rotation fails → **cluster is tainted, stop.** Do not continue to scale or suites.

**Implementation:** Reissue script already runs as a single block. Preflight order must be: Phase 1A (read) → Phase 1B with lock: reissue only first (or reissue + minimal post-cert writes), then wait for API idle (settle), then continue with other applies/scale. Document that reissue is “Phase 2” and must not run concurrent with pgbench/k6/MetalLB install.

---

## PHASE 3 — Control plane load budget

**Rules:**

- **pgbench and k6 are forbidden until:** all secrets exist, all services are running.
- **No API writes during pgbench.**  
- **No scaling during pgbench.**

Think of pgbench as: **“data plane stress test, not infra test”.**

**Implementation:** Preflight order already does: reissue → applies → scale → then (if RUN_FULL_LOAD=1) pgbench and k6. Ensure no kubectl apply/scale/delete runs from inside the pgbench or k6 scripts; they only drive DB/HTTP load. Document and enforce: Phase 1B writes complete before any load phase.

---

## PHASE 4 — MetalLB is optional, gated

MetalLB is **not** baseline infra in a single-node k3s dev cluster.

**Rules:**

- MetalLB **only** enabled **after:** RP is stable, certs are stable, no API churn.
- MetalLB install is **serialized** (one apply at a time, with lock).
- If MetalLB causes 503s → **disable, don’t debug yet.** Keeps demos reliable.

**Implementation:** Already have `METALLB_ENABLED=0` by default. Phase D (MetalLB) runs only when explicitly requested and after Phase 1B writes are done. Document: when 503s appear with MetalLB, set METALLB_ENABLED=0 and re-run without MetalLB.

---

## PHASE 5 — Guardrails (non-negotiable)

**Cursor / implementation must add:**

1. **Write-rate limiter** — Even a naive `sleep 1` between writes (or configurable `PREFLIGHT_WRITE_SLEEP=1`). Already have `APPLY_RATE_LIMIT_SLEEP`; ensure it is applied to all write steps and default ≥ 1.
2. **API error counters** — Count 503 and connection reset. After N (e.g. 1 or 2) → abort. Env: `PREFLIGHT_ABORT_ON_503=1` (default), `PREFLIGHT_ABORT_ON_RESET=1`.
3. **Immediate abort on:**
   - `apiserver not ready`
   - Connection reset **during** a write (not just during read).
4. **Clear phase logging:**
   - `[PHASE 1A] READ OK`
   - `[PHASE 1B] WRITE secret X`
   - `[PHASE 1B] WRITE secret X FAIL (503)` → then abort.
5. **No silent retries** — Retries must be logged (e.g. `[PHASE 1B] WRITE secret X RETRY 1/1`). If strict mode: zero retries for writes.

**Implementation:** In preflight and reissue: before/after each write, check for 503/reset in output; if detected, set error flag and exit. Log phase and operation name. Use `PREFLIGHT_ABORT_ON_SLOW_APPLY` and existing timeout; add explicit “abort on first 503/reset” in the write path.

---

## Summary table

| Phase | Goal | Key rule |
|-------|------|----------|
| 0 | Freeze env | Colima only; no Kind; no pgbench/k6/MetalLB/cert in baseline freeze run |
| 1A | Read-only | get/describe/health/TLS only; abort on first failure |
| 1B | Serialized writes | flock; one at a time; timeout; stop on first failure; no silent retries |
| 2 | Cert lifecycle | Cert rotation never overlaps scale/pgbench/MetalLB; fail = cluster tainted, stop |
| 3 | Load budget | No pgbench/k6 until secrets and services exist; no API writes during pgbench |
| 4 | MetalLB gated | MetalLB only after stable; if 503s → disable |
| 5 | Guardrails | Rate limit; 503/reset counters; abort on apiserver not ready / reset on write; phase logging; no silent retries |

---

## Implementation summary (as of 2026-02-07)

- **Phase 0:** **scripts/preflight-phase0-freeze-check.sh**; **PREFLIGHT_PHASE0=1** in main preflight runs it then exits.
- **Phase 1A:** After API server ready, preflight runs get nodes + get ns; logs `[PHASE 1A] READ OK` or `[PHASE 1A] FAIL` and exits 1 on failure.
- **Phase 1B:** **PREFLIGHT_WRITE_LOCK_FILE** (default `/tmp/preflight-write.lock`); flock acquired before reissue/applies/scale, released after recovery pass (4a); trap releases on exit. Logs `[PHASE 1B] WRITES (lock acquired)` and `[PHASE 1B] WRITES (lock released)`.
- **Phase 5:** **APPLY_RATE_LIMIT_SLEEP** minimum 1s; **PREFLIGHT_ABORT_ON_503=1**; phase logging in place. See **docs/PREFLIGHT_PHASES_README.md** for all env vars.

## References

- **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**
- **docs/PREFLIGHT_PHASES_README.md** (Phase 0, env vars)
- **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md**
- **docs/adr/005-control-plane-is-rate-limited.md**
- **docs/adr/006-colima-k3s-etcd-tuning.md**
- **Runbook.md** item 32
