# Schema Test Coverage Gap Analysis

Compares `docs/CURRENT_DB_SCHEMA_REPORT.md` with `scripts/test-microservices-http2-http3.sh` to identify tables that are **not** exercised by any API test.

Generated: 2026-02-21

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| **Covered** (API test writes to table) | 35+ | None |
| **Gap — has HTTP API, not tested** | 12 | Add tests |
| **Gap — no user-facing HTTP API** | 20+ | Document only; may add later |
| **Views / system** | excluded | N/A |

---

## Covered Tables (API test hits them)

| Schema.Table | Port | Test(s) | API |
|--------------|------|---------|-----|
| records.records | 5433 | 3, 3b | POST /api/records |
| auth.users | 5433/5437 | 1, 2, 1b, 2b | POST /api/auth/register, /login |
| forum.posts | 5434 | 6, 6b, 9g | POST /api/forum/posts |
| forum.comments | 5434 | 7b | POST /api/forum/posts/:id/comments |
| forum.post_attachments | 5434 | 9h | POST /api/forum/posts/:id/attachments |
| forum.comment_attachments | 5434 | 9i | POST /api/forum/comments/:id/attachments |
| messages.messages | 5434 | 8, 8b, 9d | POST /api/messages |
| messages.groups | 5434 | 9b | POST /api/messages/groups |
| messages.group_members | 5434 | 9c | POST /api/messages/groups/:id/members |
| messages.message_attachments | 5434 | 9j | POST /api/messages/:id/attachments |
| listings.listings | 5435 | 12, 12b, 13i, 13j8 | POST /api/listings, resell |
| listings.watchlist | 5435 | 12d, 12e | POST /api/listings/:id/watch |
| listings.search_history | 5433/5435 | 13k, 13k2, 13j0, 13j9 | analytics log-search, history/searches |
| shopping.shopping_cart | 5436 | 13a, 13j1 | POST /api/cart |
| shopping.orders | 5436 | 13c, 13j5 | POST /api/cart/checkout |
| shopping.purchase_history | 5436 | 13c, 13j5 | checkout |
| shopping.returns | 5436 | 13g | POST /api/returns |
| shopping.search_history | 5436 | 13j0, 13j9 | POST /api/history/searches |
| shopping.watchlist | 5436 | 13a2, 13j2b | POST /api/shopping/watchlist |
| shopping.wishlist | 5436 | 13a3, 13j2c | POST /api/shopping/wishlist |
| shopping.recently_viewed | 5436 | 13a4, 13j2d | POST /api/shopping/recently-viewed |
| shopping.shipments | 5436 | 13c, 13j5 | created during checkout |
| ai.inference_log | 5440 | 13m, 13m2 | POST /api/ai/selling-advice |
| auth.sessions | 5437 | 2, 2b | login creates session |

---

## Gap: Has HTTP API — Now Covered

These tables now have tests in `test-microservices-http2-http3.sh`.

| Schema.Table | Port | Test(s) | API |
|--------------|------|---------|-----|
| **listings.user_settings** | 5435 | 12f, 12i | PUT /api/listings/settings |
| **listings.bids** | 5435 | 12l, 12m | POST /api/listings/:id/bid (after 12k auction) |
| **listings.offers** | 5435 | 12h, 12j | POST /api/listings/:id/offer |
| **listings.ratings** | 5435 | 13f2, 13j4b | POST /api/listings/ratings |
| **listings.listing_images** | 5435 | 12g, 12g2 | POST /api/listings/:id/images |
| **forum.post_votes** | 5434 | 7c, 7d | POST /api/forum/posts/:id/vote |
| **forum.comment_votes** | 5434 | 7e, 7f | POST /api/forum/comments/:id/vote |
| **messages.message_reads** | 5434 | (read when fetching?) | May be implicit on GET |
| **messages.user_archived_threads** | 5434 | Archive API if exists | Check messaging-service routes |
| **messages.user_deleted_threads** | 5434 | Delete API if exists | Check messaging-service routes |
| **feedback.reviews** | 5436 | Shopping feedback API? | Check if POST /api/shopping/feedback or similar |
| **auth.user_addresses** | 5437 | Profile/checkout address | Check auth or shopping API |

---

## Gap: No User-Facing HTTP API (or complex)

These are written by cron jobs, pipelines, OAuth callbacks, or internal flows. Harder or not suitable for smoke tests.

| Schema.Table | Port | Written By | Notes |
|--------------|------|------------|-------|
| analytics.price_snapshots | 5433/5439 | cron, ingestion pipeline | No REST API |
| catalog.data_lake | 5433 | Data catalog (admin?) | Metadata tables |
| catalog.data_model | 5433 | Data catalog | |
| catalog.data_object | 5433 | Data catalog | |
| listings.oauth_tokens | 5435 | OAuth callback (Discogs) | Requires external OAuth |
| listings.auctions | 5433 | auction-monitor scraping | External fetch |
| bench.results | 5433 | pgbench / scripts | Bench only |
| auction_monitor.* | 5438 | auction-monitor worker, pipeline | No HTTP write APIs exposed |
| auth.verification_codes | 5437 | Email verification flow | Needs email/OTP |
| auth.mfa_settings | 5437 | MFA setup | Has API; could add test |
| auth.oauth_providers | 5437 | OAuth login | Google/Discogs OAuth |
| shopping.notifications | 5436 | availability.ts (sold-out) | Indirect via checkout |
| feedback.collection_stats | 5436 | Records collection sync? | Check for API |
| feedback.user_activity | 5436 | Activity tracking | Check for API |
| feedback.user_profiles | 5436 | User profile | Check for API |
| shopping.saved_searches | 5436 | Save search | Check for API |
| shopping.price_alerts | 5436 | Price alert | Check for API |

---

## Implemented Tests (completed)

All low- and medium-effort tests from the gap analysis have been added:

- **listings.user_settings** — Tests 12f (HTTP/2), 12i (HTTP/3); gateway pathRewrite added for /listings/settings → /settings
- **forum.post_votes** — Tests 7c (HTTP/2), 7d (HTTP/3)
- **forum.comment_votes** — Tests 7e (HTTP/2), 7f (HTTP/3); COMMENT_ID from Test 7b
- **listings.listing_images** — Tests 12g (HTTP/2), 12g2 (HTTP/3)
- **listings.offers** — Tests 12h (HTTP/2), 12j (HTTP/3)
- **listings.ratings** — Tests 13f2 (HTTP/2), 13j4b (HTTP/3); uses PURCHASE_ID from checkout
- **listings.bids** — Tests 12l (HTTP/2), 12m (HTTP/3); Test 12k creates auction listing first

### Remaining gaps (defer / no HTTP API)

- listings.oauth_tokens (OAuth flow)
- analytics.* (cron/pipeline)
- catalog.* (admin)
- auction_monitor.* (no HTTP write APIs)
- feedback.reviews, messages.message_reads, etc. (check for APIs)

---

## verify_schema_exists vs verify_db_after_test

- **verify_schema_exists**: Confirms table exists (run at start).  
  All user tables from `CURRENT_DB_SCHEMA_REPORT.md` are already covered.

- **verify_db_after_test**: Confirms data was written by a test (run after API call).  
  Add for each new test that writes to a previously uncovered table.
