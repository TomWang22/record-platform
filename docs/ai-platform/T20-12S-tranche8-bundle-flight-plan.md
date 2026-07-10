# Phase 20.12 — Tranche 8 bundle flight plan (T20.12S→V)

**Status:** PLAN ONLY — **T20.12S actual write NOT APPROVED**  
**Baseline SHA:** `37fd945`  
**Audience:** Cursor / Copilot agents executing embedding ladder ops

## Locked baseline

```text
Embedded: 7,565 (~10.4% of 73,043 non-message chunks)
T20.12R dry-run: 500/500 selected (t20-tranche-8)
Projected after Tranche 8 actual: 8,065 (~11.0%)
Gap to 10k after Tranche 8: +1,935
Vector rollout: NOT APPROVED
Production retrieval: keyword
Production RAG model_used: rule-engine
Shadow diagnostics: Ollama embeddings + pgvector only
AI_RAG_SHADOW_VECTOR=0
AI_RAG_SHADOW_ENTITY_HINTS=0
AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0
Phase 21: not started
OBO eligible pool: 0 (exhausted)
```

## Operating rule

**One approval → full bundle → stop before next write.**

After owner sends the exact approval phrase, run **T20.12S → T → U → V** end-to-end without asking for docs, eval, dry-run, or transcript sub-steps.

The **only** step requiring explicit approval is each **actual DB write**.

Do **not** ask for confirmation for: docs update (T), readiness eval (U), live inference transcript, next dry-run (V).

Do **stop before:** any actual write, backup for a write, `EMBEDDING_BACKFILL_FORCE=1`, vector rollout, Phase 21.

Never commit: `bench_logs/`, `backups/`, tranche lock JSON, DB dumps, screenshots, `webapp/test-results/`, coverage artifacts.

---

## Approval gate

Only start T20.12S when owner sends exactly:

```text
Approved: start T20.12S actual t20-tranche-8 write
```

When that phrase appears, run the full bundle below, then stop before T20.12W actual write.

---

# T20.12S — Actual t20-tranche-8 write

**Status:** blocked until exact approval phrase.

Use caps from T20.12R dry-run (post-OBO):

```text
obo_offer_summary=0,listing=250,listing_revision=150,notification=100
```

Expected:

| Metric | Value |
|--------|------:|
| pre-count | 7,565 |
| new embeddings | +500 |
| post-count | 8,065 |
| coverage | ~11.0% |
| gap to 10k | +1,935 |

## S1 — Fresh warm pre-write gate

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

## S2 — Fresh backup

```bash
PGPASSWORD=postgres PG_DUMP_JOBS=4 \
BACKUP_TIMESTAMP=t20-12-tranche8-preflight \
bash scripts/backup-rp-postgres-dbs.sh
```

Expected local path: `backups/rp-all-11-t20-12-tranche8-preflight/` (do not commit).

## S3 — Actual bounded write

Only after backup succeeds:

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-8 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS='obo_offer_summary=0,listing=250,listing_revision=150,notification=100' \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

Forbidden: no `EMBEDDING_BACKFILL_FORCE=1`; no broad backfill; no previous tranche rerun.

## S4 — Post-write verification

```bash
source scripts/lib/rp-python-ai-psql.sh
rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;"

bash scripts/rp-ai-embedding-backfill-controlled.sh --check-lock t20-tranche-8
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

Expected: post-count 8,065; tranche 8 lock exit 2; wrong_dim=0; message_embeddings=0; proxy_leaks=0; vector rollout still NOT APPROVED.

---

# T20.12T — Docs update after Tranche 8 actual

**Status:** auto-run after successful T20.12S.

Allowed files:

- `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`
- `docs/release/rp-ai-phase-20-hardening-20260625.md`

Record: t20-tranche-8 complete; +500; 7,565 → 8,065; ~11.0%; post-OBO caps; backup path; FORCE not used; validation PASS; rollout NOT APPROVED.

```bash
git add docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md
git add docs/release/rp-ai-phase-20-hardening-20260625.md
git commit -m "docs(ai): record T20.12S tranche 8 embedding results"
git push
```

---

# T20.12U — Post-Tranche 8 readiness + live inference eval

**Status:** auto-run after T20.12T.

Allowed file: `docs/ai-platform/T20-12U-post-tranche8-readiness-eval.md`

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

Required verdict:

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

```bash
git add docs/ai-platform/T20-12U-post-tranche8-readiness-eval.md
git commit -m "docs(ai): add T20.12U post tranche 8 readiness eval"
git push
```

---

# T20.12V — Tranche 9 dry-run plan only

**Status:** auto-run after T20.12U.

New tranche id: `t20-tranche-9`

Suggested post-OBO caps (same template until pools constrain):

```text
obo_offer_summary=0,listing=250,listing_revision=150,notification=100
```

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-9 \
EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS='obo_offer_summary=0,listing=250,listing_revision=150,notification=100' \
bash scripts/rp-ai-embedding-backfill-controlled.sh

bash scripts/rp-ai-embedding-backfill-controlled.sh --check-lock t20-tranche-8
bash scripts/rp-ai-backfill-rerun-guard-smoke.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Create: `docs/ai-platform/T20-12V-tranche9-dry-run-plan.md`

Projected after Tranche 9 actual (if +500): **8,565 (~11.7%)**.

```bash
git add docs/ai-platform/T20-12V-tranche9-dry-run-plan.md
git commit -m "docs(ai): add T20.12V tranche 9 dry-run plan"
git push
```

**Stop after T20.12V.** Do not run actual t20-tranche-9 write.

Next actual write requires:

```text
Approved: start T20.12W actual t20-tranche-9 write
```

---

## Ladder to 10k (after Tranche 8)

| After tranche | Embedded | Coverage | Gap to 10k |
|---------------|--------:|---------:|-----------:|
| Tranche 8 (S) | 8,065 | ~11.0% | +1,935 |
| Tranche 9 (W) | 8,565 | ~11.7% | +1,435 |
| Tranche 10 | 9,065 | ~12.4% | +935 |
| Tranche 11 | 9,565 | ~13.1% | +435 |
| Tranche 12 | 10,065 | ~13.8% | **≥10k embedded gate clears** |

Tranche 12 projected: **10,065 embedded**. Clears the **≥10k embedded** gate, even though percentage coverage is only **~13.8%** and still below **15%**. Vector rollout remains NOT APPROVED until all gates pass.

## References

| Doc | Path |
|-----|------|
| Tranche 8 dry-run | `docs/ai-platform/T20-12R-tranche8-dry-run-plan.md` |
| Post–Tranche 7 eval | `docs/ai-platform/T20-12Q-post-tranche7-readiness-eval.md` |
| Tranche 7 bundle (completed) | `docs/ai-platform/T20-12O-tranche7-bundle-flight-plan.md` |
| Source of truth | `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md` |
| Live inference harness | `scripts/rp-ai-live-inference-transcript.sh` |
