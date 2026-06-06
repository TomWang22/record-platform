# Public listing privacy contract (Record Platform)

## Principle

Marketplace **browse and search** are anonymous. Seller location is **city / region / country** only. Fulfillment addresses live in **shopping** tables and authorized order views only.

## Public JSON allowed

- `seller_city`, `seller_region`, `seller_country`
- `approximate_location_label` (human-readable, non-precise)
- Record marketplace fields: artist, title, label, pressing, format, grades, obi, inserts, price, shipping_method, shipping_cost
- `record_id` when linked to catalog

## Public JSON forbidden

Never return on `GET /`, `GET /search`, or anonymous `GET /listings/:id`:

- `address_line1`, `address_line2`, `postal_code`
- `latitude`, `longitude`, `lat`, `lng`
- `email`, `phone`, `phone_number`, `seller_email`, `seller_phone`
- Exact geocode payloads

## Housing fields (quarantined)

Do not expose on public RP responses:

- bedrooms, bathrooms, rent semantics, campus distance, availability calendar, landlord/tenant labels, booking references

Implementation: `services/listings-service/src/listing-public-privacy.ts` (`toPublicListingShape`, `publicListingResponseLeaksPrivateData`).

## Owner / admin

- `includePrivateAddress` and owner `x-user-id` match may return address fields for fulfillment setup
- Still never expose another user's private address on public endpoints

## Tests

- `services/listings-service/tests/listing-public-privacy.test.ts`
- `services/listings-service/tests/http-app.test.ts` (search + detail leak checks)

## Restore validation

`backups/hybrid-rp-och/validation/listings-privacy.sql` — no active listing row should retain public-exposed street address after sanitize (run with `VALIDATE_LIVE=1`).
