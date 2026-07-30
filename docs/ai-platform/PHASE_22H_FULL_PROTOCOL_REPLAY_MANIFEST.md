# Phase 22H — full protocol replay manifest

**Status:** MANIFEST PASS (batch-spec complete; per-probe expansion rules defined)  
**Created:** 2026-07-05  
**Baseline HEAD:** `3442f1a`  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## Verdict

```text
Can exact 57105 manifest be reconstructed: YES (batch-spec level)
Per-probe row manifest: NOT COMMITTED — must be generated from batch specs + runner order
Phase 22C 7200/7200: protocol-parity SAMPLE only — not full 57105 replay evidence
Phase 21 H1 baseline: 57105/57105 HTTP/1.1 — remains authoritative H1 evidence
Full H2/H3 parity requires labeled 57105/57105 replay each — NOT YET RUN
```

Phase 22C’s **7200/7200** matrix must remain labeled separately. It does **not** satisfy “all protocols have the full 57105 live matrix.”

---

## Evidence separation (mandatory)

| Label | Count | Protocol | Role |
| ----- | ----: | -------- | ---- |
| Phase 21 H1 cumulative matrix | **57105/57105** | HTTP/1.1 live-runner stack | Historical baseline — **do not merge** |
| Phase 22C protocol-parity sample | **7200/7200** | H1/H2/H3 explicit | Sample only — **do not merge into 57105** |
| Phase 22H H2 replay (future) | **57105 target** | HTTP/2 explicit | Labeled replay — **not run** |
| Phase 22H H3 replay (future) | **57105 target** | HTTP/3 explicit | Labeled replay — **not run** |
| Combined labeled full-protocol (future) | **171315 target** | H1+H2+H3 each 57105 | **Never one unlabeled total** |

---

## Can we reconstruct the exact 57105 Phase 21 live matrix?

**YES at batch-spec level.** All **57105** probes decompose into **21 documented live batches** (D16→T20.42C) whose dimensions sum exactly to 57105. The **9-case prompt set**, **user UUIDs**, and **deterministic iteration order** for the main runner family are in-repo.

**Gaps before live H2/H3 replay:**

1. **No committed 57105-row JSONL/CSV manifest** — row-level manifest must be generated; local `bench_logs/` summaries exist but are not committed and are not the canonical manifest.
2. **Early segment T20.16D–T20.21B (2025 probes)** — documented in C-LIVE docs but **no in-repo replay scripts**; used **temporary allowlist expansion** (not preview enroll API) for T20.18C–T20.21B; T20.17C uses **10 runs** (not 5).
3. **Gate-path equivalence** — replay under hard stops (no allowlist broadening) requires adapter design for the 2025 early segment or owner-approved gate-path mapping.

---

## Cumulative composition (57105 = D16→T20.42C)

| # | Batch | Probes | Cumulative | Cohort class | Gate path |
| - | ----- | -----: | ---------: | ------------ | --------- |
| 1 | T20.16D-LIVE | 45 | 45 | contract allowlist | `allowlist` |
| 2 | T20.17C-LIVE | 90 | 135 | contract allowlist | `allowlist` |
| 3 | T20.18C-LIVE | 270 | 405 | staging 6-user temp allowlist | `allowlist` (temp expanded) |
| 4 | T20.19C-LIVE | 810 | 1215 | staging 6-user temp allowlist | `allowlist` (temp expanded) |
| 5 | T20.20C-LIVE | 540 | 1755 | staging 6-user temp allowlist | `allowlist` (temp expanded) |
| 6 | T20.21B-LIVE | 270 | 2025 | staging 6-user temp allowlist | `allowlist` (temp expanded) |
| 7 | T20.25D-LIVE | 540 | 2565 | staging 6-user preview | `preview_opt_in` + `allowlist` |
| 8 | T20.26C-LIVE | 270 | 2835 | staging 6-user preview | `preview_opt_in` + `allowlist` |
| 9 | T20.27E-LIVE | 270 | 3105 | staging 6-user preview | `preview_opt_in` + `allowlist` |
| 10 | T20.28C-LIVE | 1080 | 4185 | staging 6-user preview | `preview_opt_in` + `allowlist` |
| 11 | T20.29C-LIVE | 2160 | 6345 | staging 12-JWT preview | `preview_opt_in` + `allowlist` |
| 12 | T20.30C-LIVE | 3240 | 9585 | staging 12-JWT preview | `preview_opt_in` + `allowlist` |
| 13 | T20.31C-LIVE | 6480 | 16065 | staging 12-JWT preview | `preview_opt_in` + `allowlist` |
| 14 | T20.32C-LIVE | 8640 | 24705 | staging 12-JWT preview | `preview_opt_in` + `allowlist` |
| 15 | T20.36C-LIVE | 1440 | 26145 | N=3 real/internal + contract | `preview_opt_in` + `allowlist` |
| 16 | T20.37C-LIVE | 2880 | 29025 | N=3 real/internal + contract | `preview_opt_in` + `allowlist` |
| 17 | T20.38C-LIVE | 4320 | 33345 | N=3 real/internal + contract | `preview_opt_in` + `allowlist` |
| 18 | T20.39C-LIVE | 4320 | 37665 | N=5 real/internal + contract | `preview_opt_in` + `allowlist` |
| 19 | T20.40C-LIVE | 6480 | 44145 | N=5 real/internal + contract | `preview_opt_in` + `allowlist` |
| 20 | T20.41C-LIVE | 8640 | 52785 | N=5 real/internal + contract | `preview_opt_in` + `allowlist` |
| 21 | T20.42C-LIVE | 4320 | **57105** | N=5 real/internal + contract | `preview_opt_in` + `allowlist` |

