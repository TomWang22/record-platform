# T20.15I — 5% hybrid canary design

**Status:** Design complete (docs only — no implementation, no env change)  
**Generated:** 2026-06-29  
**Baseline SHA:** `349317b` (T20.15H)  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15H — Option B active, Option C recommended

---

## 1. Executive verdict

```text
T20.15I 5% hybrid canary design: COMPLETE
Design only — no implementation
AI_RAG_HYBRID_CANARY_PERCENT remains 0
Hybrid allowlist canary: KEEP
Production default remains keyword
Vector production default: NOT APPROVED
T20.15J implementation: NOT STARTED
```

```text
This is hybrid canary evidence collection — NOT vector production rollout.
```

---

## 2. Evidence summary

### T20.14H1 / H2 — hybrid vector gate

| Source | Key result |
|--------|------------|
| T20.14H1 (5-run stability) | Pure **8/16** FAIL (stable); anchored **16/16** PASS; shadow p95 ≤1351 ms |
| T20.14H2 | Vector production default **NOT APPROVED**; hybrid anchored path for canary evidence only |

### T20.15D-S — allowlist soak

| Metric | Result |
|--------|--------|
| HTTP 200 | **27/27** |
| hybrid / fallback | **24/27** / **3/27** (`final_tagged_plan`) |
| avg score | **3.78** |
| hybrid p50 / p95 | **108 / 214 ms** |
| pure / anchored | **8/16 / 16/16** |
| canary errors / leakage / WARNs | **0 / PASS / 0** |

### T20.15D-T — rollback drill

Fake allowlist → keyword, restore → hybrid_canary, `CANARY=0` → keyword, final KEEP — **all PASS**.

### T20.15F — percentage gate (percent-zero deploy)

Deterministic `percentage_bucket`, `gate_reason` telemetry, `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0` default. Deployed `t20-p215f` with **PERCENT=0**. Hybrid tests **27/27 PASS**. Full docker unittest **282 PASS**, **4 ERROR** (unchanged from T20.15F — privacy integration signatures only).

### T20.15G — 1% eval PASS

| Proof | Result |
|-------|--------|
| Contract user (bucket 15) | `allowlist` path only at PERCENT=1 |
| Cohort0 user (bucket 0) | `percentage` path at PERCENT=1 |
| Buyer (bucket 9) | `keyword_default` control |
| Transcript | **27/27 HTTP 200**, fallback **11.1%** |
| Hybrid p50 / p95 | **93 / 223 ms** |
| Percent restored | **0** after eval |

### T20.15H — decision package

Option **B** active (allowlist + percent=0). Option **C** recommended (proceed to I design only). Rollback not indicated.

---

## 3. Why 5% is design-only

| Factor | Rationale |
|--------|-----------|
| 1% eval passed | Three-path proof works, but **sample is tiny** (1 cohort user, 4 cohort API calls) |
| Pure overlap | **8/16** — report-only; not a hybrid blocker but not production-grade vector signal |
| Anchored overlap | **16/16** — hybrid safety gate satisfied |
| Fallback rate | **11.1%** — below 15% gate but concentrated on `final_tagged_plan`; needs monitoring at 5% |
| Production default | **keyword** — unchanged; 5% is evidence collection only |
| PERCENT in I | **Must remain 0** — no env change in this ticket |

5% design prepares a **bounded eval window** (T20.15K) without authorizing implementation (T20.15J) or traffic shift.

---

## 4. 5% rollout model (future — T20.15K only)

Gate evaluation order (already implemented in T20.15F):

```text
1. AI_RAG_HYBRID_CANARY != 1           → keyword_default
2. user in ALLOWLIST                   → hybrid_canary, gate_reason=allowlist
3. PERCENT <= 0                        → keyword_default
4. unauthenticated / invalid UUID      → keyword_default
5. prod namespace + ALLOW_PROD != 1    → keyword_default, prod_percent_blocked
6. percentage_bucket(user_id) < PERCENT → hybrid_canary, gate_reason=percentage
7. else                                → keyword_default
```

| Constraint | Requirement |
|------------|-------------|
| Selection | **SHA-256** `percentage_bucket(user_id)` → 0–99 |
| Allowlist | **Always overrides** percentage |
| Auth | **Authenticated users only** (valid UUID JWT `sub`) |
| Owner scope | **Required** (same as F) |
| Anonymous / guest | **Excluded** |
| Message-body paths | **Excluded** (existing privacy filters) |
| Prod percent | **Blocked** unless `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=1` |
| PERCENT=5 | **Future eval window only** — not in T20.15I |

