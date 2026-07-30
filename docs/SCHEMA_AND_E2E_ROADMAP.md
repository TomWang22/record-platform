# Schema and E2E roadmap

Summary of **current test coverage**, **schema/table considerations**, and **suggested e2e test cases** so the suite and DB stay aligned.

---

## 1. Current suite coverage (9 suites)

| # | Suite | Script | Services/endpoints covered |
|---|--------|--------|----------------------------|
| 1 | auth | test-auth-service.sh | Register, login, logout, delete; MFA/OAuth/passkey (optional) |
| 2 | baseline | test-microservices-http2-http3.sh | Auth, records (create), social (forum, messages, groups, attachments), listings (health, search, create, get mine), shopping (cart, checkout, orders, purchase history, resell, search history), health for all 8 services |
| 3 | enhanced | test-microservices-http2-http3-enhanced.sh | Same as baseline + adversarial-style + packet capture |
| 4 | adversarial | enhanced-adversarial-tests.sh | DB disconnect, cache, capture, load |
| 5 | rotation | rotation-suite.sh | CA/leaf rotation, Caddy reload, k6 chaos |
| 6 | standalone-capture | test-packet-capture-standalone.sh | Packet capture (H2/H3/gRPC) |
| 7 | tls-mtls | test-tls-mtls-comprehensive.sh | HTTP/3 cert chain, gRPC TLS/mTLS, chain completeness |
| 8 | social | test-messaging-service-comprehensive.sh | All forum + messages routes (archive, recall, kick/ban, list groups, etc.) |
| 9 | lb-coordinated | (inside run-all) | Caddy, HAProxy, MetalLB |

**E2E gap:** Baseline/enhanced only hit **health** for analytics, auction-monitor, and python-ai. No functional e2e for:

- **Analytics:** `/api/analytics/log-search`, `/api/analytics/ingest`
- **Python AI:** `/api/ai/advice/selling`, `/api/ai/advice/buying`, etc.
- **Auction monitor:** auction/bid flows (if exposed via gateway)

---

## 2. Schema / tables to keep in sync

### 2.1 Applied by preflight (step 3b4)

- Social: forum, messages (including archive, recall, kick/ban, roles) — `ensure-social-migrations.sh` / 04-social-schema-archive-recall-kickban.sql
- Content hash, catalog, Python-AI schema, **shopping order_number sequence** (09-shopping-order-number-sequence.sql) — critical for Test 13c checkout

Set `SKIP_PREFLIGHT_MIGRATIONS=1` to skip; otherwise ensure these are applied so baseline/social/checkout pass.

### 2.2 Tables and migrations to consider for e2e