**Staging historical evidence:** batches 1–14 → **24705/57105** (43.3%)  
**Real/internal participant evidence:** batches 15–21 → **32400/57105** (56.7%)

T20.33C, T20.34C, T20.35C were **BLOCKED** — **0 probes** added to cumulative.

---

## Batch dimension reference

### Early allowlist segment (2025 probes — no preview API)

| Batch | Windows | Users | Runs/user | Cases/run | Formula |
| ----- | ------: | ----: | --------: | --------: | ------- |
| T20.16D | 1 (implicit) | 1 contract | 5 | 9 | 1×5×9 = 45 |
| T20.17C | 1 (implicit) | 1 contract | **10** | 9 | 1×10×9 = 90 |
| T20.18C | 1 (implicit) | 6 temp allowlist | 5 | 9 | 6×5×9 = 270 |
| T20.19C | 3 | 6 temp allowlist | 5 | 9 | 3×6×5×9 = 810 |
| T20.20C | 2 | 6 temp allowlist | 5 | 9 | 2×6×5×9 = 540 |
| T20.21B | 1 | 6 temp allowlist | 5 | 9 | 1×6×5×9 = 270 |

### Preview-enroll segment (55080 probes — `t20-25d` family)

| Batch | Windows | Preview users | Contract | Runs | Cases | Total |
| ----- | ------: | ------------: | -------: | ---: | ----: | ----: |
| T20.25D | 2 | 5 | 1 | 5 | 9 | 540 |
| T20.26C | 1 | 5 | 1 | 5 | 9 | 270 |
| T20.27E | 1 | 5 | 1 | 5 | 9 | 270 |
| T20.28C | 4 | 5 | 1 | 5 | 9 | 1080 |
| T20.29C | 4 | 11 | 1 | 5 | 9 | 2160 |
| T20.30C | 6 | 11 | 1 | 5 | 9 | 3240 |
| T20.31C | 12 | 11 | 1 | 5 | 9 | 6480 |
| T20.32C | 16 | 11 | 1 | 5 | 9 | 8640 |
| T20.36C | 8 | 3 | 1 | 5 | 9 | 1440 |
| T20.37C | 16 | 3 | 1 | 5 | 9 | 2880 |
| T20.38C | 24 | 3 | 1 | 5 | 9 | 4320 |
| T20.39C | 16 | 5 | 1 | 5 | 9 | 4320 |
| T20.40C | 24 | 5 | 1 | 5 | 9 | 6480 |
| T20.41C | 32 | 5 | 1 | 5 | 9 | 8640 |
| T20.42C | 16 | 5 | 1 | 5 | 9 | 4320 |

Per-window lifecycle (preview batches): revoke all preview users → verify `keyword_default` → enroll → verify `preview_opt_in` → matrix → post-batch revoke.

---

## Users by cohort

### Contract control (all batches)

