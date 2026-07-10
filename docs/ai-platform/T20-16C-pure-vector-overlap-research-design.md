# T20.16C — Pure vector overlap research design

**Status:** Research design complete (docs only — **no** implementation)  
**Generated:** 2026-06-30  
**Baseline SHA:** `c95ff68` (T20.16B)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.16B `final_tagged_plan` remediation complete

---

## 1. Executive verdict

```text
T20.16C pure vector overlap research design: COMPLETE
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Implementation: NOT STARTED
T20.16D: NOT STARTED
```

**Research verdict:** Pure vector overlap is **stable at 8/16** across G3R, T20.14H1 (5 runs), T20.15 ladder, and fresh read-only snapshot on `t20-p216b`. The other **8/16** cases are **deterministically repaired only by keyword overlap anchors** (`overlap_anchor_added=true`). Entity expansion alone bridges **6/16** pure-positive cases but **does not** lift the anchor-dependent eight.

**Recommended path:** **Keep pure vector report-only**; focus production-readiness on **hybrid anchored lane (Lane B)** via **T20.16D** — not pure-vector implementation.

---

## 2. Current pure vs anchored evidence

| Source | Pure overlap | Anchored overlap | Notes |
|--------|-------------|------------------|-------|
| T20.14G3R (3 runs) | **8/16** | **16/16** | Anchors lifted 8→16 |
| T20.14H1 (5 runs) | **8/16** all runs | **16/16** all runs | Stable plateau |
| T20.15 ladder (all evals) | **8/16** | **16/16** | Unchanged post-canary |
| T20.16B post-fix transcript | N/A (API) | hybrid **0/27** fallback | Shadow unchanged |
| **C0 fresh snapshot** (`20260630-115733`) | **8/16** | **16/16** | SHA `c95ff68`, shadow p95 **298.5 ms** |

### C0 read-only checks (not committed)

| Check | Result |
|-------|--------|
| `rp-ai-shadow-real-query-timing.sh` | pure **8/16**, anchored **16/16**, zero-results **0/16**, embed timeouts **0** |
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** |
| `rp-ai-shadow-source-diagnostic.sh` | FAIL (20 issues — owner/OBO diagnostic class; overlap research does not depend on this gate) |

---

## 3. Research questions — answers

### Q1. Which 8/16 cases still fail pure doc/entity overlap?

The eight cases where **pure_doc=0 and pure_ent=0** (all require `overlap_anchor_added=true` for anchored repair):

| # | case_id | Mode |
|---|---------|------|
| 1 | `offer_summary_default` | shadow_default |
| 2 | `offer_summary_obo` | shadow_obo_owner |
| 3 | `obo_activity_default` | shadow_default |
| 4 | `obo_activity_obo` | shadow_obo_owner |
| 5 | `pricing_revision_default` | shadow_default |
| 6 | `catalog_activity_obo` | shadow_obo_owner |
| 7 | `negotiation_context_default` | shadow_default |
| 8 | `negotiation_context_obo` | shadow_obo_owner |

The eight **pure-positive** cases (no overlap anchor needed): `pricing_revision_obo`, `catalog_activity_default`, `notifications_default`, `notifications_obo`, `bid_offer_activity_default`, `bid_offer_activity_obo`, `revision_impact_default`, `revision_impact_obo`.

### Q2. Failure taxonomy

| Cause | Share of 8 pure-fail | Applies? |
|-------|---------------------|----------|
| **same_source_type_different_chunks** | ~75% | **Yes** — primary |
| **source_type_mismatch** / profile slot tradeoff | ~25% | **Yes** — `obo_helper` vs `generic_rag` |
| entity extraction gap | partial | Metadata bridges entity on some routes; not chunk parity |
| vector embedding semantic miss | **Yes** | Cosine rank ≠ lexical keyword rank |
| profile routing miss | **Yes** | OBO profile reserves OBO slots vs keyword listing-heavy |
| insufficient source-type floor | partial | Diversity top-ups add types but not same chunk IDs |
| HNSW approximate recall | unlikely | Zero-results **0/16**; fetches return candidates |
| **keyword-anchor-only semantic bridge** | **Yes** | **All 8 pure-fail cases** use `overlap_anchor_added` |

