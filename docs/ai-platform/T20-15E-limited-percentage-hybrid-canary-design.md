# T20.15E — Limited percentage hybrid canary design

**Status:** Design complete (docs only — no implementation, no env change)  
**Generated:** 2026-06-29  
**Baseline SHA:** `fbe8013` (T20.15D-T complete)  
**Image:** `python-ai-service:t20-p215b2`  
**Parent:** T20.15D-T — allowlist canary KEEP, control + rollback PASS

---

## Purpose

Design the **next evidence stage** after allowlist-only hybrid canary: a **bounded percentage gate** for additional users in dev/staging. This document does **not** authorize implementation, env changes, or traffic shift.

```text
This is hybrid canary evidence collection — NOT vector production rollout.
```

---

## 1. Current evidence summary

Evidence from T20.15D-S soak and T20.15D-T control/rollback drill.

### D-S soak (3 × 9 API runs)

| Metric | Result |
|--------|--------|
| HTTP 200 | **27/27** |
| hybrid_canary | **24/27** |
| keyword_fallback_from_hybrid | **3/27** (`final_tagged_plan` only) |
| avg / worst score | **3.78 / 2.0** |
| hybrid latency p50/p95 | **108 / 214 ms** |
| keyword latency p50/p95 | **225 / 317 ms** |
| pure / anchored overlap (shadow) | **8/16 / 16/16** |
| true zero-results | **0/16** |
| embed timeouts | **0** |
| canary errors | **0** |
| leakage failures | **0** |
| telemetry WARNs | **0** |
| Contracts / RP | **PASS** |

### D-T control and rollback

| Check | Result |
|-------|--------|
| Fake allowlist → `retrieval_mode=keyword` | **PASS** |
| Real allowlist → `hybrid_canary` | **PASS** |
| Rollback `AI_RAG_HYBRID_CANARY=0` → keyword | **PASS** |
| Final KEEP restore | **PASS** |

### Known caveat (documented, not blocking E design)

Playwright RAG suites assert `retrieval_mode=keyword` and fail when canary is ON for the allowlisted contract user. T20.15G eval must either run Playwright with percent=0 restore window or update acceptance criteria for hybrid-canary traffic only during eval — **not** during T20.15E.

---

## 2. Decision boundary

| Rule | State |
|------|-------|
| T20.15E scope | **Design only** |
| Allowlist canary | **Remains active** (`KEEP`) |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **Remains 0** |
| Production retrieval default | **keyword** |
| Vector production default | **NOT APPROVED** |
| T20.15F implementation | **NOT APPROVED** |
| T20.15G 1% eval | **NOT APPROVED** |

No code changes, no deployment env changes, no percentage traffic in T20.15E.

---

## 3. Percentage rollout model (future — T20.15F/G)

### Scope

| Constraint | Requirement |
|------------|-------------|
| Initial cap | **1% max** |
| Environment | **dev/staging only** unless owner explicitly approves prod percentage |
| Anonymous / guest | **Excluded** |
| Non-authenticated | **Excluded** |
| Missing owner scope | **Excluded** |
| Message-body retrieval paths | **Excluded** (existing privacy filters unchanged) |
| Selection method | **Deterministic hash of `user_id`**, not per-request random |
| Allowlist precedence | **Allowlist always wins** over percentage gate |

### Gate evaluation order (proposed)

```text
1. AI_RAG_HYBRID_CANARY != 1           → keyword_default
2. user_id in ALLOWLIST                → hybrid_canary (allowlist)
3. PERCENT == 0                        → keyword_default
4. user not authenticated / no scope   → keyword_default
5. hash(user_id) % 100 < PERCENT       → hybrid_canary (percentage)
6. else                                → keyword_default
```

### Deterministic hash (design sketch)

```python
# Pseudocode — T20.15F implementation only
def percentage_bucket(user_id: str) -> int:
    digest = hashlib.sha256(user_id.encode()).hexdigest()
    return int(digest[:8], 16) % 100

def in_percentage_cohort(user_id: str, percent: int) -> bool:
    return percent > 0 and percentage_bucket(user_id) < percent
```

Properties:

- Same user always same bucket across requests and pod restarts
- `PERCENT=1` → ~1% of hashed user_ids (not 1% of requests if users repeat)
- Allowlisted contract user always hybrid regardless of percent

---

## 4. Runtime gates

