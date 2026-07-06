# Phase 22H — full protocol replay design

**Status:** DESIGN PASS — manifest complete; live replay **NOT AUTHORIZED**  
**Created:** 2026-07-05  
**Prerequisite:** `PHASE_22H_FULL_PROTOCOL_REPLAY_MANIFEST.md` PASS  
**Baseline HEAD:** `e1b04a3`

---

## Objective

Design labeled **HTTP/2** and **HTTP/3** full replay of the Phase 21 **57105/57105** live matrix without re-running HTTP/1.1 and without claiming Phase 22C **7200/7200** as full parity.

Target labeled evidence after future live approval:

```text
Phase 21 H1 baseline: 57105/57105  (exists — do not re-run)
Phase 22I H2 replay:  57105/57105  (NOT RUN)
Phase 22J H3 replay:  57105/57105  (NOT RUN)
Total labeled full-protocol evidence: 171315/171315
```

Do **not** merge into one unlabeled cumulative total.

---

## Why Phase 22C is insufficient

| Evidence | Count | Scope |
| -------- | ----: | ----- |
| Phase 22C | 7200 | 3 protocols × 16 windows × 6 users × 5 runs × **5 cases** |
| Phase 21 | 57105 | 21 batches × **9 cases** × varied windows/users |

Phase 22C proves protocol negotiation and response intelligence on a **sample**. Full parity requires **57105 labeled replay per protocol**.

---

## Proposed runner architecture (design only)

### New scripts (future — not created in 22H)

```text
scripts/phase22h-generate-replay-manifest.mjs     # expand 57105 rows from batch specs
scripts/phase22i-h2-full-protocol-replay.mjs      # HTTP/2 replay only (57105)
scripts/phase22j-h3-full-protocol-replay.mjs    # HTTP/3 replay only (57105)
```

Build on patterns from:

- `scripts/t20-25d-opt-in-preview-eval.py` — batch dimensions, 9 cases, lifecycle
- `scripts/phase22c-real-inference-protocol-parity-matrix.mjs` — explicit `--http2` / `--http3-only` via curl

### CLI surface (planned)

```text
--manifest <path>           # generated 57105-row manifest
--batch <id>                # optional single-batch replay
--protocol h2|h3            # required; no default "all"
--write-jsonl <path>        # redacted rows only
--summary <path>
--fail-fast
--dry-run                   # manifest validation only
```

### Manifest row schema (generated)

```text
probe_id, batch_id, window, run, case_id, user_class, participant_label,
expected_gate_reason, expected_retrieval_mode, question_ref, batch_gate_path
```

---

## Replay segments

### Segment A — Early allowlist (2025 probes)

Batches T20.16D–T20.21B.

| Challenge | Design response |
| --------- | --------------- |
| No in-repo scripts | Add `scripts/phase22h-early-allowlist-replay-adapter.mjs` before 22I |
| Temp 6-user allowlist (T20.18–21) | **Hard stop:** cannot broaden permanent allowlist. Options: (1) owner-approved gate-path equivalence doc mapping temp allowlist → contract-only replay with documented delta; (2) skip early segment in H2/H3 with explicit labeled partial replay **NOT APPROVED** without owner sign-off |
| T20.17C 10 runs | Adapter must honor 10 runs, not t20-25d default 5 |
| Gate = `allowlist` | No preview enroll lifecycle |

**Recommendation:** Require explicit owner decision on early-segment gate-path equivalence before 22I includes these 2025 probes. Default design: **include** with adapter that uses contract + staging JWT login only (no deployment allowlist patch) if gate_reason remains `allowlist` for contract and temp-cohort users can authenticate.

### Segment B — Preview enroll (55080 probes)

Batches T20.25D–T20.42C.

| Property | Value |
| -------- | ----- |
| Runner family | `t20-25d-opt-in-preview-eval.py` wrappers |
| Lifecycle | Per-window revoke → enroll → matrix → post-revoke |
| Gate | `preview_opt_in` (participants), `allowlist` (contract) |
| Replay | Map each batch to env vars (`T20_25D_WINDOWS`, `T20_EVAL_USER_SET`, artifact JSON for N=5) |

Existing wrapper scripts can be referenced for env defaults; H2/H3 runner invokes same probe schedule with curl transport.

---

## Per-probe validation (H2/H3 replay)

Each replay probe must assert:

```text
HTTP 200
negotiated protocol exactly HTTP/2 or HTTP/3
retrieval_mode expected (hybrid_canary)
gate_reason expected (preview_opt_in | allowlist)
fallback_count=0
response body exists
response body is not placeholder
response usefulness/rubric pass (9-case Phase 21 rubric)
sentiment pass when required (buyer_psychology case)
red_team_overclaim / final_tagged_plan safety pass
leakage failures=0
rag_total_ms captured
quality_score >= 3.5 if returned
```

Leakage markers (same as Phase 22C):

```text
proxy max bid, private message body, raw message body, hidden buyer message,
message_body, proxy_bids, max_bid_cents, authorization bearer, eyj, password
```

---

## KPI outputs (replay)

Redacted JSONL per probe; no raw response bodies.

Summary must include:

```text
response_pass_rate
sentiment_pass_rate (buyer_psychology)
red_team_safety_pass_rate
grounding_pass_rate
fallback_count
leakage_failures
rag_total_ms p50/p95/max by protocol and batch_id
rag_total_ms p50/p95/max by case_id
HTTP 200 counts by batch_id
gate counts by batch_id
recommendation usefulness trend (quality_score by batch_id — baseline capture)
```

Run summarizer:

```bash
PHASE22_KPI_INPUT_GLOB='<jsonl path>' \
node scripts/summarize-phase22-ai-kpis-readonly.mjs
```

### Observability gaps (document only — no invented values)

| KPI | Readiness |
| --- | --------- |
| Ingestion pipeline success rate | **NOT INSTRUMENTED** for replay path — see `PHASE_22_KPI_OBSERVABILITY_READINESS.md` |
| Data-to-searchable latency | **NOT INSTRUMENTED** — no `arrival_to_searchable_ms` in smoke |
| Operational uptime during replay | Manual cluster health check only |
| Recommendation usefulness over time | quality_score from replay rows; no historical TSDB |

---

## Execution plan (sequential — not approved yet)

### Phase 22H (this step) — COMPLETE

- Manifest PASS
- Design PASS
- No live matrix

### Phase 22I (future — requires approval phrase)

```text
Approved: start Phase 22I HTTP/2 full 57105 real-inference replay only after Phase 22H replay manifest PASS.
```

Steps:

1. Run `phase22h-generate-replay-manifest.mjs` → verify 57105 rows
2. Pre-live gates (archive, artifact, 22B smoke, env verify)
3. Implement early-segment adapter OR owner sign-off on segment exclusion
4. Run H2 replay only — **57105 probes**
5. Post-revoke + env verify
6. KPI summary → doc PASS/FAIL

Estimated duration: ~40× Phase 22C full matrix (~41 min for 7200) → **~5–7 hours** for 57105 at similar rate (order-of-magnitude; document actual after pilot).

### Phase 22J (future — after 22I PASS)

```text
Approved: start Phase 22J HTTP/3 full 57105 real-inference replay only after Phase 22I HTTP/2 replay PASS.
```

Same manifest; `--http3-only` only. Do **not** run H2 and H3 together unless explicitly approved.

---

## PASS gates (future live)

Phase 22I H2 PASS requires:

```text
HTTP 200: 57105/57105
Fallback: 0
Wrong negotiated protocol: 0
Wrong gate_reason: 0
keyword_default during matrix: 0 (preview batches)
Response pass: 100%
Red-team safety: 100%
Leakage: 0
Post-revoke keyword_default: PASS (N=5 batches only)
Contract allowlist: PASS
Final env unchanged
```

Phase 22J H3: same gates with HTTP/3 negotiated protocol.

---

## Hard stops (unchanged)

```text
No runtime/env/image/default/allowlist changes during 22H design
No PERCENT > 0
No ALLOW_PROD_PERCENT > 0
No hybrid/vector production default
No artifact edits
No user provisioning
No bench_logs / JWT / raw body commits
No counting Phase 22C 7200 as full 57105 parity
No claiming full protocol parity until H2=57105 AND H3=57105
No re-running HTTP/1.1 full matrix unless explicitly approved
```

---

## Verdict

```text
Phase 22H: DESIGN PASS
Manifest: PASS (batch-spec complete; generate row manifest before 22I)
H2 full replay: AUTHORIZED BY DESIGN — NOT RUN
H3 full replay: AUTHORIZED BY DESIGN — NOT RUN
Early-segment adapter: REQUIRED before 22I live
Phase 22C 7200: remains labeled sample only
```