At PERCENT=5, ~5% of hashed user_ids enter the percentage cohort (not 5% of requests). Contract user (bucket 15) remains allowlist-only.

### Multi-bucket proof requirement (T20.15K)

G proved bucket **0** only. K must exercise:

- bucket **0** → in cohort
- bucket **≥5** (e.g. buyer bucket 9) → keyword_default
- allowlisted contract (bucket 15) → allowlist regardless of percent

---

## 5. Proposed future env (T20.15K eval window only)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=5
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
```

**Do not set this in T20.15I.** Current cluster remains **PERCENT=0**.

---

## 6. Required gates before T20.15J implementation

All must pass (or fresh rerun PASS) before owner approves T20.15J:

| Gate | Source / threshold |
|------|-------------------|
| T20.15G evidence reviewed | This design + G doc |
| D-T rollback valid | Rerun PASS or D-T doc still current |
| Canary transcript fresh | 3×9 → **27/27 HTTP 200** |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| Canary errors | **0** |
| Fallback rate | **≤ 15%** |
| Hybrid p95 | **≤ 3000 ms** |
| Anchored overlap | **≥ 10/16** |
| Percent before J | **0** |
| Percent after J deploy | **0** (J is percent-zero deploy only) |

---

## 7. Proposed T20.15J implementation plan (NOT APPROVED)

**Scope:** Code only if gaps exist; otherwise verify-only on `t20-p215f`.

| Step | Action |
|------|--------|
| J1 | Audit F implementation — percent=5 bucket math may already work via `_clamp_percent` |
| J2 | Add tests if missing: `percent=5` includes buckets 0–4; bucket 5 excluded; allowlist override; `prod_percent_blocked` |
| J3 | Verify `gate_reason` telemetry on all paths |
| J4 | Build `python-ai-service:t20-p215j` **only if code changed** |
| J5 | Deploy with **`AI_RAG_HYBRID_CANARY_PERCENT=0`** unchanged |
| J6 | D-T control drill + rollback PASS |
| J7 | **Do not** set PERCENT > 0 in J — that is T20.15K |

---

## 8. Proposed T20.15K 5% eval window (NOT APPROVED)

| Phase | Action |
|-------|--------|
| K0 | Preflight: all §6 gates at PERCENT=0 |
| K1 | Set `AI_RAG_HYBRID_CANARY_PERCENT=5` (dev/staging only) |
| K2 | Cohort proof: bucket 0 in cohort; bucket ≥5 keyword; allowlist hybrid |
| K3 | 3× `rp-ai-hybrid-canary-transcript.sh` (allowlist user) |
| K4 | ≥3 API prompts per cohort bucket user (reuse `t20-15g-cohort0` + non-cohort buyer) |
| K5 | 1× shadow timing |
| K6 | Playwright: seller intel (allowlist OK); record/longform via fake-allowlist Lane C control |
| K7 | Telemetry, contracts, OCH |
| K8 | Record: request count, cohort users, fallback count, errors, p50/p95, gate_reason counts |
| K9 | **Restore PERCENT=0** immediately on any gate failure or after eval (default) |

### K gates (same as G, stricter cohort coverage)

| Gate | Threshold |
|------|-----------|
| HTTP 200 (transcript) | 27/27 |
| Cohort API | all 200 |
| Fallback | ≤ 15% |
| Hybrid p95 | ≤ 3000 ms |
| WARNs | 0 |
| Leakage | PASS |
| Anchored overlap | ≥ 10/16 |
| Errors | 0 |

---

## 9. Rollback (under 5 minutes)

### Percent-only off

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

### Image rollback

```bash
kubectl -n record-platform set image deployment/python-ai-service \
  app=python-ai-service:t20-p215b2
# fallback: python-ai-service:t20-p214g3r
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

### Verify

```bash
bash scripts/audit-rp-ai-rag-contract.sh
node scripts/ai-quality-telemetry-report.mjs
# JWT spot: fake allowlist → keyword; restore → hybrid_canary for contract user
```

---

## 10. Stop condition

```text
T20.15I 5% hybrid canary design: COMPLETE
T20.15J implementation: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
Hybrid allowlist canary: KEEP
Production default: keyword
Vector production default: NOT APPROVED
```

---

## Required next approval phrase

```text
Approved: start T20.15J 5 percent hybrid canary implementation percent-zero only
```

---

## References

- `docs/ai-platform/T20-15E-limited-percentage-hybrid-canary-design.md`
- `docs/ai-platform/T20-15F-hybrid-percentage-gate-implementation.md`
- `docs/ai-platform/T20-15G-1percent-hybrid-canary-eval.md`
- `docs/ai-platform/T20-15H-hybrid-canary-decision-package.md`
