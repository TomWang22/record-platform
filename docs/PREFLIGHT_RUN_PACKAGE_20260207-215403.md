# Preflight run package — 2026-02-07 21:54:03

**Run with telemetry.** Goal: run preflight and prove the pipeline (and test suite). This run failed at reissue step 2; we did not change the test suite — we need to get the control plane under the write budget so the run can complete and the suite can be proved.

---

## 1. Run summary

| Item | Value |
|------|--------|
| **Log** | `preflight-run-20260207-215403.log` (215 lines) |
| **Telemetry during** | `telemetry-during-20260207-215403.log` (1,651 lines; 8s interval) |
| **Failure report** | `preflight-failure-report-20260207-215403.md` |
| **Outcome** | Reissue step 2 failed from **first** apply: ServiceUnavailable on GET secrets record-local-tls. All 12 attempts failed with same error. Pipeline did not reach Kafka SSL, applies, scale, Caddy verify, strict TLS/mTLS, or test suites. |

### What happened

- Phase 1A/1B OK; reissue step 1 (CA + leaf) OK.
- **Step 2 first apply:** `kubectl apply -f -` (record-local-tls) does a GET first to retrieve current config. The API returned **ServiceUnavailable** (“the server is currently unable to handle the request (get secrets record-local-tls)”) on every attempt.
- So the **API was already overloaded or degraded** before we wrote anything — e.g. cluster still recovering from a previous run, or another load. Retrying 12 times did not help; we need to **gate on health and abort early** (see **docs/ETCD_WRITE_BUDGET_PLAN.md** Phase 1).

### Telemetry during run (excerpt)

When metrics were available, in-flight was low (mutating=1, readOnly=1–23). Many samples were “(metrics unavailable)” once the API was stressed. So when the API was up, pressure looked fine; the failure was the API refusing the GET for the first secret.

---

## 2. Proving the pipeline and test suite

- **We do not change the test suite.** We run preflight; when it completes through step 5 (strict TLS/mTLS), the suites run and we **prove** they pass.
- **To get there:** Implement **Phase 1** of **docs/ETCD_WRITE_BUDGET_PLAN.md**: health gate (3× readyz) **before** any apply; one namespace at a time with gate after each; **abort on first write failure** (no 12 retries). Then re-run preflight (with telemetry). If the API is healthy at start, cert rotation completes; if not, we abort immediately and leave the cluster usable.
- **MetalLB:** Planned separately; see **docs/METALLB_LATER_PLAN.md**. Not in scope for “prove pipeline and suites.”

---

## 3. Artifact paths

| Artifact | Path |
|----------|------|
| Preflight log | `preflight-run-20260207-215403.log` |
| Telemetry during | `telemetry-during-20260207-215403.log` |
| Failure report | `preflight-failure-report-20260207-215403.md` |
| This package | `docs/PREFLIGHT_RUN_PACKAGE_20260207-215403.md` |
