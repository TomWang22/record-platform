# RP messaging schema migration (RP 5444 → runtime 5434)

## Source of truth

RP **messaging** inherits **RP messaging** (`5444-messaging`), not RP `social` or `5434-social`.

| Role | Path / port |
|------|-------------|
| RP source dump | `backups/all-8-20260517-152701/5444-messaging.dump` |
| RP runtime dump | `backups/hybrid-rp-och/materialized-rp-runtime/5434-messaging.dump` |
| Runtime port | `5434` |
| Database name | `messaging` |
| Kubernetes service | `messaging-service` |

## Proof

Run:

```bash
bash scripts/compare-messaging-dumps.sh
```

As of materialization `2026-05-20`, `5434-messaging.dump` is **byte-identical** to `5444-messaging.dump` (same SHA-256). Extensions and `pg_settings` TSVs match. No allowlisted schema drift.

Unexpected differences must be added to `infra/contracts/messaging-dump-diff-allowlist.json` with justification — never silent acceptance.

## RP naming

Use **community / messaging** in product copy. Do not expose housing/social/booking terminology on active RP paths.

## Community roles and post intent (Record Platform)

Roles: collector, seller, buyer, trader, appraiser, archivist, enthusiast, store_owner, auction_watcher.

Post intent / flairs: showcase, looking_to_buy, looking_to_sell, trade_offer, price_check, authentication_help, collection_story, marketplace_alert, auction_watch, restoration, grading, shipping_help, scam_warning, general_discussion.

Thread model (when schema supports): user-to-user, listing-linked, record-linked, offer/negotiation context, moderation flags, read receipts, attachments/media refs.

## Manifest

Hybrid backup `manifest.json` includes `messaging.runtime_port`, `messaging.source`, and `messaging.source_dump` for lineage audit.
