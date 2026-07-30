# T20.15M — 10% hybrid canary design

**Status:** Design complete (docs only — no implementation, no env change)  
**Generated:** 2026-06-29  
**Baseline SHA:** post T20.15L  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15L — recommends 10% design only

---

## 1. Executive verdict

```text
T20.15M 10% hybrid canary design: COMPLETE
Design only — no implementation
AI_RAG_HYBRID_CANARY_PERCENT remains 0
Hybrid allowlist canary: KEEP
Production default remains keyword
Vector production default: NOT APPROVED
T20.15N implementation: NOT STARTED
```

---

## 2. T20.15G / K evidence summary

| Eval | Percent | Cohort proof | Transcript | Fallback | Hybrid p95 | Restored |
|------|---------|--------------|------------|----------|------------|----------|
| G (1%) | 1 | bucket 0 only | 27/27 | 11.1% | 223 ms | **0** |
| K (5%) | 5 | buckets 0, 1 + buyer control | 27/27 | 11.1% | 355 ms | **0** |

Both evals: anchored **16/16**, pure **8/16**, telemetry WARNs **0**, leakage **PASS**, canary errors **0**.

Contract user (bucket 15) correctly uses **allowlist** path at all percent values.

---

## 3. T20.15H / L recommendation summary

- **Active state:** allowlist canary KEEP, `PERCENT=0`
- **L recommendation:** proceed to 10% **design only** (this document)
- **Not approved:** keeping PERCENT=5/10 active; vector production default

---

## 4. Decision boundary

| Rule | State |
|------|-------|
| T20.15M scope | **Design only** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **Remains 0** |
| T20.15N implementation | **NOT APPROVED** |
| T20.15O 10% eval | **NOT APPROVED** |

---

## 5. 10% rollout model (future — T20.15O only)

Same gate engine as F/J (no code change expected):

- `percentage_bucket(user_id)` SHA-256 → 0–99
- `PERCENT=10` → buckets **0–9** in cohort; bucket **≥10** excluded
- Allowlist **always overrides**
- Authenticated valid UUID only; owner scope required
- Anonymous/guest excluded; message-body paths excluded
- Prod blocked unless `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=1`

### Additional cohort users required for T20.15O

| Bucket range | Test need |
|--------------|-----------|
| 0–4 | Already proven at 5% |
| 5–9 | At least one user (e.g. bucket 7) → in cohort at 10% |
| ≥10 | buyer-contract bucket 9 → still in cohort at 10%; need bucket ≥10 control (e.g. bucket 15 contract is allowlist; use bucket 12+ non-allowlisted) |

Reuse: `t20-15g-cohort0`, `t20-15k-cohort1`, `buyer-contract` (bucket 9 → cohort at 10%).

Create if needed: bucket ≥10 non-allowlisted control user for keyword_default at PERCENT=10.

---

## 6. Proposed future env (T20.15O eval window only)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_PERCENT=10
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

**Do not set in T20.15M.**

---

## 7. Required gates before T20.15N

| Gate | Requirement |
|------|-------------|
| T20.15K evidence | Reviewed; still valid or fresh rerun |
| D-T rollback | PASS or rerun |
| Allowlist soak | 27/27 HTTP 200 |
| Telemetry WARNs | 0 |
| Leakage | PASS |
| Fallback | ≤ 15% |
| Hybrid p95 | ≤ 3000 ms |
| Anchored overlap | ≥ 10/16 |
| Canary errors | 0 |
| Percent before/after N | **0** |

---

## 8. Proposed T20.15N (NOT APPROVED)

Verification-only unless gaps found:

- Tests for `percent=10` (buckets 0–9 in, 10+ out)
- Deploy with **PERCENT=0**
- D-T drill PASS
- No image rebuild if no runtime changes

---

## 9. Proposed T20.15O 10% eval (NOT APPROVED)

1. Preflight at PERCENT=0  
2. Set PERCENT=10 (dev/staging only)  
3. Four-path proof: allowlist, cohort buckets 0–9, non-cohort ≥10  
4. 3× allowlist transcript + cohort prompt matrix  
5. Shadow timing, Playwright (Lane C control), telemetry, contracts, RP  
6. **Restore PERCENT=0** on any failure or after eval (default)

---

## 10. Rollback (under 5 minutes)

Same as T20.15H/L: percent-only off → full hybrid off → image pin `t20-p215f` / `t20-p215b2`.

---

## 11. Stop condition

```text
T20.15M 10% hybrid canary design: COMPLETE
T20.15N implementation: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
Hybrid allowlist canary: KEEP
Production default: keyword
Vector production default: NOT APPROVED
```

---

## Required next approval phrase

```text
Approved: start T20.15N 10 percent hybrid canary implementation percent-zero only
```

---

## References

- `docs/ai-platform/T20-15L-hybrid-canary-5percent-decision-package.md`
- `docs/ai-platform/T20-15K-5percent-hybrid-canary-eval.md`
- `docs/ai-platform/T20-15I-5percent-hybrid-canary-design.md`
