# Preflight run analysis: this run vs good run (2026-02-01)

**Purpose:** Compare the latest preflight run (control-plane at limit, many failures) to the known-good run `preflight-full-20260206-215733.log`, and document how to get a good run (flock, lock, MetalLB off, save log, analyze).

---

## 1. What was done for this session

- **Phase 1B lock on macOS:** `flock` is not built-in on macOS. We now:
  - **Option A:** Run `brew install flock` so the script uses real file locking (recommended).
  - **Option B:** If `flock` is not installed, the script automatically uses a **portable mkdir-based lock** (same semantics: serialized writes; no extra install).
- **flock installed:** `brew install flock` was run successfully; next full preflight will use `flock` when `PREFLIGHT_WRITE_LOCK_FILE` is set.
- **Docs:** `docs/PREFLIGHT_PHASES_README.md` documents `PREFLIGHT_WRITE_LOCK_FILE` and the `brew install flock` / mkdir fallback.

---

## 2. Latest run (terminal 7) — summary

- **Command:** `METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 RUN_FULL_LOAD=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"`
- **Phase 1B:** Log showed `[PHASE 1B] WRITES (no lock — flock not available or PREFLIGHT_WRITE_LOCK_FILE=)` (flock was not installed at run time).
- **Reissue step 2:** Multiple "connection reset by peer" and "apiserver not ready" retries; step 2 eventually completed (secrets created).
- **Service restarts (step 7):** auth, api-gateway, records OK; listings, social, shopping, analytics, auction-monitor, python-ai **restart failed**.
- **3c applies:** config and kafka-external **failed**; social-service, auction-monitor applied; analytics **failed**. caddy-h3-service-nodeport **failed** (twice).
- **Recovery pass (4a):** config, kafka-external, analytics, caddy-h3-service-nodeport **succeeded** on retry.
- **Scale (4):** auth, api-gateway, records, listings, social, auction-monitor, python-ai, nginx-exporter, haproxy-exporter, envoy-test **failed**; shopping, analytics, caddy-h3 scaled. Same failures on recovery retry.
- **4d Caddy verify:** Failed after 3 attempts (NodePort 30443 / port-forward).
- **Step 5 Strict TLS/mTLS preflight:** Failed with "could not establish valid full chain (service-tls + dev-root-ca)."

**Conclusion:** Control plane was pushed to the limit during reissue step 2; API resets and "apiserver not ready" led to cascade: restarts, applies, and scale failed; recovery fixed some applies but scale and TLS preflight still failed.

---

## 3. Good run (preflight-full-20260206-215733.log) — why it didn’t have this

- **Reissue step 2:** No connection resets. All secrets created/configured in one go (record-local-tls, dev-root-ca, service-tls).
- **3c applies:** All succeeded (config, kafka-external, social-service, auction-monitor, analytics-service).
- **3c2:** No caddy-h3-service-nodeport failure mentioned (likely applied once).
- **Scale (4):** Every deployment scaled successfully (auth, api-gateway, records, listings, social, shopping, analytics, auction-monitor, python-ai, nginx-exporter, haproxy-exporter, envoy-test, caddy-h3).
- **4d Caddy verify:** "Caddy strict TLS OK (HTTP 200, no curl 60)."
- **Step 5:** "Strict TLS/mTLS preflight passed."

**Differences that likely matter:**

| Factor | Good run (20260206-215733) | Latest run (terminal 7) |
|--------|----------------------------|--------------------------|
| **Kubeconfig** | Had 2 clusters; script ran "2b. Cleaning unused kubeconfig" and slimmed to 1 context. | Single cluster from start (1 context, 1 cluster); no hygiene step. |
| **Reissue step 2** | No resets; API accepted burst. | Multiple resets and "apiserver not ready"; retries eventually succeeded. |
| **Phase 1B lock** | Phase 1A/1B not present in that script version (no lock log line). | Lock desired but flock missing → no lock → more concurrent load possible elsewhere. |
| **MetalLB** | Not mentioned (default off). | METALLB_ENABLED=0 explicitly; user noted "this time we just had added metalb" — so MetalLB may have been installed or enabled in the cluster in a later run, adding webhook/controller load. |

**Why the good run didn’t hit the limit:**  
The API was not overloaded: step 2 had no resets, so later steps (applies, scale, Caddy verify, step 5) all succeeded. So either (1) the control plane was under less load (e.g. no MetalLB, no other writers), (2) kubeconfig hygiene or timing meant a slightly different API path/behavior, or (3) the burst was smaller or better spaced in that run. **Adding MetalLB** (controller + webhook) increases API and admission load; that can be enough to push the same reissue burst over the limit and trigger resets and cascade failures.

---

## 4. Getting a good run and saving the log

1. **Install flock (done):** `brew install flock` so Phase 1B uses a real write lock and serializes with any other preflight.
2. **Use the lock:** Leave `PREFLIGHT_WRITE_LOCK_FILE` at default (`/tmp/preflight-write.lock`) or set it explicitly. Do not set it to empty if you want serialization.
3. **MetalLB off for core preflight:** Run with `METALLB_ENABLED=0` (default) so MetalLB doesn’t add webhook/controller load during reissue and applies.
4. **Save a full log:**  
   `LOG="preflight-run-$(date +%Y%m%d-%H%M%S).log"`  
   `METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 RUN_FULL_LOAD=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"`
5. **Analyze:**  
   `./scripts/generate-preflight-failure-report.sh "$LOG"`  
   Then open the log and this doc (or RCA) to see what passed/failed and why.
6. **Optional — Phase 0 first:** To ensure cluster is stable before full run:  
   `PREFLIGHT_PHASE0=1 ./scripts/run-preflight-scale-and-all-suites.sh`  
   Then run the full preflight (step 4) in the same session.

---

## 5. MetalLB and control-plane limit

- **Goal:** MetalLB should work when needed, without breaking preflight.
- **Current approach:** MetalLB is **opt-in** (METALLB_ENABLED=0 by default). Core preflight (reissue, applies, scale, Caddy verify, step 5) runs with NodePort Caddy. When you enable MetalLB (e.g. Phase D or METALLB_ENABLED=1), ensure:
  - Controller and webhook are Running and webhook has endpoints (see **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** §5).
  - Prefer enabling MetalLB only after a **good run without MetalLB** (so control plane is not already at limit).
- **Why this run may have been worse:** If MetalLB was installed or enabled in the cluster "this time," the extra admission and controller traffic can be enough to push the same reissue burst over the limit. So: get a good run with MetalLB off and lock on; then add MetalLB and re-test.

---

## 6. References

- **RCA and what still breaks:** `docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md`
- **Single report for AI/handoff:** `docs/PREFLIGHT_REPORT_FOR_AI.md`
- **Phases and lock:** `docs/PREFLIGHT_PHASES_README.md`, `docs/PREFLIGHT_PHASED_PLAN_20260207.md`
- **Failure report script:** `scripts/generate-preflight-failure-report.sh`
- **Tuning:** `scripts/apply-k3s-etcd-tuning.sh`, `docs/COLIMA_K3S_TUNING.md`