### Q3. Acceptable for hybrid but not pure vector?

**Yes.** Complementary retrieval (keyword lexical + vector semantic + route quotas) is **desirable for hybrid** when keyword fallback and anchors bound risk. For **pure vector default**, the same divergence is **unacceptable** — production would not guarantee keyword-parity grounding without anchors.

### Q4. Is pure vector overlap the right production gate?

**No for default promotion.** Pure overlap measures **vector-only parity with keyword**, which this architecture **does not optimize for** (by design: route weights, diversity floors, entity expansion). **Anchored hybrid overlap** is the correct gate for Lane B canary. Pure overlap remains a **report-only diagnostic** (already enforced via `AI_RAG_HYBRID_LOG_PURE_VECTOR=1`).

### Q5. Minimum pure-vector target for more implementation?

Per T20.14H0/H1: **≥10/16** pure doc/entity overlap >0 on stable runs before pure-vector **canary planning**. Current **8/16** — **2 cases short**, and historical tuning (G3 entity expansion, G3R anchors) shows the gap is **structural**, not noise.

### Q6. Work to move 8/16 → ≥10/16 without keyword anchors?

Estimated **high effort, low confidence**:

- Profile routing refinement (Option A) — might recover **1** case (`catalog_activity_obo` / `pricing_revision_default` split)
- Source-type floor v2 (Option C) — might recover **0–1** if floors force keyword-aligned chunks
- Query rewrite pure-only (Option E) — analogous to T20.16B but **without anchors**; uncertain +2
- HNSW tuning (Option D) — unlikely; fetches already non-empty
- Entity expansion v3 (Option B) — G3 proved **+1** at best (7→8); plateau at 8/16

**Conclusion:** Moving **+2 without anchors** is **not credibly low-risk** given 5-run stability at 8/16.

---

## 4. Sixteen-case overlap table

Snapshot: `bench_logs/ai-platform/t20-10-shadow-real-query-20260630-115733.jsonl` (SHA `c95ff68`, not committed).

