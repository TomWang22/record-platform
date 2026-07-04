# T20.39C-LIVE — Broader real-participant N=5 evaluation

**Status:** C-LIVE **PASS**  
**Generated:** 2026-07-03  
**Baseline SHA:** `1e0feab`  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`  
**Summary artifact:** `bench_logs/ai-platform/t20-39c-broader-real-participant-n5-eval/20260704-032203/summary.json`

---

## 1. Verdict

```text
T20.39C-LIVE: PASS
HTTP 200: 4320/4320
Fallback: 0%
Gate counts: preview_opt_in 3600, allowlist 720
Post-revoke keyword_default: PASS for all 5 participants
```

T20.39C ran the approved N=5 matrix only. No N=3 fallback soak was run.

---

## 2. Matrix

```text
16 windows × 5 real/internal participants × 5 runs/user/window × 9 cases/run = 3600 preview_opt_in
16 windows × 1 contract control × 5 runs/window × 9 cases/run = 720 allowlist
Total = 4320
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

---

## 3. Live gates

| Gate | Result |
|------|--------|
| HTTP 200 | **4320/4320 PASS** |
| Fallback rate | **0.0% PASS** |
| `final_tagged_plan` fallback | **0 PASS** |
| Avg quality | **4.0 PASS** |
| Worst quality | **4.0 PASS** |
| Hybrid p50 | **35.6 ms** |
| Hybrid p95 | **131.99 ms PASS** |
| Canary errors | **0 PASS** |
| Leakage | **PASS** |
| Message-body exposure | **0 PASS** |
| `preview_opt_in` gate count | **3600 PASS** |
| `allowlist` gate count | **720 PASS** |
| `keyword_default` during matrix | **0 PASS** |
| Retrieval mode count | `hybrid_canary`: **4320** |
| Per-user HTTP 200 | **720/720 each PASS** |

---

## 4. Lifecycle proof

Pre-eval revoke verified all five preview participants as `keyword` / `keyword_default`:

```text
tom@example.com keyword keyword_default
tw5126@example.com keyword keyword_default
seed@example.com keyword keyword_default
phase21-preview-internal-1@example.com keyword keyword_default
phase21-preview-internal-2@example.com keyword keyword_default
```

Post-eval revoke verified:

```text
e2e-contract@record-platform.local hybrid_canary allowlist
tom@example.com keyword keyword_default
tw5126@example.com keyword keyword_default
seed@example.com keyword keyword_default
phase21-preview-internal-1@example.com keyword keyword_default
phase21-preview-internal-2@example.com keyword keyword_default
```

---

## 5. Post-live gates

| Gate | Result |
|------|--------|
| Preview UI smoke | **4/4 PASS** |
| Full Playwright C-suite | **7/7 PASS** |
| OCH scan | **PASS** (`__SCANNED__=589`) |
| Telemetry WARNs | **0 PASS** |
| Record score | **3.86** |
| Longform score | **3.67** |
| Final turn score | **4** |

---

## 6. Cumulative live evidence

```text
Previous cumulative: 33345/33345 HTTP 200, 0% fallback
T20.39C: 4320/4320 HTTP 200, 0% fallback
New cumulative: 37665/37665 HTTP 200, 0% fallback
```

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

