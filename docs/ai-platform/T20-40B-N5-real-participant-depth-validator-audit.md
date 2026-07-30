# T20.40B — N=5 real-participant depth validator audit

**Status:** Validator audit **PASS**  
**Generated:** 2026-07-03  
**Baseline HEAD:** `dbe4c6c`  
**Participant artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Status/verdict

```text
T20.40B: PASS — N=5 depth validator audit
T20.40C-LIVE: NOT RUN
```

T20.40B ran validator, runtime/env, preflight, telemetry, and preview UI smoke gates only. No T20.40C live evaluation was run, and no runtime/env/image/default/allowlist changes were made.

---

## 2. Baseline

| Item | Value |
|------|-------|
| Baseline HEAD | `dbe4c6c` |
| Participant artifact path | `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` |
| Artifact SHA256 | `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa` |
| Counted participants | `N=5` |
| Production default | `keyword` |
| `AI_RAG_HYBRID_CANARY_PERCENT` | `0` |
| `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT` | `0` |
| Latest cumulative live | `37665/37665` HTTP 200, `0%` fallback |

Baseline verification:

```text
git rev-parse --short HEAD
dbe4c6c

shasum -a 256 docs/ai-platform/T20-35-owner-approved-real-preview-participants.md
1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

---

## 3. Participant table

| # | Email | UUID / JWT sub | Participant type | JWT sub match |
|---|-------|----------------|------------------|---------------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved | PASS |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff | PASS |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff | PASS |
| 4 | phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | internal_staff | PASS |
| 5 | phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | internal_staff | PASS |

Artifact validator result:

```text
artifact_sha256=1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
participant rows validated (5)
JWT sub match for all participants
staging cohort excluded from artifact rows
audit-real-participant-artifact: PASS
```

Contract user:

```text
e2e-contract@record-platform.local / 2ed75568-7deb-4c29-91b0-6919f24a0c9f
```

The contract user remains control-only and does not count as a real/internal participant.

Artifact hard-stop fields:

```text
Message bodies exposed: NO
Production default approved: NO
PERCENT > 0 approved: NO
```

---

## 4. Rejected account classes

The validator/audit rejects these account classes as counted real/internal participants:

- `@record-platform.local`
- `t20-*`
- `e2e-*`
- `*-contract`
- `auth-test-*`
- `microservice-test-*`
- `test-*`
- `k6-*`
- benchmark/load/generated/disposable accounts

No staging/test/e2e/t20/contract/load/generated/disposable accounts were counted in the N=5 participant table.

---

## 5. Runtime/env verification

Runtime image and KEEP env verification:

```text
python-ai-service:t20-p225b
webapp:t20-p227b
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Production default remains `keyword`. Preview UI/API remains KEEP. Permanent allowlist remains the contract user only.

---

## 6. Preflight results

| Gate | Result |
|------|--------|
| `scripts/audit-rp-ai-rag-contract.sh` | PASS |
| `scripts/rp-ai-rag-quality-smoke.sh` | PASS |
| `scripts/audit-rp-ai-endpoints-contract.sh` | PASS |
| `scripts/rp-ai-provider-readiness.sh` | PASS |
| `scripts/rp-ai-pgvector-readiness.sh` | PASS |
| `scripts/rp-rp-decontaminate-scan.sh` | PASS (`__SCANNED__=590`) |
| `scripts/ai-quality-telemetry-report.mjs` | PASS via `node scripts/ai-quality-telemetry-report.mjs`; WARNs 0 |

Note: direct shell execution of `scripts/ai-quality-telemetry-report.mjs` returned a file permission error before telemetry logic ran. The validator did not change script file modes; it executed the same telemetry script through `node`, which passed with WARNs 0.

Telemetry:

```text
WARNs (0): none
Scores — record: 3.86, longform: 3.67, final turn: 4
```

---

## 7. Preview UI smoke

Preview UI smoke result:

```text
npx playwright test e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts
4 passed
```

Cases passed:

- Cohort user enrolls, receives `preview_opt_in` RAG, and revokes to `keyword_default`.
- Contract allowlist user shows informational state and allowlist gate.
- Guest has no preview card on `/insights`.
- Preview status endpoint returns structured payload.

---

## 8. Selected next matrix

T20.40C-LIVE was not run. The approved next live path would be Option C only after separate approval:

```text
24 windows × 5 participants × 5 runs × 9 cases = 5400 preview_opt_in
24 windows × 1 contract control × 5 runs × 9 cases = 1080 allowlist
Total = 6480
```

Option C uses the current N=5 artifact if it remains fresh and validator PASS is re-confirmed as needed.

---

## 9. Stop rule

```text
STOP before T20.40C-LIVE. Live eval requires separate approval.
```

T20.40B does not authorize T20.40C-LIVE, hybrid/vector production default, percent rollout, permanent allowlist broadening, message-body exposure, anonymous/guest hybrid access, or staging/test cohort relabeling.

---

## 10. Next approval phrase

```text
Approved: start T20.40C-LIVE N=5 24-window real-participant depth evaluation only after T20.40B validator PASS
```

