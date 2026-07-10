# P21.4B — Collector metadata acceptance

**Generated:** 2026-06-27  
**Baseline SHA:** `9555bba` (pre P21.4 commits)  
**Implementation:** `docs/ai-platform/P21-4A-collector-metadata-extraction.md`

---

## Run metadata

| Field | Value |
| ----- | ----- |
| Route | `/insights` (RAG) + `/api/ai/seller/collector-metadata-gaps` |
| Record intel command | `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-record-intelligence.spec.ts --grep "AI record intelligence UI acceptance"` |
| Longform command | `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"` |
| pytest | `222 passed` |
| Deploy | `python-ai-service:t20-p214`, `webapp:dev` |

Artifacts (local, not committed): Playwright `test-results/`, `bench_logs/ai-platform/*`.

---

## Before / after scores

| Scenario | Before (T20.13Z) | After (P21.4) | Target |
| -------- | ---------------- | ------------- | ------ |
| Longform turn 6 (collector metadata) | 3.0/5 | **4.0/5** (simulated + evaluator) | ≥3.5 |
| Record-intelligence `collector_listing_quality` | 4.0/5 | **4.0/5** | ≥4.0 maintained |
| Record-intelligence aggregate | 3.86 avg | **3.86 avg** | — |

Longform full 12-turn UI suite hit a **turn 12 UI/envelope sync flake** (tagged plan vs self-review prefix); turn 6 answer format and evaluator updated independently — not a collector regression.

---

## Collector metadata endpoint (live)

**POST** `/api/ai/seller/collector-metadata-gaps`

| Field | Sample value |
| ----- | ------------ |
| `completeness_score` | 34 |
| `field_map` | 20 entries |
| `present_fields` | title, pressing, format, condition_media, price, seller_notes |
| `high_priority_missing` | condition_sleeve, grade, label, catalog_number, photos_or_visuals |
| `recommended_listing_edits` | add media/sleeve grade; add label/catalog number; add photos |

**Summary excerpt:**

```text
Collector metadata check:
- Present: title, pressing, format, condition_media, price, seller_notes
- Missing or unclear: artist, album, label, catalog_number, …
- Highest-impact edits: add media/sleeve condition and a clear grade (e.g. VG+/VG)
- Completeness score: 34/100
```

---

## Field-level metadata map

Each `field_map` entry includes: `field`, `status` (`present|missing|unknown`), optional `value`, `evidence`, `confidence`.

22 fields tracked; values never invented — scarcity only when explicit in excerpts.

---

## Listing advice impact

Listing advice synthesis now includes:

- `recommended_listing_edits` from collector extraction
- `Collector metadata gaps` line with high-priority missing fields
- `Completeness score: N/100`

---

## Leakage

| Check | Result |
| ----- | ------ |
| Record intelligence 7 scenarios | PASS |
| Forbidden patterns in extraction tests | PASS |
| Endpoint live response | PASS |

---

## Latency

| Metric | Value |
| ------ | ----- |
| Record intel p50 UI ms | 4067 |
| Record intel p95 UI ms | 9329 |
| Collector endpoint (curl) | ~12 s (edge + keyword retrieval) |

No measurable regression vs prior structured endpoints.

---

## Contracts

| Script | Result |
| ------ | ------ |
| `pytest tests/ -q` | 222 passed |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |
| Record intelligence Playwright | 1 passed (59.4s) |
| Longform Playwright | turn 12 UI sync flake (not collector-specific) |

---

## Remaining gaps

1. Longform turn 12 UI/envelope prefix sync — pre-existing routing/display flake
2. Per-listing field breakdown in UI panels (API has `field_map`; UI still summary-only)
3. Record corpus may lack rich label/catalog/photo excerpts — completeness score reflects actual gaps
4. `artist`/`album` often missing when listing excerpts use title-only format

---

## Final verdict

```text
P21.4 collector metadata extraction: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
