# Evaluation gaps

Mechanical gates that passed on attempt 6 do **not** establish product truth.

## What is checked strongly today

- H1/H2/H3 protocol probes and HTTP 200
- Screenshot presence / distinctness / upload-20 completeness
- Minimum card/lot/result counts (shape floors)
- Schedule completion (24/24, 27/27)
- Some material hash differences between correction pairs (preflight)

## What is not checked (product blockers)

1. **Eligible evidence identity** — which SALE_COMPLETED rows entered the snapshot
2. **Removal reasons** — rights, stale, wrong pressing, duplicate, asking-as-sold
3. **Claim ↔ evidence support** — every numeric claim mapped to snapshot rows
4. **Exact vs release separation** — counts must not collapse
5. **Correction recomputation** — same pipeline replay with superseded facts
6. **Mode honesty** — hybrid actually ran hybrid retrieval, not fixture reorder only
7. **Session fact authority** — persisted facts with source turn / supersession
8. **No invention** — language layer cannot invent sales/bids/prices
9. **Honest-limit semantics** — composites must bind abstention scenario IDs, not success twins
10. **Real-data rights class** — first-party vs permitted catalog vs forbidden scrape

## Dossier weakness (attempt 6 export)

`owner-review-artifacts/phase34/owner-proof-live-v5-pass/dossiers/*.json` are protocol ledgers:

- scenario_id, H1/H2/H3 PASS, hashes, latency
- **Missing:** accepted structured result body, eligible row IDs, fallback flags, evidence snapshot hash

That makes owner “PASS” claims impossible to audit from the dossier alone.

## Required semantic assertion classes

See owner directive §9. Implement as machine-readable gates that fail closed **before** any future owner-proof visual pack.

A different PNG hash is **not** a semantic correction gate.