| case_id | prompt theme | mode/profile | keyword source types | pure vector source types | anchored source types | pure doc/ent | anchored doc/ent | zero-overlap reason | likely root cause | candidate remediation | risk | recommended |
|---------|--------------|--------------|---------------------|--------------------------|----------------------|--------------|------------------|---------------------|-------------------|----------------------|------|-------------|
| offer_summary_default | latest offers | shadow_default / generic_rag | listing, obo_offer_summary | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/3 | same_type_diff_chunks | lexical vs vector chunk pick | profile A; pure query rewrite E | med | **not now** |
| offer_summary_obo | latest offers | shadow_obo_owner / obo_helper | listing, obo_offer_summary | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/3 | same_type_diff_chunks | OBO slot quota | profile A | med | **not now** |
| obo_activity_default | OBO activity | shadow_default / generic_rag | listing, obo_offer_summary | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/3 | source_type_mismatch | KW listing-heavy vs shadow OBO mix | profile A | med | **not now** |
| obo_activity_obo | OBO activity | shadow_obo_owner / obo_helper | listing, obo_offer_summary | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/3 | same_type_diff_chunks | complementary paths | entity v3 B | low-med | **not now** |
| pricing_revision_default | pricing/revision | shadow_default / generic_rag | listing, obo_offer_summary | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/7 | source_type_mismatch | KW OBO vs shadow listing+revision | floor C | med | **not now** |
| pricing_revision_obo | pricing/revision | shadow_obo_owner / obo_helper | listing, obo_offer_summary | obo_offer_summary | obo_offer_summary | **4/30** | **4/30** | — | profile aligned | — | — | **n/a (pass)** |
| catalog_activity_default | catalog interest | shadow_default / generic_rag | listing, listing_revision | listing, listing_revision | listing, listing_revision | **2/9** | **2/9** | — | lexical+semantic align | — | — | **n/a (pass)** |
| catalog_activity_obo | catalog interest | shadow_obo_owner / obo_helper | listing, listing_revision | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/3 | same_type_diff_chunks | OBO slots displace revision | profile A | med | **not now** |
| notifications_default | notifications | shadow_default / generic_rag | obo_offer_summary | obo_offer_summary | obo_offer_summary | **3/17** | **3/17** | — | entity expansion | — | — | **n/a (pass)** |
| notifications_obo | notifications | shadow_obo_owner / obo_helper | obo_offer_summary | obo_offer_summary | obo_offer_summary | **3/15** | **3/15** | — | entity expansion | — | — | **n/a (pass)** |
| bid_offer_activity_default | bid/offer activity | shadow_default / generic_rag | obo_offer_summary | obo_offer_summary | obo_offer_summary | **3/15** | **3/15** | — | type-aligned | — | — | **n/a (pass)** |
| bid_offer_activity_obo | bid/offer activity | shadow_obo_owner / obo_helper | obo_offer_summary | obo_offer_summary | obo_offer_summary | **3/15** | **3/15** | — | type-aligned | — | — | **n/a (pass)** |
| revision_impact_default | revision impact | shadow_default / generic_rag | listing_revision, obo_offer_summary | listing_revision, obo_offer_summary | listing_revision, obo_offer_summary | **1/5** | **1/5** | — | revision in both paths | — | — | **n/a (pass)** |
| revision_impact_obo | revision impact | shadow_obo_owner / obo_helper | listing_revision, obo_offer_summary | obo_offer_summary | obo_offer_summary | **4/20** | **4/20** | — | OBO profile match | — | — | **n/a (pass)** |
| negotiation_context_default | negotiation context | shadow_default / generic_rag | listing, obo_offer_summary | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/3 | same_type_diff_chunks | different listing IDs | floor C / rewrite E | med | **not now** |
| negotiation_context_obo | negotiation context | shadow_obo_owner / obo_helper | listing, obo_offer_summary | listing, obo_offer_summary | listing, obo_offer_summary | 0/0 | 1/3 | same_type_diff_chunks | OBO/listing tradeoff | profile A | med | **not now** |

**Lane separation:**

| Lane | Overlap gate | Current |
|------|--------------|---------|
| **Pure vector + entity expansion** | ≥10/16 report target | **8/16 FAIL** |
| **Anchored hybrid** | ≥10/16 required | **16/16 PASS** |
| **Keyword production** | stability + leakage | **PASS** |

---

## 5. Root-cause breakdown

```text
Primary: complementary retrieval objectives (keyword lexical vs vector semantic + route quotas)
Secondary: profile routing (obo_helper vs generic_rag) shifts source-type mix
Tertiary: diversity/source-type floors add types but not chunk-ID parity
Not primary: HNSW recall, embed timeouts, true zero-results, privacy filter blocks
Structural: 8/16 cases require keyword overlap anchors — not achievable as "pure vector"
```

Historical arc: T20.10AA identified 11/16 zero chunk overlap → G3 entity expansion → 8/16 pure → G3R overlap anchors → 16/16 anchored, pure stuck at 8/16 → stable through T20.14H1 and T20.15.

---

## 6. Ranked remediation options

### Option A — profile routing refinement

| Field | Value |
|-------|-------|
| Scope | `shadow_profiles.py`, route inference before fetch |
| Safety | Medium — wrong profile → wrong source mix |
| Latency | Low |
| Leakage | Low if owner-scope preserved |
| Expected gain | **0–1** pure cases |
| Preserves keyword default | Yes |
| Tests | Profile unit tests + 16-case shadow bench |
| Rollback | Revert profile map |
| **Rank** | **3** — design-only spike if pursued later |

### Option B — vector-side entity expansion v3

| Field | Value |
|-------|-------|
| Scope | `rag_retrieval.py` entity expansion, vector-derived keys only |
| Safety | Medium — must not pull cross-owner |
| Latency | Medium (+fetch) |
| Leakage | Medium |
| Expected gain | **0–1** (G3 plateau at 8/16) |
| Preserves keyword default | Yes |
| Tests | Overlap bench + privacy tests |
| Rollback | Flag off |
| **Rank** | **4** — diminishing returns |

