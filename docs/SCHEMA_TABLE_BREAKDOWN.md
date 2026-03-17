# Schema and table breakdown (all 8 DBs)

Single reference for **port → database → schema → table** across the platform. Use with **docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md** (which files to apply) and **docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md** (row caps).

---

## Port 5433 — records

| Schema   | Table / object | Purpose |
|----------|----------------|---------|
| records  | records        | Primary collection records; columns match **records_chunks/chunk_001.csv** (user_id, artist, name, format, catalog_number, notes, purchased_at, price_paid, record_grade, sleeve_grade, release_year, release_date, pressing_year, label, label_code, has_insert, has_booklet, has_obi_strip, has_factory_sleeve, is_promo). Prisma columns from 46. |
| records  | (functions)    | norm_text, search, etc. |
| public   | (extensions)  | citext, pg_trgm, unaccent, etc. |

---

## Port 5434 — social

| Schema   | Table / object | Purpose |
|----------|----------------|---------|
| forum    | posts, comments, … | Forum content |
| messages | groups, group_members | Group chat; role (owner/admin/moderator/contributor/member/read_only), left_at |
| messages | messages        | 1:1 or group; is_read; message_reads = who read (read_at, read_by_sender) |
| messages | message_attachments | image, video, audio, document, sticker |
| messages | message_reads   | Per-user read receipt; for groups shows who read |
| public   | (extensions)    | pg_trgm, pgcrypto, citext |

---

## Port 5435 — listings

| Schema   | Table / object | Purpose |
|----------|----------------|---------|
| listings | listings       | Catalog (price, currency, location, seller_country, shipping_type, promotion_type, promotion_ends_at, discount_price, bundle_id, etc.) |
| listings | listing_shipping_options | Multiple shipping options when shipping_type = 'multiple' |
| listings | listing_reports | Flag/report inaccurate listings; complaint_sent_at for dual-write to seller notification |
| listings | seller_availability | Seller offline/available, preferred_hours, unavailable_until |
| listings | (others)       | auction_details, bids, listing_images, offers, ratings, reports, etc. |
| public   | (extensions)   | pg_trgm, pgcrypto, citext |

---

## Port 5436 — shopping

| Schema   | Table / object        | Purpose |
|----------|------------------------|---------|
| shopping | shopping_cart          | Cart lines (quantity, price); cost via cart_summary / cart_lines_with_total views |
| shopping | watchlist             | Watchlist (remove = DELETE row) |
| shopping | recently_viewed        | Recently viewed items (append-only; cleanup job trims) |
| shopping | wishlist              | Wishlist |
| shopping | purchase_history      | Completed purchases (resellable flag) |
| shopping | search_history        | Search history |
| shopping | cache_metadata        | LFU/LRU cache metadata |
| shopping | orders                | Orders (subtotal, shipping_cost, tax, total, ship_to_country) |
| shopping | cart_session          | Per-user ship_to_country override |
| shopping | notifications         | In-app notifications (cart removed, listing_reported, etc.) |
| shopping | price_alerts          | Notify when listing price drops to target |
| shopping | saved_searches        | Saved search; notify_on_new when new listings match |
| shopping | discount_codes        | Codes for percent/fixed discount at checkout |
| shopping | bundle_shipping_offers | Seller bundle shipping (e.g. free over N items) |
| shopping | (views)               | cart_summary, cart_lines_with_total |
| feedback | user_profiles        | Display name, bio, collection_visible |
| feedback | user_activity        | Activity history |
| feedback | collection_stats      | Denormalized collection size |
| feedback | reviews               | eBay-style reviews (rating 1–5, seller/buyer, transaction_id) |

---

## Port 5437 — auth

| Schema | Table / object   | Purpose |
|--------|------------------|---------|
| auth   | users            | Users (email, password_hash, mfa, etc.) |
| auth   | user_addresses   | Addresses and country_code (tax/shipping) |
| auth   | (sessions, passkeys, etc.) | Per auth-schema-extended / passkeys |

---

## Port 5438 — postgres (auction_monitor)

| Schema           | Table / object | Purpose |
|------------------|----------------|---------|
| auction_monitor  | (tables)       | Auctions, bids, monitoring |

---

## Port 5439 — analytics

| Schema    | Table / object | Purpose |
|-----------|----------------|---------|
| analytics | (tables)       | Analytics events, aggregations |

---

## Port 5440 — python_ai

| Schema | Table / object | Purpose |
|--------|----------------|---------|
| ai     | (tables)       | Python AI service data |

---

## Applying schemas (one file per DB)

After running **scripts/bundle-db-schemas.sh**, use the bundled files for a single-file apply (backup-like):

```bash
# Example: apply full shopping schema from one file
psql -h 127.0.0.1 -p 5436 -U postgres -d shopping -f infra/db/bundles/5436-shopping.sql
```

See **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md** for the full checklist.
