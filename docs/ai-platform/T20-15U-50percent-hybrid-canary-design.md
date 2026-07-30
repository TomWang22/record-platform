# T20.15U — 50% hybrid canary design

**Status:** Design complete (docs only — no implementation, no env change)  
**Generated:** 2026-06-29  
**Baseline SHA:** post T20.15T  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15T — recommends 50% design only

---

## 1. Executive verdict

```text
T20.15U 50% hybrid canary design: COMPLETE
Design only — no implementation
AI_RAG_HYBRID_CANARY_PERCENT remains 0
Hybrid allowlist canary: KEEP
Production default remains keyword
Vector production default: NOT APPROVED
T20.15V implementation: NOT STARTED
```

---

## 2. T20.15G / K / O / S evidence summary

| Eval | Percent | Cohort proof | Transcript | Fallback | Hybrid p95 | Restored |
|------|---------|--------------|------------|----------|------------|----------|
| G (1%) | 1 | bucket 0 only | 27/27 | 11.1% | 223 ms | **0** |
| K (5%) | 5 | buckets 0, 1 + buyer control | 27/27 | 11.1% | 355 ms | **0** |
| O (10%) | 10 | buckets 0–9 + bucket10 control | 27/27 | 11.1% | 224 ms | **0** |
| S (25%) | 25 | buckets 0–24 + bucket25 control | 27/27 | 11.1% | 1052 ms | **0** |

All evals: anchored **16/16**, pure **8/16**, telemetry WARNs **0**, leakage **PASS**, canary errors **0**.

Contract user (bucket 15) correctly uses **allowlist** path at all percent values.

---

## 3. T20.15T recommendation summary

- **Active state:** allowlist canary KEEP, `PERCENT=0`
- **T recommendation:** proceed to 50% **design only** (this document)
- **Not approved:** keeping PERCENT=25/50 active; vector production default

---

## 4. Decision boundary

| Rule | State |
|------|-------|
| T20.15U scope | **Design only** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **Remains 0** |
| T20.15V implementation | **NOT APPROVED** |
| T20.15W 50% eval | **NOT APPROVED** |

---

## 5. 50% rollout model (future — T20.15W only)

Same gate engine as F/N/R (no code change expected):

- `percentage_bucket(user_id)` SHA-256 → 0–99
- `PERCENT=50` → buckets **0–49** in cohort; bucket **≥50** excluded
- Allowlist **always overrides**
- Authenticated valid UUID only; owner scope required
- Anonymous/guest excluded; message-body paths excluded
- Prod blocked unless `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=1`

### Additional cohort users required for T20.15W

| Bucket range | Test need |
|--------------|-----------|
| 0–24 | Proven at 25% (S) |
| 25–49 | At least one user (e.g. bucket 30, 40) → in cohort at 50% |
| ≥50 | Non-allowlisted control → keyword_default at PERCENT=50 |

Reuse: `t20-15g-cohort0`, `t20-15k-cohort1`, `buyer-contract`, `t20-15o-bucket10`, `t20-15s-bucket20`.

Create if needed: bucket 30–49 cohort user and bucket ≥50 non-allowlisted control.

---

## 6. Proposed future env (T20.15W eval window only)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_PERCENT=50
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

**Do not set in T20.15U.**

---

## 7. Required gates before T20.15V

| Gate | Requirement |
|------|-------------|
| T20.15S evidence | Reviewed; still valid or fresh rerun |
| D-T rollback | PASS or rerun |
| Allowlist soak | 27/27 HTTP 200 |
| Telemetry WARNs | 0 |
| Leakage | PASS |
| Fallback | ≤ 15% |
| Hybrid p95 | ≤ 3000 ms |
| Anchored overlap | ≥ 10/16 |
| Canary errors | 0 |
| Percent before/after V | **0** |

---

## 8. Proposed T20.15V (NOT APPROVED)

Verification-only unless gaps found:

- Tests for `percent=50` (buckets 0–49 in, 50+ out)
- Deploy with **PERCENT=0**
- D-T drill PASS
- No image rebuild if no runtime changes

---

## 9. Proposed T20.15W 50% eval (NOT APPROVED)

1. Preflight at PERCENT=0  
2. Set PERCENT=50 (dev/staging only)  
3. Proof paths: allowlist, cohort buckets 0–49, non-cohort ≥50  
4. 3× allowlist transcript + cohort prompt matrix (≥4 prompts per cohort user)  
5. Shadow timing, Playwright (Lane C control), telemetry, contracts, RP, source diagnostic (Lane C)  
6. **Restore PERCENT=0** on any failure or after eval (default)

---

## 10. Rollback (under 5 minutes)

Same as T20.15L/P/T: percent-only off → full hybrid off → image pin `t20-p215f` / `t20-p215b2`.

---

## 11. Stop condition

```text
T20.15U 50% hybrid canary design: COMPLETE
T20.15V implementation: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
Hybrid allowlist canary: KEEP
Production default: keyword
Vector production default: NOT APPROVED
```

---

## Required next approval phrase

```text
Approved: start T20.15V 50 percent hybrid canary implementation percent-zero only
```

---

## References

- `docs/ai-platform/T20-15T-hybrid-canary-25percent-decision-package.md`
- `docs/ai-platform/T20-15S-25percent-hybrid-canary-eval.md`
- `docs/ai-platform/T20-15Q-25percent-hybrid-canary-design.md`
