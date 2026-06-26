# Phase 20.12 — Tranche 9 bundle flight plan (T20.12W→Z)

**Status:** PLAN ONLY — **T20.12W actual write NOT APPROVED**  
**Baseline SHA:** `0ef658e`  
**Audience:** Cursor / Copilot agents executing embedding ladder ops

## Locked baseline

```text
Embedded: 8,065 (~11.0% of 73,043 non-message chunks)
T20.12V dry-run: 500/500 selected (t20-tranche-9)
Projected after Tranche 9 actual: 8,565 (~11.7%)
Gap to 10k after Tranche 9: +1,435
Vector rollout: NOT APPROVED
Production retrieval: keyword
Production RAG model_used: rule-engine
Shadow diagnostics: Ollama embeddings + pgvector only
AI_RAG_SHADOW_VECTOR=0
AI_RAG_SHADOW_ENTITY_HINTS=0
AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0
Phase 21: not started
OBO eligible pool: 0 (exhausted)
Shadow p95 (T20.12U): 4,911 ms — CONDITIONAL (does not block ladder; blocks rollout)
```

## Operating rule

**One approval → full bundle → stop before next write.**

After owner sends the exact approval phrase, run **T20.12W → X → Y → Z** end-to-end without asking for docs, eval, dry-run, or transcript sub-steps.

The **only** step requiring explicit approval is each **actual DB write**.

Do **not** ask for confirmation for: docs update (X), readiness eval (Y), live inference transcript, next dry-run (Z).

Do **stop before:** any actual write, backup for a write, `EMBEDDING_BACKFILL_FORCE=1`, vector rollout, Phase 21.

Never commit: `bench_logs/`, `backups/`, tranche lock JSON, DB dumps, screenshots, `webapp/test-results/`, coverage artifacts.

---

## Approval gate

Only start T20.12W when owner sends exactly:

```text
Approved: start T20.12W actual t20-tranche-9 write
```

When that phrase appears, run the full bundle below, then stop before T20.12AA actual write.

---

# T20.12W — Actual t20-tranche-9 write

**Status:** blocked until exact approval phrase.

Use caps from T20.12V dry-run (post-OBO):

```text
obo_offer_summary=0,listing=250,listing_revision=150,notification=100
```

Expected:

| Metric | Value |
|--------|------:|
| pre-count | 8,065 |
| new embeddings | +500 |
| post-count | 8,565 |
| coverage | ~11.7% |
| gap to 10k | +1,435 |

## W1 — Fresh warm pre-write gate

```bash
git status --short

BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 \
  bash scripts/rp-ai-shadow-real-query-timing.sh

bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Required: source diagnostic PASS (≥5 types, ideally 6); contracts/smoke/OCH PASS; leakage 0; flags 0/0.

If cold source diagnostic fails from embed timeout: rerun warmup/diagnostic only — do not start backup/write from cold failed diagnostic.

## W2 — Fresh backup

```bash
PGPASSWORD=postgres PG_DUMP_JOBS=4 \
BACKUP_TIMESTAMP=t20-12-tranche9-preflight \
bash scripts/backup-rp-postgres-dbs.sh
```

Expected local path: `backups/rp-all-11-t20-12-tranche9-preflight/` (do not commit).

## W3 — Actual bounded write

Only after backup succeeds:

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-9 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS='obo_offer_summary=0,listing=250,listing_revision=150,notification=100' \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

Forbidden: no `EMBEDDING_BACKFILL_FORCE=1`; no broad backfill; no previous tranche rerun.

## W4 — Post-write verification

```bash
source scripts/lib/rp-python-ai-psql.sh
rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;"

bash scripts/rp-ai-embedding-backfill-controlled.sh --check-lock t20-tranche-9
bash scripts/rp-ai-backfill-rerun-guard-smoke.sh

bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Expected: post-count 8,565; tranche 9 lock exit 2; wrong_dim=0; message_embeddings=0; proxy_leaks=0; vector rollout still NOT APPROVED.

---

# T20.12X — Docs update after Tranche 9 actual

**Status:** auto-run after successful T20.12W.

Allowed files:

- `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`
- `docs/release/rp-ai-phase-20-hardening-20260625.md`

Record: t20-tranche-9 complete; +500; 8,065 → 8,565; ~11.7%; post-OBO caps; backup path; FORCE not used; validation PASS; rollout NOT APPROVED.

```bash
git add docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md
git add docs/release/rp-ai-phase-20-hardening-20260625.md
git commit -m "docs(ai): record T20.12W tranche 9 embedding results"
git push
```

---

# T20.12Y — Post-Tranche 9 readiness + live inference eval

**Status:** auto-run after T20.12X.

Allowed file: `docs/ai-platform/T20-12Y-post-tranche9-readiness-eval.md`

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-ai-backfill-rerun-guard-smoke.sh
bash scripts/rp-ai-live-inference-transcript.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Doc must note shadow p95 if elevated (T20.12U: 4,911 ms CONDITIONAL — ladder continues; rollout blocked).

Required verdict:

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

```bash
git add docs/ai-platform/T20-12Y-post-tranche9-readiness-eval.md
git commit -m "docs(ai): add T20.12Y post tranche 9 readiness eval"
git push
```

---

# T20.12Z — Tranche 10 dry-run plan only

**Status:** auto-run after T20.12Y.

New tranche id: `t20-tranche-10`

Suggested post-OBO caps:

```text
obo_offer_summary=0,listing=250,listing_revision=150,notification=100
```

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-10 \
EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS='obo_offer_summary=0,listing=250,listing_revision=150,notification=100' \
bash scripts/rp-ai-embedding-backfill-controlled.sh

bash scripts/rp-ai-embedding-backfill-controlled.sh --check-lock t20-tranche-9
bash scripts/rp-ai-backfill-rerun-guard-smoke.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Create: `docs/ai-platform/T20-12Z-tranche10-dry-run-plan.md`

Projected after Tranche 10 actual (if +500): **9,065 (~12.4%)**.

```bash
git add docs/ai-platform/T20-12Z-tranche10-dry-run-plan.md
git commit -m "docs(ai): add T20.12Z tranche 10 dry-run plan"
git push
```

**Stop after T20.12Z.** Do not run actual t20-tranche-10 write.

Next actual write requires:

```text
Approved: start T20.12AA actual t20-tranche-10 write
```

---

## Ladder to 10k (after Tranche 9)

| After tranche | Embedded | Coverage | Gap to 10k |
|---------------|--------:|---------:|-----------:|
| Tranche 9 (W) | 8,565 | ~11.7% | +1,435 |
| Tranche 10 (AA) | 9,065 | ~12.4% | +935 |
| Tranche 11 | 9,565 | ~13.1% | +435 |
| Tranche 12 | 10,065 | ~13.8% | **≥10k embedded gate clears** |

Tranche 12 projected: **10,065 embedded**. Clears the **≥10k embedded** gate, even though percentage coverage is only **~13.8%** and still below **15%**. Vector rollout remains NOT APPROVED until all gates pass (overlap, latency, etc.).

## References

| Doc | Path |
|-----|------|
| Tranche 9 dry-run | `docs/ai-platform/T20-12V-tranche9-dry-run-plan.md` |
| Post–Tranche 8 eval | `docs/ai-platform/T20-12U-post-tranche8-readiness-eval.md` |
| Tranche 8 bundle (completed) | `docs/ai-platform/T20-12S-tranche8-bundle-flight-plan.md` |
| Source of truth | `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md` |
| Live inference harness | `scripts/rp-ai-live-inference-transcript.sh` |
