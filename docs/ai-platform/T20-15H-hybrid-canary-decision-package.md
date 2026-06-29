# T20.15H — Hybrid canary decision package

**Status:** Decision complete (docs only — no implementation, no env change)  
**Generated:** 2026-06-29  
**Baseline SHA:** `4a491ff` (T20.15G)  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15G — 1% eval PASS, percent restored to 0

---

## 1. Executive verdict

```text
T20.15G 1% hybrid canary eval: PASS
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0 restored
Vector production default: NOT APPROVED
Production default remains keyword
T20.15I 5% design: READY FOR OWNER APPROVAL only
```

This is **hybrid canary evidence collection** — not vector production rollout.

---

## 2. Evidence summary

### T20.14H1 / H2 — hybrid vector gate baseline

| Source | Key result |
|--------|------------|
| T20.14H1 (5-run stability) | Pure overlap **8/16** (stable FAIL vs ≥10); anchored **16/16** PASS; latency PASS |
| T20.14H2 decision | Vector production default **NOT APPROVED**; hybrid anchored path viable for canary evidence only |

### T20.15D-S — allowlist soak

| Metric | Result |
|--------|--------|
| HTTP 200 | **27/27** (3×9 transcript) |
| hybrid_canary / fallback | **24/27** / **3/27** (`final_tagged_plan` only) |
| avg / worst score | **3.78 / 2.0** |
| hybrid p50 / p95 | **108 / 214 ms** |
| keyword p50 / p95 | **225 / 317 ms** |
| pure / anchored overlap | **8/16 / 16/16** |
| true zero-results | **0/16** |
| canary errors / leakage / WARNs | **0 / PASS / 0** |

### T20.15D-T — control and rollback drill

| Step | Result |
|------|--------|
| Fake allowlist → keyword | **PASS** |
| Restore allowlist → hybrid_canary | **PASS** |
| `CANARY=0` rollback → keyword | **PASS** |
| Final KEEP restore | **PASS** |

### T20.15F — percentage gate (percent-zero deploy)

| Item | Result |
|------|--------|
| Deterministic `percentage_bucket` + gate_reason telemetry | **Implemented** |
| Deploy image | `t20-p215f` |
| `AI_RAG_HYBRID_CANARY_PERCENT` at deploy | **0** (unchanged) |
| D-T controls post-F | **PASS** |
| Hybrid canary unit tests | **27/27 PASS** |
| Full docker unittest | **282 PASS**, **4 ERROR** (unchanged signatures from T20.15F) |

Pre-existing unittest errors (not regressions):

- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_messages_absent_without_opt_in`
- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_no_proxy_max_in_retrieval`
- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_owner_doc_not_visible_to_other_user`
- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_source_refs_always_present_when_chunks`

### T20.15G — 1% eval window

| Item | Result |
|------|--------|
| Three-path proof (allowlist / percentage / keyword_default) | **PASS** |
| Allowlist transcript at PERCENT=1 | **27/27 HTTP 200** |
| Cohort API prompts | **4/4 HTTP 200** |
| Fallback rate | **11.1%** (≤15%) |
| Hybrid p50 / p95 (PERCENT=1 transcript) | **93 / 223 ms** |
| Percent restored after eval | **YES → 0** |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| Anchored overlap | **16/16** |
| Pure overlap | **8/16** (report only) |

---

## 3. T20.15G critical proof table

