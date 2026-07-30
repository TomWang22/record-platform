# T20.16A — Hybrid production-readiness design

**Status:** Design complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `c44b9a1` (T20.15AG closeout)  
**Image:** `python-ai-service:t20-p215f` (unchanged)  
**Parent:** T20.15AG hybrid canary ladder closeout

---

## 1. Executive verdict

```text
T20.16A hybrid production-readiness design: COMPLETE
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Implementation: NOT STARTED
```

This document converts T20.15 ladder evidence into a production-readiness design and blocker map. It does **not** authorize hybrid or vector as production default.

---

## 2. Evidence recap

### T20.15 percentage ladder

| Tranche | Result |
| ------- | ------ |
| 1% | PASS |
| 5% | PASS |
| 10% | PASS |
| 25% | PASS |
| 50% | PASS |
| 75% | PASS |
| 100% | PASS |

### Cross-tranche metrics (allowlist transcript, each eval window)

| Metric | Value |
|--------|-------|
| HTTP 200 | **27/27** every eval |
| Fallback rate | **11.11%** (3/27), concentrated on `final_tagged_plan` |
| Hybrid p95 | Always **under 3000 ms** (range ~223–515 ms across tranches) |
| Anchored overlap | **16/16** (shadow diagnostic) |
| Pure overlap | **8/16** (report-only; `AI_RAG_HYBRID_LOG_PURE_VECTOR=1`) |
| Telemetry WARNs | **0** every eval |
| Leakage | **PASS** every eval |
| Percent restored | **yes** after every eval window |

### Supporting evidence

- **T20.15D-S** allowlist soak and **T20.15D-T** control drill validated rollback paths.
- **T20.15C** established allowlist hybrid baseline (avg quality 3.78).
- **T20.14H** lane comparison: Lane A pure vector **8/16 FAIL**; Lane B hybrid anchored **16/16 PASS**; Lane C keyword **PASS**.
- Cohort prompt matrices at each tranche: all HTTP 200 within scoped eval windows.
- Playwright seller-intelligence (real allowlist) + record/longform (Lane C keyword control) passed at each major eval.

---

## 3. Readiness lanes

### Lane C — keyword production default

| Aspect | State |
|--------|-------|
| Status | **Current approved production path** |
| Retrieval | `keyword` |
| Synthesis | `rule-engine` (`rag_synthesis.py` templates) |
| Default | **Remains default** for all non-allowlisted users |
| Evidence | Phase 21 release-tagged; seller intelligence product track closed on keyword path |

Lane C is the only lane approved for production default semantics.

### Lane B — hybrid anchored canary

| Aspect | State |
|--------|-------|
| Status | **Canary lane only** — evidence strong, not production default |
| Mechanism | Vector retrieval + entity expansion + bounded keyword anchors (`AI_RAG_HYBRID_ANCHOR_MAX=1`) |
| Gating | Allowlist override + optional percentage cohort (`bucket < percent`) |
| Safety | Keyword fallback required (`AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1`) |
| Overlap | Anchored **16/16** in shadow; pure **8/16** logged only |
| Operational rule | `AI_RAG_HYBRID_CANARY_PERCENT` **must remain 0** outside explicitly approved eval windows |

Lane B is safe for allowlist evidence collection and controlled percentage eval windows. It is **not** approved as production default.

### Lane A — pure vector

| Aspect | State |
|--------|-------|
| Status | **Not ready — not a production candidate** |
| Pure overlap | **8/16** (stable across repeated H1 runs) |
| Role | Diagnostic / research only |
| Production default | **NOT APPROVED** |

Lane A must not be promoted to default without T20.16C research and explicit owner decision.

---

## 4. Why production default is still not approved

| # | Blocker |
|---|---------|
| 1 | Pure vector overlap remains **8/16** — insufficient for vector-default confidence |
| 2 | Hybrid anchored overlap **depends on keyword anchors** — hybrid quality is anchored to keyword retrieval, not standalone vector |
| 3 | `final_tagged_plan` fallback remains **3/27** (11.11%) — above proposed ≤5% production gate |
| 4 | Production default semantics remain **keyword / rule-engine** — no product or engineering decision approving hybrid as default |
| 5 | Percentage ladder was **eval-window evidence**, not permanent rollout — all tranches restored PERCENT=0 |
| 6 | No **long soak** with real heterogeneous users beyond controlled cohort accounts |
| 7 | No **owner/product decision** approving hybrid as default retrieval path |

**Verdict:** T20.15 proved canary mechanics and bounded safety. It did **not** prove production-readiness for default hybrid or vector retrieval.

---

## 5. Production-readiness gate proposal

Before any future default or broad hybrid production rollout, require **all** of:

