# MetalLB: plan to get it out of the way (later)

**Status:** Planned follow-up. We have **not** done the MetalLB setup per se yet. This doc is the plan so we can get it out of the way in a controlled way without blocking “prove preflight and test suite.”

---

## 1. Where we are

- **ADR and design:** **docs/adr/003-metallb-investigation-and-integration.md** — L2 flow, Caddy/Envoy behind MetalLB, traffic policy (sessionAffinity ClientIP). Design is correct.
- **Current preflight:** Runs with **METALLB_ENABLED=0** (default). Caddy is NodePort (30443). No MetalLB install or pool apply during normal runs.
- **What we have not done:** No MetalLB install in the cluster for this environment; no pool/L2 applied; no Caddy LoadBalancer service in a stable, proven run. So MetalLB is “planned, not set up.”

---

## 2. Order of operations (non-negotiable)

1. **First:** Prove preflight and test suite **without** MetalLB (cert rotation completes or aborts cleanly; strict TLS/mTLS; suites run and pass). See **docs/ETCD_WRITE_BUDGET_PLAN.md** Phase 1–3.
2. **Then:** MetalLB as a **separate** run / experiment. Certs already stable; no cert rotation in the same run. No scaling, no pgbench in the same run as first MetalLB validation.

---

## 3. MetalLB “get it out of the way” plan

| Step | What | When |
|------|------|------|
| 1 | Preflight (and suites) proven **without** MetalLB | First. |
| 2 | **Separate** run: install MetalLB only (script or manifest). Wait for controller + webhook ready. | After step 1. |
| 3 | Apply pool + L2 (address range for Colima). Verify pool and L2. | Same run as step 2 or next. |
| 4 | Apply Caddy as LoadBalancer (or separate Caddy apply run). Verify EXTERNAL-IP and sessionAffinity. | After pool is stable. |
| 5 | Validate: curl to LoadBalancer IP with TLS; confirm traffic policy (affinity). | Proof. |
| 6 | Optionally: run preflight with **METALLB_ENABLED=1** in a dedicated “MetalLB phase” run (certs already good; no reissue in same run). | Last. |

**Config:** **infra/k8s/metallb/** — `ipaddresspool.yaml` (default `192.168.5.240/28` to match Colima node subnet) and `l2advertisement.yaml`. **scripts/install-metallb.sh** now waits for webhook endpoints before applying pool/L2.  
**Scripts / references:** **scripts/install-metallb.sh**, **scripts/apply-metallb-pool-and-caddy-service.sh**, **METALLB_AND_API_503_REPORT.md**, **infra/docs/METALLB.md**, **scripts/colima-k3s-cross-layer-diagnostic.sh** (cross-layer view including MetalLB).

---

## 4. Success criteria for MetalLB (when we do it)

- Controller and webhook pods Running; webhook has endpoints.
- Pool and L2 applied; no 503 / InternalError (endpoints not found).
- Caddy Service has EXTERNAL-IP from pool; sessionAffinity ClientIP (1h).
- curl to that IP with TLS (record.local or host entry) returns HTTP 200.

---

## 5. What we do not do

- Do **not** enable MetalLB in the same run as cert reissue.
- Do **not** debug MetalLB inline when the goal is “prove preflight and suites.” MetalLB is a separate experiment; if it fails, we postpone it and keep preflight/suites as the baseline.

---

## 6. References

- **docs/ETCD_WRITE_BUDGET_PLAN.md** — Pillar C (MetalLB decoupled); Phase 4 (MetalLB as separate experiment).
- **docs/adr/003-metallb-investigation-and-integration.md** — MetalLB L2, Caddy LoadBalancer, traffic flow.
- **METALLB_AND_API_503_REPORT.md** — Why 503, webhook, scripts, fix options.
- **infra/docs/METALLB.md** — Quick install, pool, L2Advertisement.
