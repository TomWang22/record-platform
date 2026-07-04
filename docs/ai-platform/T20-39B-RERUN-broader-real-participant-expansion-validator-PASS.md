# T20.39B RERUN — Broader real-participant expansion validator

**Status:** Validator **PASS**  
**Generated:** 2026-07-03  
**Baseline SHA:** `5564507`  
**Artifact:** `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`

---

## 1. Verdict

```text
T20.39B RERUN: PASS — N=5 expansion validator satisfied
T20.39C-LIVE: AUTHORIZED BY GATE, NOT YET RUN IN THIS STEP
Artifact SHA256: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

The N=5 artifact gate is now satisfied. C-LIVE may proceed under the approved T20.39C N=5 matrix only.

---

## 2. Participant artifact

| Check | Result |
|-------|--------|
| Complete counted rows | **5** |
| JWT sub match | **5/5 PASS** |
| Staging/test/e2e/t20/contract users counted | **NO** |
| Message bodies exposed? | **NO** |
| Production default approved? | **NO** |
| PERCENT > 0 approved? | **NO** |

Counted participants:

| # | Email | UUID | Type | JWT sub match |
|---|-------|------|------|---------------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved | **PASS** |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff | **PASS** |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff | **PASS** |
| 4 | phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | internal_staff | **PASS** |
| 5 | phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | internal_staff | **PASS** |

---

## 3. Runtime env

| Check | Result |
|-------|--------|
| `AI_RAG_HYBRID_CANARY=1` | **PASS** |
| Single contract allowlist only | **PASS** |
| `AI_RAG_HYBRID_CANARY_PERCENT=0` | **PASS** |
| `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0` | **PASS** |
| Production default | `keyword` |

No permanent allowlist broadening, production-default change, runtime image change, or percent rollout was made.

---

## 4. Validator and preflight

| Gate | Result |
|------|--------|
| `T20_MIN_PARTICIPANT_ROWS=5 scripts/audit-real-participant-artifact.sh` | **PASS** |
| `scripts/audit-rp-ai-rag-contract.sh` | **PASS** |
| `scripts/rp-ai-rag-quality-smoke.sh` | **PASS** |
| `scripts/audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `scripts/rp-ai-provider-readiness.sh` | **PASS** |
| `scripts/rp-ai-pgvector-readiness.sh` | **PASS** |
| `scripts/rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=589`) |
| `scripts/ai-quality-telemetry-report.mjs` | **PASS** — WARNs 0 |
| Preview UI smoke | **PASS** — `ai-rag-opt-in-hybrid-preview-ui.spec.ts` 4/4 |

Telemetry output:

```text
WARNs (0): none
Scores — record: 3.86, longform: 3.67, final turn: 4
```

---

## 5. Stop rules honored

```text
T20.39C-LIVE: NOT RUN before validator PASS
N=3 fallback soak: NOT RUN
Runtime/env/images: unchanged
Allowlist: unchanged
PERCENT: 0
Production default: keyword
```

## 6. Next step

Proceed to T20.39C-LIVE with the approved N=5 matrix:

```text
16 windows × 5 real/internal participants × 5 runs/user/window × 9 cases/run = 3600 preview_opt_in
16 windows × 1 contract control × 5 runs/window × 9 cases/run = 720 allowlist
Total = 4320
```

