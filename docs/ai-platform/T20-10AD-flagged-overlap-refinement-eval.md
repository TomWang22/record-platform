# T20.10AD — Flagged shadow overlap refinement evaluation

**Generated:** 2026-06-25  
**Baseline SHA:** `2f8d227` (T20.10AC flagged shadow overlap refinements)  
**Mode:** read-only evaluation — no code, flag default, or rollout changes  
**Vector rollout:** NOT APPROVED

## Executive verdict

| Item | Verdict |
|------|---------|
| Vector rollout | **NOT APPROVED** |
| Flag defaults | **`AI_RAG_SHADOW_ENTITY_HINTS=0`**, **`AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`** — confirmed in code and deployment |
| T20.10AC Option A+C | **Diagnostically useful** — overlap improves when flags on |
| Default-on promotion | **Rejected** — overlap gain does not justify production shadow behavior change |
| Latency | **Unstable / often regressive** when flagged — extra fetches add cost; not rollout-safe |
| Keyword retrieval | **Unchanged** (production default) |
| `AI_RAG_SHADOW_VECTOR` | **`0`** (unchanged) |

**Summary:** Flagged overlap refinements improve chunk/doc/entity alignment (**11/16 → 8/16** zero-overlap on T20.10AD confirmatory runs) but do **not** solve chunk parity fully, add fetch/latency cost, and remain **too expensive and unstable for rollout**. Flags stay **diagnostic-only / default off**.

---

## Flag default confirmation

| Location | `AI_RAG_SHADOW_ENTITY_HINTS` | `AI_RAG_SHADOW_NEIGHBOR_EXPANSION` |
|----------|-------------------------------|-------------------------------------|
| `config.py` | `"0"` default → `False` | `"0"` default → `False` |
| Deployment (post-eval) | `0` | `0` |
| Unit tests | `test_flags_default_off` asserts `False` | same |

No committed env/config enables flags by default.

---

## Default/off vs flagged/on (T20.10AD confirmatory benchmarks)

**Harness:** `BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1`  
**Baseline SHA at run time:** `2f8d227`  
**Artifacts (local, not committed):**

| Run | Artifact |
|-----|----------|
| Default/off | `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-000421.md` |
| Flagged/on (deployment env `1/1`) | `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-000700.md` |

| Metric | Default/off | Flagged/on | Interpretation |
|--------|------------:|-----------:|----------------|
| zero chunk-overlap | **11/16** | **8/16** | improves (−3 runs) |
| doc-overlap >0 | **5/16** | **8/16** | improves (+3) |
| entity-overlap >0 | **5/16** | **8/16** | improves (+3) |
| source diversity (types) | **6** | **6** | stable PASS |
| candidate_fetch p95 | **1,206 ms** | **1,075 ms** | this run: flagged comparable; see latency note below |
| shadow p95 | **2,354 ms** | **2,335 ms** | this run: comparable; T20.10AC flagged run regressed |
| embed p95 | **1,182 ms** | **1,282 ms** | run variance |
| zero-result shadow | **0/16** | **0/16** | safe |
| leakage | **0** | **0** | safe |
| keyword / RAG contract | **PASS** | **PASS** | stable |

### Latency stability note (T20.10AC vs T20.10AD)

T20.10AC flagged run on the same harness showed **material regression**:

| Metric | T20.10AC flagged (`234051`) | T20.10AD flagged (`000700`) |
|--------|----------------------------:|----------------------------:|
| candidate_fetch p95 | **2,535 ms** | **1,075 ms** |
| shadow p95 | **5,462 ms** | **2,335 ms** |
| zero-overlap | **8/16** | **8/16** |

Overlap improvement is **repeatable** (8/16 on both flagged runs). Latency is **run-to-run unstable** — neighbor expansion + entity listing fetch add SQL round-trips that can push p95 above rollout gates. **Do not treat a single good flagged run as clearance.**

Default/off overlap on T20.10AD (**11/16**) matches T20.10Z/T20.10AC — **no regression from shipping T20.10AC with flags off**.

---

## Remaining failure analysis (flagged/on)

### Zero-overlap reasons

| Reason | Default/off | Flagged/on |
|--------|------------:|-----------:|
| `same_source_type_different_chunks` | 10 | **8** |
| `source_type_mismatch` | 1 | **0** |

