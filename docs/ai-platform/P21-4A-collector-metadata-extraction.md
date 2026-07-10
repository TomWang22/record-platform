# P21.4A — Collector metadata extraction

**Status:** Implemented  
**Baseline SHA:** `9555bba`  
**Phase:** 21 — non-vector product track

---

## Summary

Replaced shallow 7-field `_scan_collector_metadata` with deterministic **22-field** extraction for vinyl/record listings. Field-level map, completeness score, and collector-specific edit guidance now power the collector metadata gaps endpoint, listing advice, and longform collector turns.

---

## Metadata fields

`title`, `artist`, `album`, `label`, `catalog_number`, `pressing`, `country`, `year`, `format`, `condition_media`, `condition_sleeve`, `grade`, `variant`, `edition`, `provenance`, `scarcity_signal`, `price`, `seller_notes`, `photos_or_visuals`, `defects_or_wear`

Each field: `present | missing | unknown` with optional sanitized `value`, short `evidence`, and `confidence` (`high|medium|low`).

---

## Output model

| Key | Description |
| --- | ----------- |
| `field_map` | Per-field entries for API/details |
| `completeness_score` | Weighted 0–100 (high-priority fields weighted 2×) |
| `high_priority_missing` | pressing, grades, label/cat#, photos, title, price |
| `recommended_listing_edits` | Highest-impact grounded edits |
| `collector_risk_notes` | e.g. do not invent scarcity; grade absent |

---

## Synthesis format

```text
Collector metadata check:
- Present: title, price, seller notes
- Missing or unclear: pressing, condition_media, label, catalog_number
- Highest-impact edits: add media/sleeve condition and a clear grade (e.g. VG+/VG)
- Collector risk: Do not claim rarity or scarcity without explicit excerpt evidence.
- Completeness score: 42/100
Grounding: based on N excerpt(s) from listing, record.
```

---

## Files

| File | Change |
| ---- | ------ |
| `app/ai/rag_synthesis.py` | `extract_collector_metadata`, updated synthesis + `build_collector_metadata_gaps` |
| `tests/test_collector_metadata_extraction.py` | Rich/sparse/record/leakage tests |
| `tests/test_rag_synthesis.py` | Updated collector template expectations |

---

## Boundaries

- Keyword retrieval unchanged
- No vector rollout
- No invented scarcity or message bodies
- Values extracted only from retrieved excerpts

---

## Validation

```bash
cd services/python-ai-service && source .venv/bin/activate
PYTHONPATH=. python -m pytest tests/ -q
```