### Option C — source-type floor v2

| Field | Value |
|-------|-------|
| Scope | Bounded floors per prompt class |
| Safety | Medium — floor too high → latency |
| Latency | Medium |
| Leakage | Low |
| Expected gain | **0–1** |
| Preserves keyword default | Yes |
| Tests | Floor cap tests + shadow bench |
| Rollback | Remove floors |
| **Rank** | **5** |

### Option D — HNSW recall tuning (`ef_search`, candidate count)

| Field | Value |
|-------|-------|
| Scope | DB index params, fetch limits — **design only** |
| Safety | Low–medium |
| Latency | **High risk** at high `ef_search` |
| Leakage | Low |
| Expected gain | **~0** (non-empty fetches today) |
| Preserves keyword default | Yes |
| Tests | Recall benchmark vs keyword refs |
| Rollback | Restore index params |
| **Rank** | **6** — defer |

### Option E — embedding/query rewrite (pure only, no anchors)

| Field | Value |
|-------|-------|
| Scope | Prompt-class retrieval expansion (T20.16B pattern) in shadow-only path |
| Safety | Medium — must not affect keyword production |
| Latency | Low |
| Leakage | Low |
| Expected gain | **1–2** uncertain |
| Preserves keyword default | Yes if shadow-only |
| Tests | 16-case bench + non-regression keyword |
| Rollback | Remove expansion map |
| **Rank** | **2** — only if pure research reopened |

### Option F — formally downgrade pure overlap to report-only ✅ **RECOMMENDED**

| Field | Value |
|-------|-------|
| Scope | Docs + diagnostics policy only |
| Safety | **None** |
| Latency | **None** |
| Leakage | **None** |
| Expected gain | Clarifies gates; no overlap change |
| Preserves keyword default | **Yes** |
| Tests | Continue logging pure in hybrid diagnostics |
| Rollback | N/A |
| **Rank** | **1** |

---

## 7. Recommendation

```text
Recommended path:
- Keep pure vector report-only and focus production-readiness on hybrid anchored lane (T20.16D)
```

### Decision criteria applied

| Criterion | Outcome |
|-----------|---------|
| Likely gain <2 pure cases without anchors | **Met** — plateau at 8/16 |
| Implementation requires keyword anchors | **Disqualifies pure vector** for those 8 cases |
| Latency/privacy risk on pure tuning | **Defer** Options B/C/D |
| Pure remains 8/16 after analysis | **→ T20.16D**, not pure-vector implementation |

**Implementation recommended?** **No** for pure-vector overlap work in T20.16C scope.

---

## 8. Explicit non-goals

- Enable vector retrieval as production default
- Remove keyword anchors or keyword fallback
- Set `AI_RAG_HYBRID_CANARY_PERCENT` > 0
- Weaken privacy/leakage filters (`FORBIDDEN_CHUNK_RE`, message body rules)
- HNSW index changes in this ticket
- Generative Ollama as production RAG default
- Conflate anchored overlap with pure vector overlap in gate verdicts

---

## 9. Future ticket map

| Ticket | Scope | Status |
|--------|-------|--------|
| **T20.16D** | Hybrid production-readiness **eval plan** (anchored lane, live inference) | **RECOMMENDED NEXT** |
| **T20.16E** | Hybrid production decision package | After D |
| T20.16C-impl-A | Profile routing spike (optional, only if owner reopens pure research) | **NOT recommended** |
| T20.16C-impl-E | Pure-only query rewrite experiment | **Optional research** — low priority |

Do **not** start T20.16D without approval phrase.

---

## 10. Stop condition

```text
T20.16C: COMPLETE (design only)
Pure vector implementation: NOT STARTED
Vector production default: NOT APPROVED
Next: T20.16D hybrid production-readiness eval plan (owner approval required)
```

### Next approval phrase

```text
Approved: start T20.16D hybrid production-readiness eval plan
```
