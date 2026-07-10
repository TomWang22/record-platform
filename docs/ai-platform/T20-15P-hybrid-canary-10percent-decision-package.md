# T20.15P — Hybrid canary 10% decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-29  
**Baseline SHA:** `61557ca` + O eval  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15O — 10% eval PASS, percent restored to 0

---

## 1. Executive verdict

```text
T20.15O 10% hybrid canary eval: PASS
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0 restored
Production default: keyword
Vector production default: NOT APPROVED
T20.15Q 25% design: RECOMMENDED (owner approval required)
```

---

## 2. Evidence summary (D-S through O)

| Ticket | Key result |
|--------|------------|
| T20.14H1/H2 | Pure 8/16; anchored 16/16; vector default NOT APPROVED |
| T20.15D-S | 27/27 soak; fallback 11%; hybrid p95 214 ms |
| T20.15D-T | Fake allowlist, rollback, KEEP — all PASS |
| T20.15F | Percentage gate + gate_reason telemetry |
| T20.15G | 1% PASS; bucket-0 cohort proof; percent restored |
| T20.15J | 5% verification-only; percent=5 bucket math |
| T20.15K | 5% PASS; buckets 0–1 + buyer control; percent restored |
| T20.15N | 10% verification-only; percent=10 bucket math |
| T20.15O | 10% PASS; buckets 0–9 cohort + bucket10 control; percent restored |

---

## 3. T20.15O gate verdict table

| Gate | Result |
|------|--------|
| HTTP 200 (27 allowlist transcript) | **PASS** |
| Cohort API (12 prompts) | **PASS** |
| Fallback ≤ 15% | **PASS** (11.11%) |
| Hybrid p95 ≤ 3000 ms | **PASS** (223.8 ms) |
| Telemetry WARNs | **0 PASS** |
| Leakage | **PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap | **8/16** report-only |
| Percent restored | **PASS** |
| Playwright | **PASS** |
| Source diagnostic (Lane C) | **PASS** |
| OCH / contracts | **PASS** |

---

## 4. Options

### A. ROLLBACK hybrid canary entirely

**Not selected.** All gates passed across 1%/5%/10% evals; rollback paths proven; no leakage or canary errors.

### B. KEEP allowlist only, percent=0 ✅ SELECTED (active state)

Safest operational default. Allowlisted contract user continues hybrid evidence; all others keyword.

### C. KEEP allowlist + recommend 25% design only ✅ RECOMMENDED NEXT

1%, 5%, and 10% evals passed with controlled cohort samples. Further design (T20.15Q) before any 25% implementation. **No env change.**

### D. KEEP PERCENT=10 active

**Not selected.** Eval window closed; percent restored to **0** per restore rule.

---

## 5. Explicit recommendation

**Active:** Option **B** — allowlist canary KEEP, `PERCENT=0`.

**Next (if owner approves):** Option **C** — T20.15Q 25% design only.

Do **not** implement 25% (T20.15R) without separate approval after Q.

---

## 6. Final env state

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

## 7. Rollback runbook

1. **Percent-only off:** `AI_RAG_HYBRID_CANARY_PERCENT=0` → rollout restart (~2 min)
2. **Full hybrid off:** `AI_RAG_HYBRID_CANARY=0`, clear allowlist → rollout restart
3. **Image pin:** `python-ai-service:t20-p215f` or `t20-p215b2` if needed
4. **Verify:** contract user → `retrieval_mode=keyword`; OCH/contracts PASS

Target: under 5 minutes for percent-only rollback.

---

## 8. Production defaults (unchanged)

| Setting | Value |
|---------|-------|
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |
| Hybrid allowlist canary | **KEEP** |

---

## 9. Next ticket recommendation

| Ticket | Scope | Status |
|--------|-------|--------|
| T20.15Q | 25% design only | **RECOMMENDED** (owner approval) |
| T20.15R | 25% implementation percent-zero | **NOT APPROVED** |
| T20.15S | 25% eval window | **NOT APPROVED** |

---

## Required next approval phrase

```text
Approved: start T20.15Q 25 percent hybrid canary design only
```

---

## References

- `docs/ai-platform/T20-15O-10percent-hybrid-canary-eval.md`
- `docs/ai-platform/T20-15L-hybrid-canary-5percent-decision-package.md`
- `docs/ai-platform/T20-15M-10percent-hybrid-canary-design.md`