| Email | UUID | Role |
| ----- | ---- | ---- |
| e2e-contract@record-platform.local | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` | allowlist control only |

### Staging 6-user cohort (T20.18C–T20.28C)

Defined in `scripts/t20-25d-opt-in-preview-eval.py` → `DEFAULT_USERS` (6 users including contract).

### Staging 12-JWT cohort (T20.29C–T20.32C)

Defined in `scripts/t20-25d-opt-in-preview-eval.py` → `PARTICIPANT_12_USERS` (12 users including contract).

### N=3 real/internal (T20.36C–T20.38C)

Defined in `scripts/t20-25d-opt-in-preview-eval.py` → `REAL_PARTICIPANT_36_USERS` + contract.

### N=5 real/internal (T20.39C–T20.42C)

Defined in `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` (artifact SHA locked).

| Email | UUID | Type |
| ----- | ---- | ---- |
| tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved |
| tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff |
| seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff |
| phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | internal_staff |
| phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | internal_staff |

**Not counted as real participants:** contract user, staging JWT cohort, t20-* / *-contract@* accounts.

---

## Case / prompt set (9 cases — Phase 21 matrix)

Source: `scripts/t20-25d-opt-in-preview-eval.py` → `PROMPTS` (fixed order):

| case_id | Purpose |
| ------- | ------- |
| listing_advice | Seller listing attention |
| negotiation_strategy | OBO / offer strategy |
| buyer_psychology | Buyer posture (grounded) |
| auction_pressure | Auction urgency |
| collector_metadata | Metadata gaps |
| pricing_strategy | Pricing raise/hold/review |
| daily_action_plan | Prioritized seller actions |
| red_team_overclaim | Grounded vs missing evidence self-review |
| final_tagged_plan | 10-bullet tagged plan |

**Phase 22B/22C response-intelligence cases (5 cases) are a different, smaller set.** Full 57105 replay must use the **9-case Phase 21 set**, not the 22C 5-case set.

Deterministic probe order (preview batches): `for window → for user (USERS list order) → for run → for case_id (PROMPTS order)`.

---

## Runners / scripts inventory

| Batch range | In-repo runner | Transport |
| ----------- | -------------- | --------- |
| T20.16D–T20.21B | **None** — C-LIVE docs + `bench_logs/ai-platform/hybrid-canary-transcript/` local only | HTTP/1.1 (`urllib`) |
| T20.25D | `scripts/t20-25d-opt-in-preview-eval.py` | HTTP/1.1 |
| T20.26C | `scripts/t20-26c-ui-readiness-eval.py` → delegates to t20-25d | HTTP/1.1 |
| T20.27E | (doc-only; t20-25d env) | HTTP/1.1 |
| T20.28C | `scripts/t20-28c-post-ui-soak-eval.py` | HTTP/1.1 |
| T20.29C | `scripts/t20-29c-participant-soak-eval.py` | HTTP/1.1 |
| T20.30C | `scripts/t20-30c-expanded-soak-eval.py` | HTTP/1.1 |
| T20.31C | (doc-only; t20-25d env) | HTTP/1.1 |
| T20.32C | (doc-only; t20-25d env) | HTTP/1.1 |
| T20.36C | `scripts/t20-36c-real-participant-soak-eval.py` | HTTP/1.1 |
| T20.37C | `scripts/t20-37c-real-participant-extension-soak-eval.py` | HTTP/1.1 |
| T20.38C | `scripts/t20-38c-broader-real-participant-depth-soak-eval.py` | HTTP/1.1 |
| T20.39C | `scripts/t20-39c-broader-real-participant-n5-soak-eval.py` | HTTP/1.1 |
| T20.40C | `scripts/t20-40c-n5-real-participant-depth-eval.py` | HTTP/1.1 |
| T20.41C | `scripts/t20-41c-n5-production-readiness-depth-eval.py` | HTTP/1.1 |
| T20.42C | `scripts/t20-42c-n5-production-readiness-final-verification-eval.py` | HTTP/1.1 |

**Not part of 57105:** `scripts/t20-15g-eval-runner.py`, `t20-15k-eval-runner.py`, `t20-15o-eval-runner.py` (percent-ladder evals; separate evidence).

**Phase 22C sample runner:** `scripts/phase22c-real-inference-protocol-parity-matrix.mjs` — **7200 probes, 5 cases** — not a 57105 replay runner.

---

## Local bench logs (not committed)

| Location | Contents | Committed |
| -------- | -------- | --------- |
| `bench_logs/ai-platform/t20-*` | Per-batch `summary.json` with case arrays | **NO** |
| `bench_logs/ai-platform/hybrid-canary-transcript/` | Early T20.16–T20.21 transcripts | **NO** |
| `bench_logs/ai-platform/phase22/` | Phase 22C matrix summary | **NO** |
| `bench_logs/ai-platform/live-inference/` | Misc inference logs | **NO** |

~305 local `summary.json` files exist; they support audit but are **not** the canonical replay manifest and must not be committed.

---

## KPI / observability gaps (no invented values)

| KPI | Status |
| --- | ------ |
| Recommendation usefulness over time | Partial — quality_score in matrix rows; no longitudinal dashboard |
| Retrieval latency by protocol/workflow | Phase 22C captured H1/H2/H3 sample; full 57105 replay not run |
| Ingestion pipeline KPI | **Gap** — see `PHASE_22_KPI_OBSERVABILITY_READINESS.md` |
| Data-to-searchable KPI | **Gap** — no `searchable_verified_at` / `arrival_to_searchable_ms` in standard path |
| Operational health / error rate / uptime | RP PASS at Phase 21 closeout; no continuous export for replay |

---

## Manifest PASS criteria

```text
Batch arithmetic sums to 57105: PASS
All batch dimensions documented: PASS
9-case prompt set in-repo: PASS
User UUIDs for all cohorts in-repo: PASS
Deterministic expansion rules defined: PASS
Committed 57105-row manifest file: NOT PRESENT (generate before 22I)
Early-segment replay scripts: NOT PRESENT (adapter required)
Phase 22C ≠ full parity: ACKNOWLEDGED
```
