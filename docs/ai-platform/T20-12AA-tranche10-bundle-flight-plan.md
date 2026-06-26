# Phase 20.12 — Tranche 10 bundle flight plan (T20.12AA→AD)

**Status:** PLAN ONLY — **T20.12AA actual write NOT APPROVED**  
**Baseline SHA:** `5872e03`  
**Audience:** Cursor / Copilot agents executing embedding ladder ops

## Locked baseline

```text
Embedded: 8,565 (~11.7% of 73,043 non-message chunks)
T20.12Z dry-run: 500/500 selected (t20-tranche-10)
Projected after Tranche 10 actual: 9,065 (~12.4%)
Gap to 10k after Tranche 10: +935
Vector rollout: NOT APPROVED
Production retrieval: keyword
Production RAG model_used: rule-engine
Shadow diagnostics: Ollama embeddings + pgvector only
AI_RAG_SHADOW_VECTOR=0
AI_RAG_SHADOW_ENTITY_HINTS=0
AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0
Phase 21: not started
OBO eligible pool: 0 (exhausted)
Shadow p95 (T20.12Y eval): 4,728 ms — CONDITIONAL (rollout-blocking)
Shadow p95 (T20.12Y pre-write gate): 9,694 ms — CONDITIONAL (rollout-blocking)
```

**Latency rule:** Elevated shadow p95 does **not** block the embedding ladder. It **does** block vector rollout and Phase 21.

## Operating rule

**One approval → full bundle → stop before next write.**

After owner sends the exact approval phrase, run **T20.12AA → AB → AC → AD** end-to-end without asking for docs, eval, dry-run, or transcript sub-steps.

The **only** step requiring explicit approval is each **actual DB write**.

Never commit: `bench_logs/`, `backups/`, tranche lock JSON, DB dumps, screenshots, `webapp/test-results/`, coverage artifacts.

---

## Approval gate

Only start T20.12AA when owner sends exactly:

```text
Approved: start T20.12AA actual t20-tranche-10 write
```

When that phrase appears, run the full bundle below, then stop before T20.12AE actual write.

---

# T20.12AA — Actual t20-tranche-10 write

Use caps from T20.12Z dry-run:

```text
obo_offer_summary=0,listing=250,listing_revision=150,notification=100
```

Expected:

| Metric | Value |
|--------|------:|
| pre-count | 8,565 |
| new embeddings | +500 |
| post-count | 9,065 |
| coverage | ~12.4% |
| gap to 10k | +935 |

## AA1 — Fresh warm pre-write gate

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/rp-och-decontaminate-scan.sh
```

If cold source diagnostic fails from embed timeout: rerun warmup/diagnostic only — do not start backup/write.

## AA2 — Fresh backup

```bash
PGPASSWORD=postgres PG_DUMP_JOBS=4 BACKUP_TIMESTAMP=t20-12-tranche10-preflight \
  bash scripts/backup-rp-postgres-dbs.sh
```

Expected: `backups/rp-all-11-t20-12-tranche10-preflight/` (do not commit).

## AA3 — Actual bounded write

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-10 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS='obo_offer_summary=0,listing=250,listing_revision=150,notification=100' \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

Forbidden: no `EMBEDDING_BACKFILL_FORCE=1`.

## AA4 — Post-write verification

Verify 8,565 → 9,065; `--check-lock t20-tranche-10` exit 2; full validation bundle PASS.

---

# T20.12AB — Docs update after Tranche 10 actual

Allowed: `PHASE_20_COPILOT_CONTEXT.md`, `rp-ai-phase-20-hardening-20260625.md`

```bash
git commit -m "docs(ai): record T20.12AA tranche 10 embedding results"
```

---

# T20.12AC — Post–Tranche 10 readiness + live inference eval

Allowed: `docs/ai-platform/T20-12AC-post-tranche10-readiness-eval.md`

Run full eval bundle including `rp-ai-live-inference-transcript.sh`. Document shadow p95 if elevated.

Required verdict:

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

```bash
git commit -m "docs(ai): add T20.12AC post tranche 10 readiness eval"
```

---

# T20.12AD — Tranche 11 dry-run plan only

New tranche id: `t20-tranche-11`

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-11 EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS='obo_offer_summary=0,listing=250,listing_revision=150,notification=100' \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

Create: `docs/ai-platform/T20-12AD-tranche11-dry-run-plan.md`

Projected after Tranche 11 actual: **9,565 (~13.1%)**.

```bash
git commit -m "docs(ai): add T20.12AD tranche 11 dry-run plan"
```

**Stop after T20.12AD.**

Next actual write requires:

```text
Approved: start T20.12AE actual t20-tranche-11 write
```

---

## Finish-to-10k ladder (remaining)

| Bundle | Approval phrase | Projected embedded |
|--------|-----------------|-------------------:|
| **AA→AD** (this plan) | `Approved: start T20.12AA actual t20-tranche-10 write` | 9,065 |
| **AE→…** | `Approved: start T20.12AE actual t20-tranche-11 write` | 9,565 |
| **AI→…** | `Approved: start T20.12AI actual t20-tranche-12 write` | **10,065** |

At 10,065: run **T20.13** comprehensive vector rollout readiness re-eval before Phase 21 or T20.14/T20.15.

```text
Embedding ladder can continue.
Rollout cannot.
Phase 21 cannot.
```

## References

| Doc | Path |
|-----|------|
| Tranche 10 dry-run | `docs/ai-platform/T20-12Z-tranche10-dry-run-plan.md` |
| Post–Tranche 9 eval | `docs/ai-platform/T20-12Y-post-tranche9-readiness-eval.md` |
| Tranche 9 bundle (completed) | `docs/ai-platform/T20-12W-tranche9-bundle-flight-plan.md` |
