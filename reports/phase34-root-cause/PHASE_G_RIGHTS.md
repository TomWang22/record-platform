# Phase G — Real-data and rights posture

**Status:** Implemented on `main` (connector contracts + eligibility/retrieval gates + deletion propagation + SQL registry + unit tests + CI verifier).
**Non-goals:** Attempt 7, screenshots, UI polish, owner-proof PASS, live Popsike/Gripsweat ingest.

## Goal

Build the platform around data the product is entitled to use. Every included event carries a rights class. Forbidden or unlicensed connectors cannot be enabled by ordinary runtime config. Deletion propagates into retrieval and future snapshots. Rights and provenance appear in owner dossiers.

## Preferred evidence

| Class | Connector contract | Rights |
|-------|-------------------|--------|
| Completed settlements | `FIRST_PARTY_SETTLEMENTS` | FIRST_PARTY |
| Listings / asking | `FIRST_PARTY_LISTINGS` | FIRST_PARTY |
| Offers | `FIRST_PARTY_OFFERS` | FIRST_PARTY |
| Auctions | `FIRST_PARTY_AUCTIONS` | FIRST_PARTY |
| Bid history | `FIRST_PARTY_BIDS` | FIRST_PARTY |
| Watchlists | `FIRST_PARTY_WATCHLISTS` | USER_AUTHORIZED |
| Collections | `FIRST_PARTY_COLLECTIONS` | USER_AUTHORIZED |
| Preferences | `FIRST_PARTY_PREFERENCES` | USER_AUTHORIZED |
| Authorized messages | `FIRST_PARTY_MESSAGES` | USER_AUTHORIZED |
| Permitted catalog | `PERMITTED_PUBLIC_CATALOG` | CC0 |
| Licensed archives | `LICENSED_EXTERNAL_ARCHIVE` | LICENSED (disabled until grant) |

Each contract records: rights status, permitted purposes, retention, deletion, attribution, freshness, rate limits, evidence classes.

## Discogs

- API key referenced only as `env:DISCOGS_API_KEY` — never printed or committed.
- Catalog metadata (`discogs-cc0-catalog`) is separate from marketplace/sales.
- Catalog presence ≠ availability ≠ sale (`interpretDiscogsCatalogPresence`).
- Marketplace paths (`/marketplace/`, `/orders`, inventory, fee, price_suggestions) throw `DISCOGS_MARKET_ENDPOINTS_BLOCKED`.
- `discogs-restricted-marketplace` stays `DISABLED_BY_POLICY`; cannot enable.

## Popsike / Gripsweat

- Default contracts: `DISABLED_NO_WRITTEN_RIGHTS` / `PROHIBITED`.
- `POPSIKE_ENABLED=1` / `GRIPSWEAT_ENABLED=1` without a written license grant (memory or `LICENSE_GRANTS_FILE`) throw `PRODUCTION_FORBIDDEN_CONNECTOR_ENV`.
- Attempting to set `connector_status=ENABLED` without a grant throws `FORBIDDEN_CONNECTOR_ENABLEMENT`.

## Modules

| ID | File | Role |
|----|------|------|
| G1 | `scripts/lib/phase34-rights-connectors.mjs` | Contracts, license grants, Discogs gates, deletion, owner dossier provenance |
| G2 | `scripts/lib/phase34-eligibility-engine.mjs` | Rejects FORBIDDEN/UNLICENSED/disabled; requires rights class on INCLUDED |
| G3 | `scripts/lib/phase34-retrieval.mjs` | Filters deleted + rights-blocked docs before ranking |
| G4 | `infra/db/53-intelligence-rights-connectors.sql` | `connector_contracts` + append-only `license_grants` |
| G5 | `tests/phase34-rights-connectors.test.mjs` | Forbidden blocked, Discogs catalog-only, deletion, rights class, license gate |
| G6 | `scripts/ai-platform/verify-phase34-rights-connectors.mjs` | CI verifier |

## Deletion propagation

`markObservationDeleted` / `propagateDeletion`:

- Sets `deletion_status=DELETED`, `exclude_from_retrieval`, `exclude_from_snapshots`.
- Removes matching docs from retrieval-eligible and snapshot-eligible sets.
- Eligibility returns `EXCLUDED_DELETED`.

## Owner dossier

`buildOwnerDossierRightsProvenance` attaches per-evidence rights class, connector, attribution, retention/deletion, Discogs posture flags (`marketplace_used=false`, no API key value).

## Tests / CI

```bash
node --test tests/phase34-rights-connectors.test.mjs
node scripts/ai-platform/verify-phase34-rights-connectors.mjs
make ai-platform-verify-phase34-rights-connectors
```

## Explicit gaps

1. Live Discogs dump ingestion is not turned on here — catalog contract + policy only.
2. No production license grants for Popsike/Gripsweat are recorded; they remain disabled.
3. SQL registry is optional/apply-when-ready; in-memory license grants cover unit/CI gates.
4. Cross-DB deletion fan-out to every materialized index is library-level; operators must apply SQL and wire jobs.
5. Phase H UI / attempt 7 / screenshots remain frozen.

## Gate statement

Phase G rights connectors are enforced in eligibility and retrieval libraries. Forbidden archives cannot enable via ordinary env. Owner dossiers carry rights/provenance fields. Attempt 7 not launched.
