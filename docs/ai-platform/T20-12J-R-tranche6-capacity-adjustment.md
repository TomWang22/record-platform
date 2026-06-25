# T20.12J-R — Tranche 6 dry-run capacity adjustment

**Status:** READ-ONLY analysis complete — **actual write NOT APPROVED**  
**Generated:** 2026-06-25  
**Baseline SHA:** `03c5dec`  
**Related:** T20.12J dry-run (`t20-tranche-6`, selected **476** not 500)

## Summary

T20.12J requested 500 embeddings but selected **476** because the **OBO unembedded pool is exhausted**: only **126** eligible `obo_offer_summary` chunks remain under backfill selection rules (requested cap 150). The unfilled **24** can be safely shifted to **listing**, which has **7,018** eligible unembedded chunks. **Rollout is unaffected** — vector rollout remains **NOT APPROVED**.

## Corpus snapshot (read-only SQL, 2026-06-25)

Selection rules match `scripts/rp-ai-embedding-backfill-controlled.sh`:

- `embedding_vec IS NULL`
- `embedding_status` null or `pending` / `degraded` / `missing`
- `source_type <> 'message'`
- content excludes forbidden patterns (`max_bid_cents`, `proxy_bids`, `proxy max`, `message_body`, `thread_text`)

| source_type | embedded | unembedded eligible | total |
|-------------|--------:|--------------------:|------:|
| notification | 900 | 54,551 | 55,451 |
| listing | 2,300 | 7,018 | 9,318 |
| listing_revision | 1,100 | 4,783 | 5,883 |
| obo_offer_summary | 1,418 | **126** | 1,544 |
| record | 594 | 0 | 594 |
| auction_bid_summary | 253 | 0 | 253 |

**Total embedded:** 6,565 (~9.0% of 73,043 non-message chunks)

### OBO breakdown

All 126 remaining OBO chunks are eligible — none excluded by forbidden-regex filter or non-pending status. After Tranche 6 actual (if all 126 are written), **OBO backfill capacity under current rules is zero** until new OBO documents/chunks are ingested.

---

## Answers

### 1. How many unembedded OBO chunks remain?

**126** — this is the full eligible pool, not a partial cap artifact.

### 2. Why did OBO select only 126?

T20.12J dry-run requested `obo_offer_summary=150`. The controlled backfill selector runs per-type `LIMIT` against eligible rows (`embedding_vec IS NULL`, status filter, forbidden-content filter). Only **126** rows exist for `obo_offer_summary`; the selector cannot invent more. Tranches 2–5 embedded 1,418 OBO chunks; **record** and **auction_bid_summary** are already 100% embedded.

### 3. Can the remaining 24 be safely shifted to listing / listing_revision / notification?

**Yes — shift to listing is the safest choice.**

| Type | Eligible headroom after T20.12J dry-run caps | Absorb +24? |
|------|---------------------------------------------|-------------|
| listing | 7,018 − 200 = **6,818** | **Yes** (recommended) |
| listing_revision | 4,783 − 100 = 4,683 | Yes (alternative) |
| notification | 54,551 − 50 = 54,501 | Yes (large pool; keep cap low for diversity) |

Listing is preferred because T20.12J already saturated its 200 cap and is the primary marketplace corpus type toward 10k.

### 4. Adjusted per-type caps for Tranche 6 actual (if approved)?

Two valid options:

**Option A — match T20.12J dry-run exactly (476 total):**

```json
{
  "obo_offer_summary": 126,
  "listing": 200,
  "listing_revision": 100,
  "notification": 50
}
```

Projected: 6,565 + 476 = **7,041** (~**9.6%**)

**Option B — adjusted caps to preserve +500 ladder (recommended):**

```json
{
  "obo_offer_summary": 126,
  "listing": 224,
  "listing_revision": 100,
  "notification": 50
}
```

Projected: 6,565 + 500 = **7,065** (~**9.7%**)

Env form for Option B:

```bash
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=126,listing=224,listing_revision=100,notification=50"
```

### 5. Caps for future tranches after OBO is exhausted?

After Tranche 6 actual embeds the remaining 126 OBO chunks, set **`obo_offer_summary=0`** (or omit) until new OBO ingestion adds eligible chunks.

Suggested **+500 template** (Tranche 7+):

```json
{
  "obo_offer_summary": 0,
  "listing": 250,
  "listing_revision": 150,
  "notification": 100
}
```

Alternative if prioritizing revision coverage:

```json
{
  "obo_offer_summary": 0,
  "listing": 200,
  "listing_revision": 200,
  "notification": 100
}
```

Both stay within eligible pools (listing 6,818+, listing_revision 4,683+, notification 54,501+ post–Tranche 6). **record** and **auction_bid_summary** remain at 0 unless new unembedded chunks appear.

Ladder to 10k from ~7,065 after adjusted Tranche 6: **~2,935** embeddings remaining → **~6** more +500 tranches (or fewer if caps increase with ops approval).

### 6. Does this affect rollout?

**No.** Coverage would move from 9.0% → ~9.6–9.7%, still below the ≥10k / ≥15% rollout bar. Production retrieval stays **keyword**; `model_used` stays **rule-engine**; overlap flags stay **0/0/0**; Phase 21 not started.

```text
Vector rollout: NOT APPROVED
Production retrieval: keyword + rule-engine
```

---

## Recommendation (explicit)

**Do not approve T20.12K actual until caps are chosen.**

| Path | Action | When to use |
|------|--------|-------------|
| **Option B (recommended)** | **Rerun dry-run** with adjusted caps (`obo=126, listing=224, listing_revision=100, notification=50`) and confirm **500 selected** before T20.12K approval | Embedding ladder goal (+500 per tranche) |
| Option A | Approve actual write for **exact 476** from T20.12J without cap change | Accept +476 this tranche; adjust Tranche 7+ template only |
| Option C | Pause tranches; revisit source-type strategy | Only if diversity/rollout gates need rebalancing before more writes |

**Recommended T20.12K path:** **Option B** — rerun `t20-tranche-6` dry-run with adjusted caps, verify 500 selected, then seek explicit approval:

```text
Approved: start T20.12K actual t20-tranche-6 write
```

with caps documented in the dry-run artifact used for the actual write.

**Not approved:** actual write, backup, `EMBEDDING_BACKFILL_FORCE=1`, vector default, Phase 21.

---

## Evidence sources

- T20.12J dry-run plan: `docs/ai-platform/T20-12J-tranche6-dry-run-plan.md`
- Local dry-run artifact: `bench_logs/ai-platform/t18-7-controlled-backfill-plan.md` (476 selected)
- Read-only SQL via `scripts/lib/rp-python-ai-psql.sh` (2026-06-25)
- Selection logic: `scripts/rp-ai-embedding-backfill-controlled.sh` (`SELECT_SQL`, `PER_TYPE_LIMITS`)