All **8** remaining flagged zero-overlap runs are **`same_source_type_different_chunks`**. No `source_type_mismatch` on flagged run — entity hints and neighbor expansion helped cross-type alignment on at least one prior failure class.

### What improved vs what did not

| Layer | Flagged effect |
|-------|----------------|
| Chunk ID parity | **Partial** — 3 fewer zero-overlap runs; 8/16 still fail |
| Document overlap | **Improved** — 5/16 → 8/16 |
| Entity overlap | **Improved** — 5/16 → 8/16 |
| Source diversity | **Unchanged** — 6 types |

Current A+C refinements improve **semantic/entity alignment** more than **exact chunk parity**. Keyword lexical hits and shadow semantic neighbors still select different chunks within shared types (especially `listing`).

---

## Interpretation

### A+C are useful diagnostics

- Entity hints + neighbor expansion surface keyword-adjacent chunks in shadow pools.
- Diagnostics (`entity_hints_enabled`, `neighbor_rows_added`, etc.) help explain overlap gaps without changing keyword production path.
- **Worth keeping** behind flags for benchmark and rollout-readiness investigations.

### A+C should not become default-on

- Overlap gate still **fails** at 8/16 zero-overlap (50% of shadow runs).
- Latency adds **1–3 extra SQL fetches** per shadow request when both flags on; T20.10AC flagged run exceeded cf/shadow p95 targets.
- Promoting to default shadow behavior would change diagnostic comparisons and risk masking independent semantic retrieval quality.

### Option B remains deferred

Keyword-anchor pin (T20.10AB Option B) could raise chunk overlap further but risks **artificial parity** with keyword. **Not recommended** without explicit approval and separate diagnostic-only experiment.

### Rollout blockers (unchanged)

| Blocker | Status |
|---------|--------|
| Embedded coverage 7.62% | **FAIL** |
| Shadow–keyword overlap | **FAIL** (8/16 zero even flagged) |
| Latency stability | **FAIL / borderline** (flagged variance) |
| Vector rollout | **NOT APPROVED** |

---

## Validation bundle (T20.10AD)

| Script | Result | Notes |
|--------|--------|-------|
| `rp-ai-shadow-real-query-timing.sh` (default/off) | PASS harness | 11/16 zero-overlap |
| `rp-ai-shadow-real-query-timing.sh` (flagged/on) | PASS harness | 8/16 zero-overlap |
| `rp-ai-shadow-source-diagnostic.sh` | **PASS** (rerun after rollout) | 6 types; transient FAIL during pod restart |
| `audit-rp-ai-rag-contract.sh` | **PASS** | |
| `rp-ai-rag-quality-smoke.sh` | **PASS** | |
| `rp-ai-provider-readiness.sh` | **PASS** | |
| `rp-ai-pgvector-readiness.sh` | **PASS** | |
| `rp-och-decontaminate-scan.sh` | **PASS** (588 files) | |

### Known non-blocking contract observations (pre-existing)

Not attributed to overlap flags unless default/off regression is observed:

| Observation | Script |
|-------------|--------|
| `provider_status_tensorflow` missing | runtime contract |
| `endpoint_seller_sales_summary` empty | endpoints contract |
| `endpoint_buyer_collection_summary` empty | endpoints contract |

Default/off T20.10AD rerun: keyword contract **PASS** — no overlap-flag regression signal.

---

## Recommended next ticket

**Primary recommendation:** **T20.10AE — flagged overlap latency trim proposal** (design-only)

Scope for proposal (not implementation):

- Reduce neighbor expansion caps or make expansion conditional on entity-hint miss only
- Defer entity listing fetch unless pool entity overlap below threshold
- Keep flags default off; no keyword changes

**Alternative:** **T20.16 — Phase 20 context refresh** if stopping overlap tuning branch.

**Do not start:**

- T20.12+ embedding tranches without explicit approval
- Vector rollout / default-on flags
- Option B keyword-anchor without explicit approval
- Phase 21

---

## Post-eval deployment state

Flags reset after flagged benchmark:

```text
AI_RAG_SHADOW_ENTITY_HINTS=0
AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0
```

---

## Definition of done (T20.10AD)

- [x] Default/off and flagged/on results documented
- [x] Flags confirmed default off (code + deployment)
- [x] No code changed
- [x] No generated artifacts committed
- [x] Next recommendation explicit (T20.10AE or T20.16)
- [x] Vector rollout remains NOT APPROVED

**Vector rollout: NOT APPROVED**
