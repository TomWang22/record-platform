# T20.40G — N=5 24-window real-participant depth closeout

**Status:** T20.40 **CLOSED PASS**  
**Generated:** 2026-07-04  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Verdict

```text
T20.40: CLOSED PASS
N=5 artifact: PASS
T20.40C-LIVE: 6480/6480 HTTP 200, 0% fallback
Rollback: PASS
Telemetry/OCH/Playwright: PASS
Decision: C KEEP selected, D recommended, E rejected
```

---

## 2. Commit map

| Step | Commit | Message |
|------|--------|---------|
| T20.40A | `dbe4c6c` | `docs(ai): T20.40A broader real-participant readiness decision design` |
| T20.40B | `de2b1e5` | `docs(ai): T20.40B N5 real-participant depth validator PASS` |
| T20.40C-LIVE | `9c9dadd` | `feat(ai): T20.40C N5 24-window real-participant depth eval PASS` |
| T20.40D | `618540e` | `docs(ai): T20.40D N5 depth rollback drill PASS` |
| T20.40E/F | `87e169c` | `docs(ai): T20.40E telemetry audit and T20.40F decision C KEEP` |
| T20.40G | `(this commit)` | `docs(ai): T20.40G closeout and Phase 21 reconciliation` |

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
| Matrix | `24 windows × 5 participants × 5 runs × 9 cases + contract control` |
| Total cases | **6480** |
| HTTP 200 | **6480/6480** |
| Fallback | **0.0%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality | **4.0** |
| Worst quality | **4.0** |
| Hybrid p50 | **40.01 ms** |
| Hybrid p95 | **164.39 ms** |
| Keyword p50 | **63.92 ms** |
| Keyword p95 | **465.75 ms** |
| Gate counts | `preview_opt_in=5400`, `allowlist=1080` |
| Retrieval mode | `hybrid_canary=6480` |
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
| OCH | **PASS** (`__SCANNED__=589`) |
| Telemetry WARNs | **0** |
| Record score | **3.86** |
| Longform score | **3.67** |
| Final turn score | **4** |

---

## 7. Cumulative live evidence

```text
Prior cumulative: 37665/37665 HTTP 200, 0% fallback
T20.40C: 6480/6480 HTTP 200, 0% fallback
New cumulative: 44145/44145 HTTP 200, 0% fallback
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
Staging/test/e2e/t20/contract/load/generated/disposable users counted: NO
```

---

## 9. Next approval phrase

```text
Approved: start T20.41A N5 opt-in hybrid preview production-readiness decision design only
```

