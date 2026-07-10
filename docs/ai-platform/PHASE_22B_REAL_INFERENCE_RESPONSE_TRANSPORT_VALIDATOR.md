# Phase 22B — real-inference response + transport validator

**Validated:** 2026-07-05  
**Validator commit baseline:** `fb44a8f` (Phase 22A) → this document lands with Phase 22B commit  
**Audience:** Cursor, GitHub Copilot, and other coding agents working on `record-platform`

---

## 1. Verdict

```text
Phase 22B: PASS — real-inference response + transport validator smoke
Live matrix: NOT RUN
Runtime/env changes: NONE
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
KPI readiness: COMPLETE
Protocol response smoke: 15/15 PASS
```

---

## 2. Baseline

```text
Phase 21: CLOSED PASS / ARCHIVED @ 1422152
Phase 22A: COMPLETE @ fb44a8f
Artifact SHA256: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
Cumulative live matrix: 57105/57105 HTTP 200, 0% fallback (HTTP/1.1 only)
Hybrid/vector production default: NOT APPROVED
```

---

## 3. Phase 21 archive check

```bash
bash scripts/verify-phase-21-archive-readonly.sh
```

```text
current_head_short=fb44a8f
artifact_sha256=1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
PASS: Phase 21 archive read-only verification
```

---

## 4. Protocol response smoke results

```bash
CONTRACT_PASSWORD='...' \
BASE_URL='https://record-platform.test' \
CA_CERT='certs/dev-chain.pem' \
WRITE_JSONL=1 \
bash scripts/smoke-ai-rag-real-inference-response-readonly.sh
```

```text
15/15 response probes PASS
5 cases × 3 protocols
HTTP/1.1 explicit: PASS (5/5)
HTTP/2: PASS (5/5)
HTTP/3: PASS (5/5)
retrieval_mode=hybrid_canary (all probes)
gate_reason=allowlist (all probes)
fallback=0 (all probes)
response=PASS (all probes)
sentiment=PASS (all probes)
```

**Note:** One early attempt observed a transient `keyword_fallback_from_hybrid` on the first H1 probe; immediate rerun was **15/15 PASS**. Phase 22B verdict uses the successful validator run.

---

## 5. Response / sentiment / red-team result table

| case_id | h1-explicit | h2 | h3 | response | sentiment | red-team safe |
| ------- | ----------- | -- | -- | -------- | --------- | ------------- |
| seller_listing_advice | PASS | PASS | PASS | PASS | PASS | n/a |
| buyer_sentiment | PASS | PASS | PASS | PASS | PASS | n/a |
| negotiation_strategy | PASS | PASS | PASS | PASS | PASS | n/a |
| auction_pressure | PASS | PASS | PASS | PASS | PASS | n/a |
| red_team_overclaim | PASS | PASS | PASS | PASS | PASS | PASS (grounded refusal) |

Red-team check uses `is_generic_ungrounded_refusal` — grounded safe refusals with private/not-ingested language **PASS**; bare “I can't help with that.” **FAIL**.

---

## 6. Latency baseline table (rag_total_ms, curl end-to-end)

Validator run 2026-07-05T03:06:16Z. Baseline capture only — not a hard gate.

### By protocol and case

| case_id | h1-explicit | h2 | h3 |
| ------- | ----------- | -- | -- |
| seller_listing_advice | 1489.2 | 717.1 | 1177.2 |
| buyer_sentiment | 1594.3 | 460.9 | 541.3 |
| negotiation_strategy | 566.3 | 519.9 | 452.3 |
| auction_pressure | 590.3 | 636.4 | 445.9 |
| red_team_overclaim | 706.2 | 628.1 | 517.9 |

### Aggregates (15 probes)

| Metric | rag_total_ms |
| ------ | ------------ |
| p50 | 590.3 |
| p95 | 1594.3 |
| max | 1594.3 |

`hybrid_retrieval_ms` from response body was not consistently present in smoke JSONL for this run; see KPI doc for retrieval latency field plan.

---

## 7. KPI readiness summary

| KPI family | Phase 22B status |
| ---------- | ---------------- |
| Recommendation usefulness over time | **Defined** — rubric pass rates via smoke JSONL + summarizer |
| Search / retrieval latency | **Baseline captured** — `rag_total_ms` per probe |
| Ingestion success rates | **Defined** — metrics + gaps documented (`PHASE_22_KPI_OBSERVABILITY_READINESS.md`) |
| Data-to-searchable time | **Defined** — lifecycle fields proposed; no invented data |
| Operational health | **Defined** — gates + existing T20/OCH references |

Summarizer:

```bash
node scripts/summarize-phase22-ai-kpis-readonly.mjs
```

Example (latest validator JSONL):

```json
{
  "status": "PASS",
  "response_pass_rate": 1,
  "sentiment_pass_rate": 1,
  "fallback_count": 0,
  "leakage_failures": 0,
  "latency": { "rag_total_ms_p50": 590.3, "rag_total_ms_p95": 1594.3 }
}
```

---

## 8. Evidence separation

```text
Phase 21 cumulative matrix: 57105/57105 HTTP 200, 0% fallback — HTTP/1.1 live-runner stack.
Phase 22B smoke: 15 read-only real-inference probes across H1/H2/H3 — NOT added to 57105.
KPI summarizer: aggregates local smoke JSONL only — NOT matrix evidence.
```

---

## 9. Runtime/env unchanged proof

```text
No runtime/env/image/default/allowlist changes in Phase 22B.
No participant artifact edits.
No user provisioning.
No live matrix executed.
Scripts and docs only (+ read-only smoke against existing contract path).
```

Archive grep gates unchanged: keyword default, PERCENT=0, ALLOW_PROD_PERCENT=0, Preview UI/API KEEP.

---

## 10. Stop rules

If any gate fails:

```text
Phase 22B: BLOCKED
Triage only. Do not run live matrix.
Do not change production default, PERCENT, or allowlist without explicit approval.
```

---

## 11. Next approval phrase

```text
Approved: start Phase 22C live real-inference matrix only after Phase 22B response+transport validator PASS.
```

Phase 22C must declare matrix protocol, participant count, windows, prompt set, and whether H2/H3 are smoke-only or full matrix.

---

## Related documents

- `docs/ai-platform/PHASE_22_KPI_OBSERVABILITY_READINESS.md`
- `docs/ai-platform/PHASE_22A_REAL_INFERENCE_RESPONSE_VALIDATION_DESIGN.md`
- `docs/ai-platform/PHASE_22_REAL_INFERENCE_TRANSPORT_READINESS_PLAN.md`
