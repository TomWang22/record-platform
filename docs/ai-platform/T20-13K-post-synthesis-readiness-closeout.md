# T20.13K — Post-synthesis readiness closeout

**Status:** Docs / read-only closeout  
**Generated:** 2026-06-26  
**Baseline SHA:** `066ef6e`  
**Supersedes:** T20.13 comprehensive re-eval (pre-synthesis product state)

---

## Executive summary

Phase 20 embedding ladder reached **10,065** embedded chunks (≥10k count gate **PASS**). T20.13A–K resolved shadow observability blockers, improved production keyword answer quality via deterministic synthesis, and confirmed vector rollout remains blocked on latency and overlap.

**Product-value win:** RAG keyword answer quality **2.6/5 → 3.6/5** (target ≥3.5 **MET**) without changing retrieval mode, vector defaults, or API contracts.

**Rollout unchanged:** Vector default **NOT APPROVED**. Phase 21 **not started**.

---

## Corpus and count gates

| Metric | Value |
|--------|------:|
| Embedded chunks | **10,065** |
| Non-message chunks | ~73,043 |
| Percent coverage | **~13.8%** |
| ≥10k count gate | **PASS** |
| ≥15% coverage gate | **FAIL** (count gate satisfies alternate path) |
| Last tranche | `t20-tranche-12` (+500, 2026-06-26) |

**Embedding policy after T20.13K:** No further embedding tranches are required for the **≥10k count gate**. Additional tranches toward **≥15% coverage** require explicit approval only — not implied by synthesis or shadow diagnostic work.

---

## T20.13 arc (completed)

| Ticket | Focus | Outcome |
|--------|-------|---------|
| **T20.13** | Comprehensive rollout re-eval | NOT APPROVED — latency/overlap blockers |
| **T20.13A/B** | Shadow zero-result / stability triage + proposal | Embed cold-start dominant; Options A+B recommended |
| **T20.13C/D** | Live inference telemetry harness | Baseline: 7/7 embed_timeout_before_fetch |
| **T20.13E/F** | Diagnostic embed warmup/retry | 7/7 → 0/7 embed timeouts; shadow fetch unblocked |
| **T20.13G** | Shadow fetch/latency/overlap triage | Mixed embed+fetch latency; weak default overlap |
| **T20.13G-R/S** | Prompt transcript + answer quality eval | RAG 2.6/5 — shallow boilerplate summaries |
| **T20.13H** | Keyword synthesis proposal | Design for rule-engine templates |
| **T20.13I/J** | Synthesis implementation + eval | RAG **3.6/5**; `rag_synthesis.py` shipped |
| **T20.13K** | This closeout | Source-of-truth update |

---

## Keyword synthesis (T20.13I/J)

| Item | Value |
|------|-------|
| Implementation | `services/python-ai-service/app/ai/rag_synthesis.py` |
| Wired in | `insights.rag_query()` — replaces *"Retrieved N grounded excerpts..."* |
| Templates | catalog_activity, seller_notifications, offer_bidding_activity, listing_revision_changes, private_negotiation_no_messages, seller_attention_today, marketplace_activity_summary |
| Production retrieval | **keyword** (unchanged) |
| model_used | **rule-engine** (unchanged) |
| Generative Ollama for summary | **not used** |
| Leakage | **PASS** |
| Eval artifact | `docs/ai-platform/T20-13J-keyword-synthesis-quality-eval.md` |

Structured endpoints (`pricing_recommendation`, `auction_risk`) remain higher-value for typed insights; generic RAG now provides seller/buyer-facing deterministic summaries.

---

## Shadow diagnostics (post-warmup, T20.13E–G/J)

| Metric | Recent warmed runs |
|--------|-------------------|
| embed_timeout_before_fetch | **0/7** (was 7/7 pre-warmup) |
| shadow_fetch_attempted | **7/7** |
| true zero-results | **0** |
| shadow p95 (off / flagged) | **~6–10s** (rollout target ≤3s) |
| default overlap chunk >0 | **1/7** — weak |
| flagged overlap chunk >0 | **3/7** — diagnostic-only |

Warmup fixed observability; latency and overlap remain rollout blockers.

---

## Final gate table

| Gate | Current | Status |
|------|---------|--------|
| Embedded count | 10,065 | **PASS** ≥10k |
| Percent coverage | ~13.8% | **FAIL** vs 15%, but count gate passes |
| Keyword answer quality | **3.6/5** | **PASS** target ≥3.5 |
| Production retrieval | keyword | **PASS** |
| Leakage | 0 / PASS | **PASS** |
| Keyword stability | PASS | **PASS** |
| Shadow p95 | 8–10s recent | **FAIL** |
| Shadow overlap | weak (1/7 off, 3/7 flagged) | **FAIL** |
| Vector default | off | **PASS** |
| Phase 21 | not started | **PASS** |

---

## What improved vs T20.13 initial re-eval

| Area | Before T20.13E | After T20.13K |
|------|----------------|---------------|
| Shadow embed timeouts | 7/7 harness-inflated | 0/7 with warmup |
| Shadow fetch observability | blocked | 7/7 attempted |
| RAG answer quality | 2.6/5 boilerplate | **3.6/5** synthesized |
| Production retrieval | keyword | keyword (unchanged) |
| Vector rollout | NOT APPROVED | **NOT APPROVED** |

---

## Remaining blockers (rollout)

1. **Shadow p95 latency** — 8–10s recent warmed runs vs ≤3s SLO  
2. **Shadow–keyword overlap** — default 1/7; flagged 3/7 diagnostic-only  
3. **Percent coverage** — 13.8% vs 15% (optional tranche path if ever approved)

**T20.14/T20.15 rollout:** blocked until all gates pass.

---

## Safe future choices (explicit approval required)

| Option | Scope |
|--------|-------|
| **A. T20.13L** | Shadow latency design proposal (read-only) |
| **B. T20.13M** | Shadow overlap design proposal (read-only) |
| **C. Stop Phase 20** | Keyword synthesis improved; hold rollout |
| **D. T20.14** | Rollout proposal — only after latency/overlap pass |

No vector rollout. No Phase 21.

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```
