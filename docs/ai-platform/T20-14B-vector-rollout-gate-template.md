# T20.14B — Vector rollout gate template and burn-down roadmap

**Generated:** 2026-06-28  
**Baseline:** `docs/ai-platform/T20-14A-current-vector-readiness-baseline.md`  
**Release context:** Phase 21 non-vector seller intelligence tagged @ `d0e4c58` — does **not** approve vector rollout

---

## Purpose

Define the **exact blocker burn-down sequence** from current state to optional vector rollout (T20.15), with hard gates and no accidental production enablement.

---

## Hard stop language

```text
No T20.15 work can start until T20.14H passes every rollout gate.
No production vector default can change without explicit owner approval.
Phase 21 product release does not imply vector rollout approval.
```

**Forbidden without explicit owner approval:**

- Set `AI_RAG_SHADOW_VECTOR=1` as production default
- Enable hybrid/vector retrieval default
- Default-on overlap flags (`AI_RAG_SHADOW_ENTITY_HINTS`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION`)
- Embedding tranches or `EMBEDDING_BACKFILL_FORCE=1`
- ANN index creation in production
- T20.15 canary or production rollout

---

## Required rollout gates (all must pass)

Vector rollout cannot proceed unless **every** gate is true:

```text
 1. Production keyword path remains PASS.
 2. Leakage remains 0.
 3. Embedded count ≥10k remains PASS.
 4. Source diversity ≥5 remains PASS.
 5. Owner-visible OBO ≥10 remains PASS.
 6. Shadow p95 ≤3000 ms across repeated warm runs.
 7. Embed timeouts = 0 across repeated warm runs.
 8. Candidate fetch p95 ≤1500 ms preferred or justified.
 9. Zero-result shadow = 0.
10. Default shadow overlap materially improves.
11. Flagged overlap is either promoted through explicit design or remains diagnostic-only.
12. Full Playwright product suites still pass.
13. Rollback plan exists.
14. Canary plan exists.
15. Owner explicitly approves T20.15.
```

**T20.14A current status:** gates 1–5, 11 (diagnostic-only), 12 (functional PASS; 1 telemetry WARN) pass; gates 6–10 fail; gates 13–15 not yet applicable.

---

## Burn-down sequence

### T20.14C — Shadow latency implementation plan

**Mode:** Read-only / design first.

**Investigate:**

- Embed variance (cold vs warm; OBO default-profile timeout)
- `candidate_fetch` exact vector sort at 10,065 rows (no ANN index)
- Repeated retrieval cost per query profile
- pgvector query plans (`T20.10U` EXPLAIN artifacts)
- ANN index options (HNSW vs IVFFlat) — design only
- Retrieval caps and typed fetch fanout

**Output:**

- Recommended implementation path (ranked)
- Risk ranking per change
- Rollback plan per change

**Not allowed:** DB index creation, vector default, hybrid rollout.

---

### T20.14D — Candidate fetch trim, flags off

**Mode:** Implementation **only if explicitly approved** after T20.14C.

**Allowed:**

- Diagnostic-only trim
- Lower fanout
- Better typed caps
- Avoid redundant listing fetches
- Preserve keyword production path

**Not allowed:**

- Vector default
- Hybrid rollout
- Default-on overlap flags

---

### T20.14E — ANN index design / ops preflight

**Mode:** Design only unless explicit approval.

**Must include:**

- Index type: HNSW or IVFFlat
- Table size and build time estimate
- Lock / runtime impact
- Backup procedure
- Rollback / `DROP INDEX` command
- EXPLAIN plans before/after (local only)
- Local-only benchmark
- **No production enablement** in this ticket

---

### T20.14F — Shadow overlap v2 design

**Mode:** Design only.

**Focus:**

- Document/entity overlap, not chunk ID parity only
- Hybrid anchor strategy
- Keyword top-doc anchoring
- Entity-aware rerank
- Source-type balancing

**Flags default off.**

---

### T20.14G — Combined shadow stabilization implementation

**Mode:** Implementation **only after explicit approval** of T20.14C–F designs.

**Goal:**

- Shadow p95 ≤3000 ms
- Zero-result shadow = 0
- Overlap materially improved without leakage
- No keyword regression

---

### T20.14H — 5-run stability re-eval

**Mode:** Read-only validation.

**Required:**

- 5 consecutive warm runs (`BENCH_REQUIRE_OLLAMA_WARM=1`)
- Default/off overlap run
- Flagged overlap run (if relevant)
- Full product telemetry run (0 WARNs target)
- Complete gate table
- Final rollout verdict

**If any gate fails:**

```text
Vector rollout remains NOT APPROVED.
Do not start T20.15.
```

---

### T20.15A — Vector canary rollout plan

**Prerequisite:** T20.14H passes **all** gates.

**Mode:** Design only.

**Must define:**

- Feature flags and env changes
- Rollback procedure
- Canary percentage or user cohort
- Monitoring dashboards and alerts
- Stop conditions (p95, leakage, quality regression)

---

### T20.15B — Vector canary execution

**Prerequisite:** T20.15A approved + explicit owner approval.

**Must:**

- Backup config
- Set canary flags only (never global default without closeout)
- Run smoke + telemetry
- Rollback immediately if p95, leakage, or quality fails

---

### T20.15C — Canary closeout

**Mode:** Read-only report.

**Output:** Approve or reject expansion to broader cohort.

---

### T20.15D — Production rollout

**Prerequisite:** Canary succeeds + explicit owner approval.

**Mode:** Controlled production enablement with rollback on standby.

---

## Gate ownership matrix

| Gate category | Owner tickets | Blocks |
| ------------- | ------------- | ------ |
| Latency (shadow p95, embed, fetch) | T20.14C → D → E → G | T20.14H, all T20.15 |
| Overlap parity | T20.14F → G | T20.14H, all T20.15 |
| Data / corpus | frozen at 10,065 unless approved tranche | optional 15% gate |
| Product regression | every implementation ticket | T20.14H |
| Ops / rollout | T20.15A–D | production vector default |

---

## Rollback template (required before any T20.14D+ implementation)

```text
1. Revert env: AI_RAG_SHADOW_VECTOR=0, hybrid flags off, overlap flags off.
2. Confirm retrieval_mode=keyword on /ai/rag/query smoke.
3. Run: audit-rp-ai-rag-contract.sh, rp-ai-rag-quality-smoke.sh
4. Run: Playwright seller + record + longform suites
5. Run: node scripts/ai-quality-telemetry-report.mjs (0 WARNs target)
6. If ANN index was created: DROP INDEX CONCURRENTLY per T20.14E runbook
7. Document incident + re-baseline (T20.14A format)
```

---

## Recommended next implementation candidate

**T20.14C** — Shadow latency implementation plan (read-only).

Rationale (T20.14A): shadow p95 **9066 ms**, candidate_fetch p95 **4671 ms**, embed timeout **1/16**, zero-result **1/16**. Overlap work (T20.14F) should follow latency root-cause analysis to avoid optimizing the wrong layer.

---

## Related documents

| Doc | Purpose |
| --- | ------- |
| `T20-14A-current-vector-readiness-baseline.md` | Fresh gate table |
| `P21-10-post-release-product-roadmap.md` | Product lane (keyword only) |
| `PHASE_20_COPILOT_CONTEXT.md` | Phase 20 vector history |
| `PHASE_21_COPILOT_CONTEXT.md` | Phase 21 release + runway |
| `T20-13L-shadow-latency-remediation-plan.md` | Prior latency analysis |
| `T20-13M-shadow-overlap-remediation-plan.md` | Prior overlap analysis |

---

## Final verdict (unchanged)

```text
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
Production retrieval remains keyword
```
