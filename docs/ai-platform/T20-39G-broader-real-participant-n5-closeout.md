# T20.39G — Broader real-participant N=5 closeout

**Status:** T20.39 **CLOSED PASS**  
**Generated:** 2026-07-03  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Verdict

```text
T20.39: CLOSED PASS
N=5 artifact: PASS
T20.39C-LIVE: 4320/4320 HTTP 200, 0% fallback
Rollback: PASS
Telemetry/OCH/Playwright: PASS
Decision: C KEEP selected, D recommended, E rejected
```

---

## 2. Commit map

| Step | Commit | Message |
|------|--------|---------|
| T20.39B3 | `5564507` | `feat(ai): T20.39B3 provision owner-approved internal staff participants` |
| T20.39B RERUN | `1e0feab` | `docs(ai): T20.39B validator PASS for N=5 expansion` |
| T20.39C-LIVE | `a19ca87` | `feat(ai): T20.39C N=5 real-participant live eval PASS` |
| T20.39D | `fbd6574` | `docs(ai): T20.39D rollback drill PASS` |
| T20.39E/F | `4f29b00` | `docs(ai): T20.39E telemetry audit and T20.39F decision C KEEP` |
| T20.39G | `(this commit)` | `docs(ai): T20.39G closeout and Phase 21 reconciliation` |

---

## 3. Participants counted

| # | Email | UUID | Type |
|---|-------|------|------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff |
| 4 | phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | internal_staff |
| 5 | phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | internal_staff |

Proof:

```text
T20_MIN_PARTICIPANT_ROWS=5 scripts/audit-real-participant-artifact.sh
participant rows validated (5)
JWT sub match for all participants
staging cohort excluded from artifact rows
PASS
```

No `@record-platform.local`, `t20-*`, `e2e-*`, contract, auth-test, k6/load, benchmark, or staging cohort users were counted as real/internal participants.

---

## 4. C-LIVE metrics

| Metric | Result |
|--------|--------|
| Matrix | `16 windows × 5 participants × 5 runs × 9 cases + contract control` |
| Total cases | **4320** |
| HTTP 200 | **4320/4320** |
| Fallback | **0.0%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality | **4.0** |
| Worst quality | **4.0** |
| Hybrid p95 | **131.99 ms** |
| Gate counts | `preview_opt_in=3600`, `allowlist=720` |
| `keyword_default` during matrix | **0** |
| Canary errors | **0** |
| Leakage | **PASS** |
| Post-revoke | **all 5 keyword_default PASS** |

---

## 5. Rollback proof

| Drill | Result |
|-------|--------|
| UI enroll/revoke | **PASS** (`tom@example.com`) |
| API enroll/revoke | **PASS** (`tw5126@example.com`) |
| Bulk revoke all 5 | **PASS** |
| Contract control after bulk revoke | **PASS** (`hybrid_canary` / `allowlist`) |
| `CANARY=0` contract + participant | **PASS** (`keyword`) |
| KEEP restore | **PASS** |

---

## 6. Telemetry/OCH/Playwright

| Gate | Result |
|------|--------|
| Preview UI smoke | **4/4 PASS** |
| Full C-suite | **7/7 PASS** |
| OCH | **PASS** (`__SCANNED__=589`) |
| Telemetry WARNs | **0** |
| Record score | **3.86** |
| Longform score | **3.67** |
| Final turn score | **4** |

---

## 7. Cumulative live evidence

```text
Previous cumulative: 33345/33345 HTTP 200, 0% fallback
T20.39C: 4320/4320 HTTP 200, 0% fallback
New cumulative: 37665/37665 HTTP 200, 0% fallback
```

---

## 8. Final env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
Preview UI/API: KEEP
```

Hard stops honored:

```text
Permanent allowlist broadened: NO
PERCENT > 0: NO
Hybrid production default: NOT APPROVED
Vector production default: NOT APPROVED
Message bodies exposed: NO
Anonymous/guest hybrid access: NO
Keyword fallback removed: NO
Overlap anchors removed: NO
```

---

## 9. Next approval phrase

```text
Approved: start T20.40A broader real-participant opt-in hybrid preview readiness decision design only
```

