# P21.4C — Collector metadata field-map UI

**Generated:** 2026-06-28  
**Baseline SHA:** `fec7457` (pre P21.4C commit)  
**Phase:** 21 — non-vector product track

---

## Summary

Exposed API `field_map` and related collector metadata details in the **Collector Metadata Gaps** seller intelligence panel. Hardened longform turn 12 Playwright sync with turn-specific RAG request matching.

---

## UI components

| File | Role |
| ---- | ---- |
| `webapp/components/ai/collector-metadata-field-map.tsx` | Field table, completeness, high-priority missing, recommended edits |
| `webapp/components/ai/seller-intelligence-panels.tsx` | Wired field map into collector panel via `renderDetails` |

---

## Panel render (Collector Metadata Gaps)

| Element | Test ID | Shown |
| ------- | ------- | ----- |
| Completeness score | `collector-metadata-completeness-score` | yes |
| High-priority missing | `collector-metadata-high-priority-missing` | yes |
| Recommended edits | `collector-metadata-recommended-edits` | yes |
| Field table | `collector-metadata-field-map` | yes |
| Field rows | `collector-metadata-field-row` | yes (20 rows live) |

Field columns: field · status · value · confidence · evidence excerpt

Safety: excerpts sanitized via `sanitizeEvidenceExcerpt`; forbidden patterns filtered; no raw JSON dump.

---

## Field map sample (live contract user)

| Field | Status | Notes |
| ----- | ------ | ----- |
| title | present | — |
| pressing | present | — |
| price | present | — |
| label | missing | high-priority |
| catalog_number | missing | high-priority |
| grade | missing | high-priority |

Completeness score shown: **34/100**

---

## Longform turn 12 sync hardening

**Root cause:** Turns 10–12 all POST prompts starting with `ACCUMULATED SESSION CONTEXT`; Playwright matched the first response with that prefix, pairing turn 11 envelope with turn 12 UI.

**Fix:** `ragQueryMatchesTurn(turnId, question, fullPrompt)` in `ai-rag-longform-record-session.ts`:

| Turn | Matcher |
| ---- | ------- |
| `executive_summary` | `10-bullet seller plan` + `[grounded]` in body |
| `red_team_overclaim` | `Review your own advice` + overclaim phrase |
| `final_action_plan_long` | `Using everything above, produce a final seller action plan` |
| Others | exact / suffix match on full prompt |

Turn 12 UI assertions (hard, not soft):

- `[grounded]`
- `[missing evidence]`
- `[needs manual review]`

---

## Validation

| Command | Result |
| ------- | ------ |
| `seller-intelligence-ui.spec.ts` | 1 passed (19.9s) |
| `ai-rag-longform-record-session.spec.ts` | **12/12 pass**, turn 12 score **4.0**, avg **3.67** |
| `rp-och-decontaminate-scan.sh` | PASS |

Screenshot (local only, not committed): Playwright run output; no screenshot artifact staged.

---

## Forbidden scan

Seller intelligence + longform: **PASS** — no `message_body`, `thread_text`, `proxy_bids`, etc.

---

## Latency

| Metric | Value |
| ------ | ----- |
| Seller intelligence total | ~14s |
| Longform turn 12 UI | 2288ms |
| Longform p95 UI | 4762ms |
| Longform full gauntlet | 50.6s |

---

## Remaining gaps

1. Field map not yet on free-form RAG card (seller panel only)
2. Corpus still sparse for label/catalog/photos — completeness score reflects real gaps
3. P21.5 per-panel latency telemetry still pending

---

## Final verdict

```text
P21.4C collector metadata field-map UI: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
