# T20.40C-LIVE — N=5 24-window real-participant depth evaluation

**Status:** C-LIVE **PASS**  
**Generated:** 2026-07-04  
**Baseline SHA:** `11cdb08`  
**Participant artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`  
**Summary artifact:** `bench_logs/ai-platform/t20-40c-n5-real-participant-depth-eval/20260704-113238/summary.json`

---

## 1. Verdict

```text
T20.40C-LIVE: PASS
HTTP 200: 6480/6480
Fallback: 0%
Gate counts: preview_opt_in 5400, allowlist 1080
Post-revoke keyword_default: PASS for all 5 participants
```

T20.40C ran Option C only. No participant expansion, allowlist broadening, percentage rollout, or production-default change was performed.

---

## 2. Matrix

```text
24 windows × 5 real/internal participants × 5 runs/user/window × 9 cases/run = 5400 preview_opt_in
24 windows × 1 contract control × 5 runs/window × 9 cases/run = 1080 allowlist
Total = 6480
```

Counted participants:

| Email | UUID | Type | Matrix role |
|-------|------|------|-------------|
| tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved | preview_opt_in |
| tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff | preview_opt_in |
| seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff | preview_opt_in |
| phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | internal_staff | preview_opt_in |
| phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | internal_staff | preview_opt_in |
| e2e-contract@record-platform.local | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` | contract control | allowlist |

The contract user remained control-only and was not counted as a real/internal participant.

---

## 3. Live gates

| Gate | Result |
|------|--------|
| HTTP 200 | **6480/6480 PASS** |
| Fallback count | **0 PASS** |
| Fallback rate | **0.0% PASS** |
| `final_tagged_plan` fallback | **0 PASS** |
| Avg quality | **4.0 PASS** |
| Worst quality | **4.0 PASS** |
| Hybrid p50 | **40.01 ms** |
| Hybrid p95 | **164.39 ms PASS** |
| Keyword p50 | **63.92 ms** |
| Keyword p95 | **465.75 ms** |
| Canary errors | **0 PASS** |
| Leakage | **PASS** |
| Message-body exposure | **0 PASS** |
| `preview_opt_in` gate count | **5400 PASS** |
| `allowlist` gate count | **1080 PASS** |
| `keyword_default` during matrix | **0 PASS** |
| Retrieval mode count | `hybrid_canary`: **6480 PASS** |
| Per-user HTTP 200 | **1080/1080 each PASS** |
| PERCENT=0 | **PASS** |

---

## 4. Lifecycle proof

The live runner fail-fast lifecycle check ran for every window:

```text
1. Revoke all 5 preview participants.
2. Verify all 5 return keyword / keyword_default.
3. Enroll all 5 via preview API.
4. Verify preview status and RAG probe return hybrid_canary / preview_opt_in.
5. Verify contract control returns hybrid_canary / allowlist.
6. Verify PERCENT=0 and ALLOW_PROD_PERCENT=0.
7. Run 9-case transcript matrix for all participants and contract control.
```

Post-eval revoke proof:

```text
tom@example.com keyword keyword_default
tw5126@example.com keyword keyword_default
seed@example.com keyword keyword_default
phase21-preview-internal-1@example.com keyword keyword_default
phase21-preview-internal-2@example.com keyword keyword_default
e2e-contract@record-platform.local hybrid_canary allowlist
```

---

## 5. Post-live gates

| Gate | Result |
|------|--------|
| OCH | **PASS** (`__SCANNED__=589`) |
| Telemetry WARNs | **0 PASS** |
| Full Playwright C-suite | **7/7 PASS** |
| Record score | **3.86** |
| Longform score | **3.67** |
| Final turn score | **4** |

---

## 6. Cumulative live evidence

```text
Prior: 37665/37665
T20.40C: 6480/6480
New cumulative: 44145/44145
```

Fallback remains 0% cumulatively.

---

## 7. Hard stops honored

```text
Permanent allowlist broadened: NO
AI_RAG_HYBRID_CANARY_PERCENT above 0: NO
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT above 0: NO
Hybrid production default: NOT APPROVED
Vector production default: NOT APPROVED
Message bodies exposed: NO
Anonymous/guest hybrid access: NO
Keyword fallback and overlap anchors: retained
```