| Gate | Threshold |
|------|-----------|
| Soak / live inference | 7-day soak plan **or** repeated live inference windows with documented cohort |
| Fallback rate | **≤5%** or documented acceptable fallback class with owner sign-off |
| `final_tagged_plan` | Fallback remediated (T20.16B) or explicitly accepted with rationale |
| Pure vector overlap | Improved **or** officially downgraded to report-only (no default promotion) |
| Anchored overlap | **≥16/16** remains stable across soak windows |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| Source diagnostic | **PASS** |
| Playwright | seller-intelligence + record + longform **PASS** |
| Rollback drill | D-T style drill **PASS** |
| Owner approval | Explicit phrase for scoped eval or rollout |

Do **not** propose default rollout before T20.16B–E complete and gates pass.

---

## 6. Required future tickets

Define only — **do not start** without explicit approval:

| Ticket | Scope |
|--------|-------|
| **T20.16B** | `final_tagged_plan` fallback remediation — design and implementation |
| **T20.16C** | Pure vector overlap research / design |
| **T20.16D** | Hybrid production-readiness eval plan |
| **T20.16E** | Hybrid production decision package |

**Sequence recommendation:** T20.16B → T20.16C (parallel research OK) → T20.16D → T20.16E.

No default rollout before these pass and owner approves T20.16E outcome.

---

## 7. Real inference testing plan

Future eval windows (T20.16D and beyond) must **not** rely only on synthetic shadow timing.

### Required practices

1. **JWT-authenticated live API transcripts** — no header user-ID spoofing; `sub` drives gating.
2. **Controlled cohort users** across representative percentage buckets (0, low, mid, high, 90–99).
3. **Keyword-vs-hybrid comparison** per prompt where hybrid is active.
4. **Score each answer** (domain quality rubric).
5. **Record fallback reason** per prompt (`hybrid_fallback_reason`).
6. **Report diagnostics:** `gate_reason`, `retrieval_mode`, `percentage_bucket`, `percentage_cohort`, `allowlisted`.
7. **Latency:** hybrid p50/p95 and keyword p50/p95 per window.
8. **Leakage scan** on all transcript cases.
9. **Playwright acceptance:** seller-intelligence (allowlist), record + longform (Lane C keyword control where assertions expect keyword).
10. **Post-restore verification:** PERCENT=0, cohort users → `keyword_default`, allowlist → `hybrid_canary` / `allowlist`.

### Shadow timing (supplementary)

- `rp-ai-shadow-real-query-timing.sh` remains supplementary evidence.
- Shadow overlap (pure/anchored) reported but does not replace live transcript gates.

### Eval window discipline

- Set PERCENT only for approved window duration.
- Mandatory restore to PERCENT=0 on pass or fail.
- Document env snapshot before, during, and after each window.

---

## 8. Rollback runbook

### A. Percent-only off (restore allowlist-only)

```bash
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

Verify: non-allowlisted users → `keyword` / `keyword_default`; allowlist → `hybrid_canary` / `allowlist`.

### B. Full hybrid off

```bash
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY=0 \
  AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

Verify: all users → `keyword` / `keyword_default`.

### C. Image rollback

Known-good images:

- `python-ai-service:t20-p215f` — current hybrid canary + percentage gate (T20.15F)
- `python-ai-service:t20-p215b2` — prior hybrid gate baseline (T20.14H)

```bash
kubectl -n record-platform set image deployment/python-ai-service \
  python-ai-service=python-ai-service:t20-p215f
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

### D. Verification commands

```bash
bash scripts/rp-ai-hybrid-canary-transcript.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-rp-decontaminate-scan.sh
node scripts/ai-quality-telemetry-report.mjs
```

### E. Allowlist-only restore (KEEP state)

```bash
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY=1 \
  AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f \
  AI_RAG_HYBRID_CANARY_PERCENT=0 \
  AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1 \
  AI_RAG_HYBRID_LOG_PURE_VECTOR=1 \
  AI_RAG_HYBRID_ANCHOR_MAX=1 \
  AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
```

---

## 9. Hard stops (carry forward from T20.15AG)

- Do **NOT** enable vector retrieval as production default.
- Do **NOT** set `AI_RAG_HYBRID_CANARY_PERCENT` above 0 without explicit owner approval.
- Do **NOT** start T20.16B/C/D/E implementation without explicit approval phrase.
- Do **NOT** modify runtime code or cluster env as part of T20.16A.
- Do **NOT** rename hybrid canary to production rollout.

---

## 10. Next approval phrase

```text
Approved: start T20.16B final_tagged_plan fallback remediation
```

Do **not** start T20.16B without this phrase.