### Current (unchanged — T20.15E)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
```

### Proposed future only (T20.15G eval window — not active)

```text
AI_RAG_HYBRID_CANARY_PERCENT=1   # dev/staging only; restore to 0 after eval
```

**T20.15E does not set this.**

---

## 5. Hard acceptance gates before T20.15F implementation

All must pass (or fresh rerun PASS) before owner approves T20.15F:

| Gate | Threshold | Source |
|------|-----------|--------|
| D-S soak | PASS or fresh 3-run rerun PASS | T20.15D-S |
| D-T rollback drill | PASS | T20.15D-T |
| 3 fresh API transcript runs | 27/27 HTTP 200 | `rp-ai-hybrid-canary-transcript.sh` |
| Playwright seller / record / longform | PASS | strict-edge suites |
| telemetry WARNs | **0** | `ai-quality-telemetry-report.mjs` |
| leakage | **PASS** | RP + transcript |
| fallback rate | **≤ 15%** | API transcript aggregate |
| canary error count | **0** | API + shadow |
| hybrid p95 | **≤ 3000 ms** | transcript + shadow |
| anchored overlap | **≥ 10/16** | shadow bench |
| pure overlap | reported separately; **not** production blocker for hybrid | shadow bench |
| Owner approval | explicit phrase present | see §9 |

### Playwright note for T20.15F preflight

Before T20.15F, rerun Playwright with `AI_RAG_HYBRID_CANARY=0` OR document hybrid-aware assertions for allowlisted user — required for gate bundle consistency.

---

## 6. T20.15F proposed implementation plan (design only)

**NOT APPROVED.** Future steps when owner approves T20.15F:

| Step | Action |
|------|--------|
| F1 | Add `percentage_bucket(user_id)` + `in_percentage_cohort()` in `hybrid_canary.py` |
| F2 | Extend `evaluate_hybrid_canary_gate()` with `gate_reason`: `allowlist` \| `percentage` \| `keyword_default` |
| F3 | Reject `PERCENT > 0` in production namespace unless `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=1` (new safety env, default 0) |
| F4 | Telemetry: `gate_reason`, `percentage_bucket`, `percentage_cohort` in `hybrid_canary` diagnostics |
| F5 | Tests: hash stability; percent=0 → no percentage users; allowlist overrides percent; percent>0 blocked in tests without explicit flag |
| F6 | Deploy `t20-p215f` image with **`AI_RAG_HYBRID_CANARY_PERCENT=0`** unchanged |
| F7 | Run D-T-style control (fake allowlist + rollback) before any percent enable |
| F8 | **Do not** set percent > 0 in F — that is T20.15G only |

---

## 7. T20.15G proposed 1% eval plan (design only)

**NOT APPROVED.** Future eval window:

| Phase | Action |
|-------|--------|
| G1 | Preflight: all §5 gates PASS on current allowlist-only state |
| G2 | Set `AI_RAG_HYBRID_CANARY_PERCENT=1` (dev/staging only) |
| G3 | Keep allowlist active (contract user always hybrid) |
| G4 | Run 3× `rp-ai-hybrid-canary-transcript.sh` |
| G5 | Run shadow timing (1 run minimum) |
| G6 | Run Playwright (hybrid-aware or canary-off for Lane C subset) |
| G7 | Run telemetry + contracts + RP |
| G8 | Record: distinct users in percentage cohort, request count, fallback count, error count |
| G9 | **Restore `AI_RAG_HYBRID_CANARY_PERCENT=0`** immediately if any gate fails |
| G10 | Write `T20-15G-1percent-hybrid-canary-eval.md` → feeds T20.15H decision |

### T20.15H (future)

Decision package: KEEP allowlist + percent=0 \| KEEP allowlist + extend percent design \| ROLLBACK.

### T20.15I (future)

If T20.15H clean: **5% design only** — no implementation without new approval.

---

## 8. Rollback

Target: **under 5 minutes**.

### Percentage off only (keep allowlist canary)

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

### Verify

```bash
# retrieval_mode=keyword for non-allowlisted / canary-off
bash scripts/audit-rp-ai-rag-contract.sh
node scripts/ai-quality-telemetry-report.mjs
```

Image rollback pin: `python-ai-service:t20-p215b2` or prior `t20-p214g3r`.

---

## 9. Roadmap sequence (post-E)

```text
T20.15E  design percentage canary          ← this document (COMPLETE)
T20.15F  implement percentage gate, percent=0 deploy
T20.15G  1% eval window, restore on failure
T20.15H  decision package
T20.15I  if clean, 5% design only
```

This is **not** vector production rollout. Production default remains **keyword + rule-engine** until a future owner decision explicitly changes that — separate from hybrid canary evidence.

---

## Stop condition (T20.15E)

```text
T20.15E limited percentage hybrid canary design: COMPLETE
T20.15F implementation: NOT APPROVED
T20.15G percentage eval: NOT APPROVED
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (unchanged)
AI_RAG_HYBRID_CANARY_PERCENT=0 (unchanged)
```

---

## Required next approval phrase

```text
Approved: start T20.15F hybrid percentage gate implementation percent-zero only
```

---

## References

- `docs/ai-platform/T20-15A-hybrid-canary-design.md`
- `docs/ai-platform/T20-15D-S-hybrid-allowlist-canary-soak.md`
- `docs/ai-platform/T20-15D-T-hybrid-canary-control-and-rollback-drill.md`
- `docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md`
- `scripts/rp-ai-hybrid-canary-transcript.sh`
