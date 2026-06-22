# T20.10 — Shadow diagnostics runbook

## Goal

Measure shadow vector retrieval with real prompts while keeping keyword retrieval as production default.

## Safe mode

- Do not enable vector as default
- Use `shadow_vector=true`
- Optional: `shadow_debug=true` for full `details.shadow_diagnostics` block
- No backfill in this ticket

## Command sequence

```bash
git rev-parse HEAD

bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs

bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh

bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-och-decontaminate-scan.sh
```

## Review checklist

- p95 shadow latency (`timings_ms.total`)
- phase breakdown: embed / candidate_fetch / privacy_filter / rerank_select
- zero-overlap runs (`overlap.count`)
- zero-result runs (`counts.selected_count`)
- source-type skew (`by_source_type`)
- owner-visible OBO depth (SQL diagnostic in shadow-source script)
- privacy drop counts (`privacy.*`)

## Diagnostics contract

**Stable path:** `details.shadow_diagnostics` (not `metadata`).

Emitted only when **both** `shadow_vector=true` and `shadow_debug=true`.

### Query params

| Param | Type | Purpose |
|-------|------|---------|
| `shadow_vector` | bool | Enable shadow vector comparison (keyword still default) |
| `shadow_debug` | bool | Emit full `details.shadow_diagnostics` block |
| `shadow_profile` | string | Route profile name, e.g. `obo_helper` |
| `shadow_profile_hints` | bool | Apply built-in profile hint terms to embedding query |
| `shadow_query_hints` | comma-separated string | Custom hint terms, e.g. `obo,owner_visible` |

Do not use `shadow_query_hints` as a boolean. Use `shadow_profile_hints=true` for profile hints.

When `shadow_vector=true` and `shadow_debug=true`, responses include:

```json
{
  "details": {
    "shadow_diagnostics": {
      "enabled": true,
      "profile": "obo_helper",
      "timings_ms": { "embed": 0, "candidate_fetch": 0, "total": 0 },
      "counts": { "candidate_count_raw": 0, "selected_count": 0 },
      "by_source_type": { "raw": {}, "selected": {} },
      "overlap": { "count": 0, "ratio_vs_keyword": 0.0 },
      "privacy": { "blocked_message_count": 0 }
    }
  }
}
```

Keyword-only requests must not include `shadow_diagnostics`.
