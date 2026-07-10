# T20.13M — Shadow overlap remediation plan

**Status:** Read-only design + warmed telemetry analysis  
**Generated:** 2026-06-27  
**Baseline SHA:** `e0e86f1`  
**Embedded:** 10,065 (~13.8%)

---

## Context

Shadow fetch is observable post-warmup (7/7 attempted, 0 zero-results). Default overlap remains weak (1/7 chunk >0 off; 11/16 canonical zero-overlap). Flagged entity hints help selectively (3/7) but add latency (cf p95 6.7s). Keyword synthesis (T20.13I) improved product value **without** vector overlap — overlap remains a rollout gate, not a product blocker.

**This is not rollout. This is not Phase 21.**

---

## Artifacts analyzed (local, not committed)

Same T20.13L run artifacts:

| Artifact | Path |
|----------|------|
| Live inference summary | `bench_logs/ai-platform/live-inference/20260626-223101.summary.json` |
| Live inference report | `bench_logs/ai-platform/live-inference/20260626-223101.md` |
| Canonical shadow timing | `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-223708.jsonl` |
| Answer quality rubric | `docs/ai-platform/T20-13G-S-real-use-case-answer-quality-report.md` |
| Synthesis eval | `docs/ai-platform/T20-13J-keyword-synthesis-quality-eval.md` |
| Prior overlap triage | `docs/ai-platform/T20-13G-shadow-fetch-latency-overlap-triage.md` |

---

## Overlap baseline

### Default (flags off) vs flagged (on) — live inference

| Metric | flags **off** | flags **on** | Δ |
|--------|-------------:|-------------:|---|
| cases with chunk overlap >0 | **1 / 7** | **3 / 7** | +2 |
| document overlap >0 | **1 / 7** | **3 / 7** | +2 |
| entity overlap >0 | **1 / 7** | **3 / 7** | +2 |
| entity_boosted rows >0 | 0 | **4 / 7** | +4 |
| neighbor rows added >0 | 0 | **0 / 7** | 0 |
| shadow p50 / p95 ms | 3,636 / 6,057 | 5,836 / 9,434 | +latency |

### Per-case overlap table (live inference)

| case | off chunk/doc/entity | on chunk/doc/entity | entity_boosted (on) | zero_overlap_reason (off) |
|------|---------------------|---------------------|--------------------:|---------------------------|
| catalog_activity | 0/0/0 | 0/0/0 | 0 | same_source_type_different_chunks |
| seller_notifications | 0/0/0 | **3/3/9** | 8 | same_source_type_different_chunks |
| offer_bidding_activity | **1/1/3** | **2/2/5** | 2 | — |
| listing_revision_changes | 0/0/0 | **3/3/8** | 8 | same_source_type_different_chunks |
| private_negotiation_no_messages | 0/0/0 | 0/0/0 | 0 | same_source_type_different_chunks |
| seller_attention_today | 0/0/0 | 0/0/0 | 0 | same_source_type_different_chunks |
| marketplace_activity_summary | 0/0/0 | 0/0/0 | 1 | same_source_type_different_chunks |

### Canonical timing overlap (16 shadow runs)

| Metric | Value |
|--------|------:|
| zero-overlap runs (chunk=0) | **11 / 16** |
| document overlap >0 | 5 / 16 |
| entity overlap >0 | 5 / 16 |
| zero-result shadow runs | **0 / 16** |
| same_source_type_different_chunks | **10** |
| source_type_mismatch | 1 |

### Diagnostic counts

| Signal | Count |
|--------|------:|
| no-shadow-result (true zero) | **0** |
| entity boost contributing (flagged) | **4 / 7** cases |
| neighbor expansion contributing | **0 / 7** |
| cases improved by flags (chunk >0) | **3 / 7** (1→3) |
| cases **not** improved by flags | **4 / 7** (catalog, private_negotiation, seller_attention, marketplace) |

---

## Root cause

Explicit evaluation of six hypotheses:

| # | Hypothesis | Verdict | Evidence |
|---|------------|---------|----------|
| 1 | Keyword lexical retrieval picks exact/event chunks | **Confirmed** | Keyword returns listing + revision for catalog; OBO summaries for offer prompts; deterministic ts_rank/event ordering |
| 2 | Vector semantic retrieval picks adjacent/source-similar chunks | **Confirmed** | Primary zero_overlap_reason: `same_source_type_different_chunks` (10/11 canonical); same source types, different chunk IDs |
| 3 | More corpus widened semantic neighborhood | **Partial** | At 10,065 embedded rows, vector pool is larger; semantic neighbors diverge from lexical top-k without being wrong |
| 4 | Flagged entity hints help selectively | **Confirmed** | 1/7 → 3/7 chunk overlap; entity_boosted on 4/7; strong on OBO/revision prompts only |
| 5 | Neighbor expansion is not contributing enough | **Confirmed** | `neighbor_rows_added=0` on all 7 flagged cases — flag is inert in current corpus/routes |
| 6 | Overlap metric may be stricter than product usefulness | **Confirmed** | T20.13J: RAG 3.6/5 with 1/7 chunk overlap; synthesis delivers seller-facing value from keyword refs alone; shadow does not change user-visible answer |