| Area | Migration / table | Purpose |
|------|-------------------|---------|
| Shopping | 09-shopping-order-number-sequence.sql | Avoid duplicate key on checkout (orders_order_number_key). **Must** be applied before baseline if DB is fresh. |
| Shopping | 07b-shopping-purchase-history-resellable.sql, 08-shopping-cart-tax-shipping.sql, 14-shopping-cart-cost-calculation.sql | Resell and cart e2e (Test 13h, 13g) |
| Shopping | 15-shopping-notifications.sql, 17-shopping-price-alerts-saved-searches.sql | Optional e2e: notifications, price alerts |
| Listings | 05-listings-schema.sql, 05-listings-schema-extended.sql, 06-listings-display-preferences.sql, 09-listings-reports.sql, 16-listings-seller-shipping-promotions.sql, 19-listings-seller-availability.sql, 20-listings-flag-notify-seller.sql | Listings search, create, watchlist, ratings — baseline only does health + search + create + get mine |
| Social | 04-social-schema*.sql, 18-social-messages-roles-leave.sql | Forum, messages, groups; **GET /messages/groups** failing in social suite → verify route and schema (e.g. groups list) |
| Analytics | 08-analytics-schema.sql, 31-data-summary.sql | If we add e2e for /api/analytics/log-search or ingest |
| Python AI | python-ai-schema.sql, 09-python-ai-schema.sql | If we add e2e for /api/ai/* |
| Auction monitor | 07-auction-monitor-schema.sql, 07-auction-monitor-schema-extended.sql | If we add e2e for auction/bid |
| Records | 41-partition-records.sql, 42-partition-cutover.sql, 43-optimize-knn-trgm.sql, 45-drop-unused-indexes-records.sql, 46-records-prisma-columns.sql | Records service; baseline already tests create record |

### 2.3 DB tables verified by baseline + verify-db-cache-quick

| DB (port) | Schema / table | How covered |
|-----------|----------------|-------------|
| auth (5437) | auth.users | Test 1/1b register; verify_db_after_test |
| records (5433) | records.records | Test 3/3b create record; verify_db_after_test |
| records (5433) | catalog.* | verify-db-cache-quick step 5 (schema existence) |
| social (5434) | forum.posts, messages.messages | Test 6/6b, 9…; verify-db-cache-quick step 4 |
| listings (5435) | listings.listings | Test 12/12b create listing; verify_db_after_test |
| shopping (5436) | shopping.shopping_cart, orders, purchase_history | Test 13a–13j; verify-db-cache-quick step 3 |
| analytics (5439) | analytics.* | verify-db-cache-quick step 5 (schema existence); baseline health only |
| auction-monitor (5438), python-ai (5440) | — | Baseline health only; no table checks yet |

To add tests for new tables (e.g. catalog.data_lake, analytics.price_snapshots): add API calls in baseline or enhanced, then `verify_db_after_test` or a step in verify-db-cache-quick.

### 2.4 Table setup and tuning report

- **Single table summary:** `./scripts/db-schema-tune-and-report.sh` → `docs/DB_SCHEMA_TABLE_AND_TUNING.md` (port, service, db, schema, table, ~rows).
- **Trigram (pg_trgm)** and **EXPLAIN ANALYZE** per table, **sub-20ms tuning:** same script; set `APPLY_TRIGRAM=1` to create recommended GIN trigram indexes.
- **Full column listing:** `./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md`.

### 2.5 Baseline order: Test 15b and packet capture

- **Order:** Logout (Test 14b, 14) → Delete Account HTTP/2 (Test 15) → **Delete Account HTTP/3 (Test 15b)** → **stop packet capture** → gRPC tests.
- Test 15b runs **before** packet capture so HTTP/3 delete flow is included in the capture. If HTTP/3 is unavailable (no `strict_http3_curl` or `HTTP3_RESOLVE`), the script prints `Test 15b: skipped (...); packet capture next` and proceeds to stop capture.
- Progress messages during Test 15b: "Registering delete-test user via HTTP/3...", "Calling DELETE /api/auth/account...", "Verifying login returns 401/404..." so if it hangs you can see which step.

### 2.6 New tables from CURRENT_DB_SCHEMA_REPORT (services + webapp alignment)

Source: `docs/CURRENT_DB_SCHEMA_REPORT.md` (refresh with `./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md`).

| Port | DB / schema | New/updated tables | Action |
|------|-------------|--------------------|--------|
| 5433 | records | catalog.data_lake, data_model, data_object; analytics.price_snapshots; listings.auctions, oauth_tokens, search_history, user_settings, watchlist | E2E: catalog/analytics schema existence (verify-db-cache-quick step 5). Services: ensure records/listings/analytics use these where intended. |
| 5435 | listings | listings.listings, listing_images, listing_videos, listing_shipping_options, listing_views, offers, ratings, seller_availability, active_auctions, bids, auction_details, etc. | **Listings service:** align routes and types with schema. **Webapp:** listing detail, shipping options, ratings, seller availability, location. |
| 5436 | shopping | shopping.orders, shopping_cart, purchase_history, search_history, resell (07b); bundle_shipping_offers, cache_metadata, cart_session, discount_codes, notifications, price_alerts, recently_viewed, saved_searches, watchlist, wishlist | **Shopping service:** expose and use new tables (location/address, wishlist, price alerts, notifications, bundle shipping). **Webapp:** checkout flow, address/location, wishlist, alerts. |
| — | — | Location / address | **Webapp + services:** location setup (addresses, shipping origins). Update checkout and profile pages; ensure shopping and listings services read/write address fields. |

**Checklist for implementation:**

1. **Shopping service** (`services/shopping-service/`): Add or wire routes for new tables (wishlist, price_alerts, notifications, bundle_shipping_offers, saved_searches, recently_viewed, address/location); align DB types with `CURRENT_DB_SCHEMA_REPORT`.
2. **Listings service** (`services/listings-service/`): Align schema (listings, listing_shipping_options, ratings, seller_availability, etc.); expose new fields in API; update any Prisma or raw SQL.
3. **Webapp** (`webapp/`): Checkout and profile (address/location); shopping (wishlist, alerts, notifications); listings (detail, shipping options, ratings, seller info).
4. **E2E:** Add baseline or verify-db-cache-quick steps that hit new endpoints and/or assert new table rows (e.g. wishlist, price_alert) once APIs exist.

---

## 2.7 Ideas for schema and feature expansion

Use these to prioritize migrations, APIs, and E2E coverage. Source: `docs/CURRENT_DB_SCHEMA_REPORT.md` and service schemas.

| Area | Idea | Tables / scope | Notes |
|------|------|----------------|-------|
| **Location / address** | Shipping and billing addresses; seller origin; “near me” or region filters | Add `addresses` or extend `users`/orders with address fields; optional `regions`/postcodes | Webapp: checkout, profile. Services: shopping (shipping cost), listings (seller location). |
| **Shopping** | Wishlist, price alerts, saved searches, recently viewed, bundle shipping, discount codes | shopping.wishlist, price_alerts, saved_searches, recently_viewed, bundle_shipping_offers, discount_codes | Shopping-service already has routes for some; align with schema and add E2E. |
| **Listings** | Listing detail (images, videos, shipping options), ratings, seller availability, offers, bids | listings.listing_images, listing_videos, listing_shipping_options, listing_views, ratings, seller_availability, offers, bids | Listings-service: extend API and types; webapp: listing detail page, seller info. |
| **Catalog / analytics** | Data lake and catalog model; price snapshots; E2E that touches these tables | catalog.data_lake, data_model, data_object; analytics.price_snapshots | verify-db-cache-quick checks schema existence; add API + E2E when read/write endpoints exist. |
| **Social** | Votes, read receipts, archive/delete thread (already in schema) | forum.post_votes, comment_votes; messages.message_reads; user_archived_threads, user_deleted_threads | Social suite and migrations cover many; add E2E for votes/reads if not yet covered. |
| **Auction / bids** | Auction details and bid flow (if exposed via gateway) | listings.auctions, bids, active_auctions; auction_monitor DB | E2E when gateway and auction-monitor expose bid/auction APIs. |

Expansion order suggestion: (1) Location/address (checkout and shipping), (2) Shopping wishlist and price alerts (APIs + webapp), (3) Listings detail (images, shipping options, ratings), (4) Catalog/analytics write paths and E2E.

---

## 3. Suggested e2e test cases (add to baseline or new suite)

| Priority | Area | Suggested test | Depends on |
|----------|------|----------------|------------|
| High | Social | Fix **GET /messages/groups** (list groups) — currently failing in social suite | Route/backend and schema for groups list |
| High | Shopping | Resell via HTTP/3 (Test 13j8) — fix 404 if route differs for HTTP/3 | Resell route and 07b migration |
| Medium | Analytics | GET /api/analytics/log-search (with auth); optional POST /api/analytics/ingest | 08-analytics-schema, gateway route |
| Medium | Python AI | POST /api/ai/advice/selling (or buying) with minimal body | python-ai schema, gateway route |
| Medium | Listings | Watchlist, ratings, ebay search (baseline has search + create + get mine only) | Listings migrations above |
| Low | Auction monitor | Health is covered; optional bid/auction e2e if API is exposed | 07-auction-monitor-schema |

---

## 4. Running preflight and suites

Full preflight (scale, reissue, suites, k6, pgbench):

```bash
SKIP_PREFLIGHT_MIGRATIONS=1 METALLB_ENABLED=1 DB_VERIFY_FAST=1 ./scripts/run-preflight-scale-and-all-suites.sh
```

Suites only (cluster already up):

```bash
SKIP_PREFLIGHT=1 SKIP_FULL_PREFLIGHT=1 ./scripts/run-all-test-suites.sh
```

Re-run a single suite (e.g. baseline or social):

```bash
./scripts/test-microservices-http2-http3.sh
./scripts/test-messaging-service-comprehensive.sh
```

---

## 5. References

- **Test failures and warnings:** `scripts/TEST-FAILURES-AND-WARNINGS.md`
- **Preflight run issues (k6, HAProxy, schema):** `docs/PREFLIGHT_RUN_ISSUES_REPORT.md`
- **xk6-http3 and k6 BASE_URL:** `docs/XK6_HTTP3_SETUP.md`
- **DB schema table + tuning:** `docs/DB_SCHEMA_TABLE_AND_TUNING.md` (generate with `scripts/db-schema-tune-and-report.sh`)
