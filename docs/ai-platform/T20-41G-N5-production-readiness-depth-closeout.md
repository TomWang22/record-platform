# T20.41G — N=5 production-readiness depth closeout

**Status:** T20.41 **CLOSED PASS**  
**Generated:** 2026-07-04  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Verdict

```text
T20.41: CLOSED PASS
N=5 artifact: PASS
T20.41C-LIVE: 8640/8640 HTTP 200, 0% fallback
Rollback: PASS
Telemetry/OCH/Playwright: PASS
Decision: C KEEP selected, D recommended, E rejected
```

---

## 2. Commit map

| Step | Commit | Message |
|------|--------|---------|
| T20.41A | `e069c15` | `docs(ai): T20.41A N5 production-readiness decision design` |
| T20.41B | `bd3808c` | `docs(ai): T20.41B N5 production-readiness validator PASS` |
| T20.41C-LIVE | `1ed5af5` | `feat(ai): T20.41C N5 production-readiness depth eval PASS` |
| T20.41D | `2c17f6f` | `docs(ai): T20.41D N5 production-readiness rollback drill PASS` |
| T20.41E/F | `f9045de` | `docs(ai): T20.41E telemetry audit and T20.41F decision C KEEP` |
| T20.41G | `3e7a4b0` | `docs(ai): T20.41G closeout and Phase 21 reconciliation` |

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

The contract user `e2e-contract@record-platform.local` remained allowlist control only and was not counted as a real/internal participant.

---

## 4. Live metrics

| Metric | Result |
|--------|--------|
| Matrix | `32 windows × 5 participants × 5 runs × 9 cases + contract control` |
| Total cases | **8640** |
| HTTP 200 | **8640/8640** |
| Fallback | **0.0%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality | **4.0** |
| Worst quality | **4.0** |
| Hybrid p50 | **37.43 ms** |
| Hybrid p95 | **140.4 ms** |
| Keyword p50 | **61.51 ms** |
| Keyword p95 | **392.46 ms** |
| Gate counts | `preview_opt_in=7200`, `allowlist=1440` |
| Retrieval mode | `hybrid_canary=8640` |
| `keyword_default` during matrix | **0** |
| Canary errors | **0** |
| Leakage | **PASS** |
| Message-body exposure | **0** |
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
| Full C-suite | **7/7 PASS** |
| OCH | **PASS** (`__SCANNED__=105`) |
| Telemetry WARNs | **0** |
| Record score | **3.86** |
| Longform score | **3.67** |
| Final turn score | **4** |

---

## 7. Cumulative live evidence

```text
Prior cumulative: 44145/44145 HTTP 200, 0% fallback
T20.41C: 8640/8640 HTTP 200, 0% fallback
New cumulative: 52785/52785 HTTP 200, 0% fallback
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
ALLOW_PROD_PERCENT > 0: NO
Hybrid production default: NOT APPROVED
Vector production default: NOT APPROVED
Message bodies exposed: NO
Anonymous/guest hybrid access: NO
Keyword fallback removed: NO
Overlap anchors removed: NO
Participant artifact edited: NO
Users provisioned: NO
Staging/test/e2e/t20/contract/load/generated/disposable users counted: NO
```

---

## 9. Next approval phrase

```text
Approved: start T20.42A N5 opt-in hybrid preview production-readiness closeout design only
```