| User | UUID | Bucket | Allowlisted | PERCENT=1 path | Proof |
|------|------|--------|-------------|----------------|-------|
| e2e-contract | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` | **15** | yes | **allowlist only** (bucket ≥ 1) | `gate_reason=allowlist`, `hybrid_canary` |
| t20-15g-cohort0 | `00000040-0000-4000-8000-000000000000` | **0** | no | **percentage cohort** | `gate_reason=percentage`, `percentage_cohort=true` |
| buyer-contract | `5a68fe88-c134-4166-b145-57534a3656b9` | **9** | no | **keyword_default control** | `retrieval_mode=keyword` |

**Auth integrity:** No header spoofing. JWT `sub` drives gating (T20.15C/D-T lesson). Cohort user authenticated via `/api/auth/login`.

---

## 4. Gate verdict table (T20.15G aggregate)

| Gate | Threshold | Result |
|------|-----------|--------|
| HTTP 200 (allowlist transcript) | 27/27 | **PASS** |
| Cohort API prompts | 4/4 | **PASS** |
| Fallback rate | ≤ 15% | **PASS** (11.1%) |
| Hybrid p50 / p95 | ≤ 3000 ms | **PASS** (93 / 223 ms) |
| Telemetry WARNs | 0 | **PASS** |
| Leakage | PASS | **PASS** |
| Anchored overlap | ≥ 10/16 | **PASS** (16/16) |
| Pure overlap | report only | **8/16** |
| True zero-results | 0/16 | **PASS** |
| Percent restored to 0 | required | **PASS** |
| Canary errors | 0 | **PASS** |

---

## 5. Options

### A. ROLLBACK hybrid canary entirely

**Not selected.** All gates passed. D-T rollback drill already proved safe off-ramp. No leakage, no canary errors, controlled fallback on one prompt shape only.

### B. KEEP allowlist canary only, percent=0 ✅ CURRENT CLUSTER STATE

**Selected as active state.**

- Safest operational default after G eval.
- Allowlisted contract user continues hybrid evidence collection.
- Non-allowlisted users remain keyword.
- Percentage gate code present but inactive (`PERCENT=0`).

### C. KEEP allowlist + approve T20.15I 5% design only ✅ RECOMMENDED NEXT

**Recommended next step (design only — no env change, no implementation).**

- G proved percentage cohort path with bucket-0 test user.
- Contract user (bucket 15) correctly unaffected by PERCENT=1 except via allowlist.
- T20.15J implementation **blocked** until separate owner approval after I.

### D. Keep PERCENT=1 active

**Not selected.** Eval window closed. Percent restored to **0** per G5 restore rule.

---

## 6. Explicit recommendation

**Recommend Option C** (with Option B as the locked runtime state until I is approved):

1. **Keep** allowlist canary active (`AI_RAG_HYBRID_CANARY=1`, contract user allowlisted).
2. **Keep** `AI_RAG_HYBRID_CANARY_PERCENT=0`.
3. **Proceed** to T20.15I 5% design **only** if owner approves — no code, no env change in I.
4. **Do not** implement 5% (T20.15J) without a new approval phrase after I.
5. **Do not** enable vector production default.

---

## 7. Final env state

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Image: `python-ai-service:t20-p215f`

---

## 8. Rollback runbook

Target: **under 5 minutes**.

### Percent-only off (keep allowlist canary)

```bash
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

### Full hybrid off

```bash
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY=0 \
  AI_RAG_HYBRID_CANARY_USER_ALLOWLIST= \
  AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

### Image rollback pin

```bash
kubectl -n record-platform set image deployment/python-ai-service \
  app=python-ai-service:t20-p215b2
# or: python-ai-service:t20-p214g3r
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

### Verify

```bash
bash scripts/audit-rp-ai-rag-contract.sh
node scripts/ai-quality-telemetry-report.mjs
# Spot: non-allowlisted user → retrieval_mode=keyword
# Spot: fake allowlist → retrieval_mode=keyword
```

---

## 9. Stop condition

```text
T20.15H hybrid canary decision package: COMPLETE
Selected: Option B (active) + Option C (recommended next)
T20.15I 5% design: NOT STARTED — owner approval required
T20.15J implementation: NOT APPROVED
Vector production default: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
```

---

## Required next approval phrase

```text
Approved: start T20.15I 5 percent hybrid canary design only
```

---

## References

- `docs/ai-platform/T20-14H1-hybrid-vector-5run-stability-eval.md`
- `docs/ai-platform/T20-14H2-vector-rollout-decision-package.md`
- `docs/ai-platform/T20-15D-S-hybrid-allowlist-canary-soak.md`
- `docs/ai-platform/T20-15D-T-hybrid-canary-control-and-rollback-drill.md`
- `docs/ai-platform/T20-15F-hybrid-percentage-gate-implementation.md`
- `docs/ai-platform/T20-15G-1percent-hybrid-canary-eval.md`
