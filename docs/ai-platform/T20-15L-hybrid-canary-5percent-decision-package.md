# T20.15L — Hybrid canary 5% decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-29  
**Baseline SHA:** `42fac2b` + K eval  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15K — 5% eval PASS, percent restored to 0

---

## 1. Executive verdict

```text
T20.15K 5% hybrid canary eval: PASS
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0 restored
Production default: keyword
Vector production default: NOT APPROVED
T20.15M 10% design: RECOMMENDED (owner approval required)
```

---

## 2. Evidence summary (D-S through K)

| Ticket | Key result |
|--------|------------|
| T20.14H1/H2 | Pure 8/16; anchored 16/16; vector default NOT APPROVED |
| T20.15D-S | 27/27 soak; fallback 11%; hybrid p95 214 ms |
| T20.15D-T | Fake allowlist, rollback, KEEP — all PASS |
| T20.15F | Percentage gate + gate_reason telemetry |
| T20.15G | 1% PASS; bucket-0 cohort proof; percent restored |
| T20.15J | Verification-only; percent=5 bucket math tested |
| T20.15K | 5% PASS; buckets 0–1 cohort + buyer control; percent restored |

---

## 3. T20.15K gate verdict table

| Gate | Result |
|------|--------|
| HTTP 200 (27 allowlist transcript) | **PASS** |
| Cohort API (8 prompts) | **PASS** |
| Fallback ≤ 15% | **PASS** (11.11%) |
| Hybrid p95 ≤ 3000 ms | **PASS** (355 ms) |
| Telemetry WARNs | **0 PASS** |
| Leakage | **PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap | **8/16** report-only |
| Percent restored | **PASS** |
| Playwright | **PASS** |
| RP / contracts | **PASS** |

---

## 4. Options

### A. ROLLBACK hybrid canary entirely

**Not selected.** All gates passed; D-T/K rollback paths proven; no leakage or canary errors.

### B. KEEP allowlist only, percent=0 ✅ SELECTED (active state)

Safest operational default. Allowlisted contract user continues hybrid evidence; all others keyword.

### C. KEEP allowlist + recommend 10% design only ✅ RECOMMENDED NEXT

1% and 5% evals passed with small cohort samples. Further design (T20.15M) before any 10% implementation. **No env change.**

### D. KEEP PERCENT=5 active

**Not selected.** Eval window closed; percent restored to **0** per restore rule.

---

## 5. Explicit recommendation

**Active:** Option **B** — allowlist canary KEEP, `PERCENT=0`.

**Next (if owner approves):** Option **C** — T20.15M 10% design only.

Do **not** implement 10% (T20.15N) without separate approval after M.

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

### Percent-only off

```bash
kubectl -n record-platform set env deployment/python-ai-service AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

### Full hybrid off

```bash
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY=0 AI_RAG_HYBRID_CANARY_USER_ALLOWLIST= AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

### Image rollback

`python-ai-service:t20-p215b2` or `t20-p214g3r`

### Verify

```bash
bash scripts/audit-rp-ai-rag-contract.sh
node scripts/ai-quality-telemetry-report.mjs
```

---

## 8. Stop condition

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT: 0
T20.15M: READY FOR OWNER APPROVAL
T20.15N: NOT APPROVED
```

---

## Required next approval phrase

```text
Approved: start T20.15M 10 percent hybrid canary design only
```

---

## References

- `docs/ai-platform/T20-15K-5percent-hybrid-canary-eval.md`
- `docs/ai-platform/T20-15H-hybrid-canary-decision-package.md`