**Core issue:** Keyword and shadow agree on **source types** but select **different chunk IDs** within those types. This is expected for lexical vs semantic retrieval — not a bug, but the current **exact chunk overlap** gate is a strict parity test.

**Product decoupling:** T20.13I synthesis means weak chunk overlap no longer implies weak product answers. Rollout gates should add **document/entity overlap** and **answer-quality** dimensions (T20.13G-S rubric ≥3.5/5).

---

## Remediation options

### Option A — Better deterministic keyword synthesis

| Aspect | Assessment |
|--------|------------|
| Status | **Implemented** (T20.13I/J) |
| Effect | RAG 2.6 → **3.6/5**; no vector required |
| Overlap impact | **None** — improves product without changing shadow parity |
| Recommendation | **Complete**; maintain as regression gate in T20.13Q |

### Option B — Entity-aware shadow diagnostic mode v2

Constrain shadow diagnostic fetches using listing IDs / source IDs / owner entity keys:

| Measure | Detail |
|---------|--------|
| Extract entity keys from keyword top-k | listing_id, offer_id, source_id from keyword refs |
| Shadow fetch: filter/boost by same entity | Diagnostic-only query param or profile flag |
| Expected effect | Raise document/entity overlap on OBO/revision cases without global fanout |
| Default | **Off** — explicit `shadow_entity_scope=v2` in harness only |

**Pros:** Builds on flagged entity hints (already 3/7); targets root cause (same-type different-chunk).  
**Cons:** Requires entity key extraction from keyword results; shadow-only.

### Option C — Same-document neighbor expansion v2

Make neighbor expansion actually useful:

| Measure | Detail |
|---------|--------|
| Expand around keyword-matched **documents** not global semantic neighbors | Use keyword chunk's `source_id` + `source_type` |
| Cap tightly | Max 2 neighbors per keyword anchor; diagnostic only |
| Current gap | v1 neighbor flag adds 0 rows — likely wrong join key or empty neighbor graph |

**Pros:** Could convert `same_source_type_different_chunks` into chunk overlap within document.  
**Cons:** Needs schema/graph audit; must not leak cross-owner chunks.

### Option D — Hybrid retrieval design (shadow/hybrid route)

Keyword anchors + vector semantic expansion — **design only**:

```
keyword top-k (anchors)
  └─> extract source_ids + types
        └─> vector search constrained to those documents (+ semantic expansion within doc)
              └─> merge/rerank (diagnostic)
```

| Aspect | Detail |
|--------|--------|
| Production default | **Not changed** |
| Evaluation | New shadow profile `hybrid_anchor_v1` |
| Overlap target | Document overlap ≥5/7; entity overlap ≥4/7 on live inference set |
| Latency | Depends on T20.13O — hybrid must not exceed p95 SLO |

**Pros:** Directly addresses lexical vs semantic divergence; aligns with product intent (ground in keyword, expand semantically).  
**Cons:** More complex; requires T20.13O latency work first.

### Option E — Reframe overlap gate

Do not rely only on exact chunk overlap for rollout:

| Metric | Current | Proposed T20.14 gate |
|--------|---------|---------------------|
| Chunk overlap | 1/7 off | ≥4/7 off **or** documented exception per route |
| Document overlap | 1/7 off | **≥5/7** off |
| Entity overlap | 1/7 off | **≥4/7** off |
| Answer quality (T20.13G-S) | 3.6/5 | **≥3.5/5** maintained |
| Source-type match | implicit | **≥6/7** cases share ≥1 source type |
| Zero-result shadow | 0/7 | **≤2/16** canonical |

**Pros:** Matches how retrieval actually works; preserves product quality gate.  
**Cons:** Requires explicit T20.14 sign-off on new gate definitions.

---

## Recommendation

**Selected path:**

1. **B + D** — Entity-aware shadow diagnostic v2 + hybrid anchor design as shadow-only candidate (`T20.13P` overlap track)
2. **Keep vector default off** — all overlap work remains diagnostic
3. **Do not default-on flags** — `AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`
4. **E** — Adopt reframed overlap gates in T20.14 promotion criteria (document/entity + answer quality)
5. **C** — Neighbor expansion v2 only after B proves entity scoping works
6. **A** — Already done; regression-only

**Sequencing:** Implement overlap/hybrid (**T20.13P**) **after** latency stabilization (**T20.13O**) — flagged mode cf p95 6.7s makes overlap tuning noisy.

**Use T20.13G-S answer-quality rubric** as additional rollout gate (≥3.5/5 RAG avg).

---

## Implementation candidates

| Ticket | Scope |
|--------|-------|
| **T20.13O** | Latency stabilization (prerequisite) |
| **T20.13P** | Overlap/hybrid diagnostic implementation (entity scope v2 + anchor hybrid profile) |
| **T20.13Q** | Post-fix readiness re-eval with reframed overlap metrics |

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Phase 21 is not started
Production retrieval remains keyword
```
