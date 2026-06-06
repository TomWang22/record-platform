# Record Platform × OCH merge decisions

Record Platform is **not** housing. This document records what we keep, port, hybrid-merge, or exclude.

## Canonical domain ownership

| Service | Source of truth | Notes |
|---------|-----------------|-------|
| records-service | **RP** | Vinyl catalog: artist, title, pressing, grades, obi, inserts |
| listings-service | **Hybrid** | RP record marketplace fields + OCH infra (search, revisions, Kafka, cache, trust hooks) |
| shopping-service | **RP** | Orders, payments flow, shipment/tracking — replaces OCH booking |
| auth-service | **RP-first** | Keep RP password hashes; merge OCH only where additive; demo users namespaced |
| messaging-service | **OCH port** | Reusable platform service |
| media-service | **OCH port** | Bucket `record-media`; listings + messages |
| trust-service | **OCH port** | Seller/buyer ratings for marketplace |
| notification-service | **OCH port** | Categories: message, listing, order, shipment, trust, system — **no booking** |
| analytics-service | **OCH optional** | Off by default (`RP_ENABLE_ANALYTICS_AI=0`) |
| booking-service | **Excluded** | Do not deploy, restore, or route |

## Database restore policy (hybrid backup)

See `backups/hybrid-rp-och/README.md`.

- **RP dumps:** auth (credentials), records, shopping; listings overlay reference
- **OCH dumps:** messaging, media, trust, notification, analytics; listings base (sanitize PII before share)
- **Never restore:** bookings DB

Restore order: auth → records → listings → media → messaging → trust → notification → shopping → analytics

## Listings privacy

Public API must not return street address, postal code, lat/lng, email, phone, or exact coordinates. See `RP_PRIVACY_LISTING_CONTRACT.md`.

## Service merge (no blind rsync)

- Do not overwrite RP repo with OCH tarball wholesale
- Port OCH services per directory with RP namespace, ports, env, and k8s limits
- Gateway: no `/api/bookings`
- Webapp: vinyl marketplace UI; no housing copy

## Phased delivery

1. Hybrid backup assembler + validator (symlinks, minimal disk)
2. K8s memory limits + optional service skeletons
3. messaging / media / trust / notification
4. Listings hybrid + privacy contract + tests
5. Gateway + webapp routes
6. analytics / ollama optional
7. Cold-bootstrap dry-run only after validate-hybrid-backup passes

## Network contract (required before bootstrap)

- Edge: `https://record-platform.test` via MetalLB (TCP+UDP 443), SNI `record-platform.test`
- `make rp-preflight-network-contract` (static audit + live curl h1/h2/h3)
- See `docs/porting/RP_NETWORK_CONTRACT.md`

## Do not start full stack until

- `validate-hybrid-backup.sh` passes
- `make rp-audit-network-contract` passes
- No active booking-service artifacts
- Public listing privacy tests pass
- Kustomize + pnpm build pass
- Memory limits on all new deployments
