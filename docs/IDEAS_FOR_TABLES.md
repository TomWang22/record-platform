# Ideas for additional tables (platform setup)

Suggestions for tables (and features) that would help this setup. Not all are implemented; use as a roadmap or pick-list.

---

## Implemented

- **shopping.notifications** — In-app notifications. When user A checks out, users B, C, … who had that item in cart get it removed and a notification ("Item removed from your cart – no longer in stock") so they don’t have to remove it manually. See `15-shopping-notifications.sql` and `notifyCartItemRemoved` in the shopping service.

---

## Notifications and messaging

- **Unread count / read_at** — Already on `shopping.notifications`. Frontend can show a badge and mark as read when the user opens the notification.
- **Notification preferences** — Table per user: which types to show (cart_removed, order_shipped, price_alert, etc.) and optionally email/push.
- **Inbox / threads** — If you add seller–buyer messaging, a `conversations` or `threads` table keyed by (seller_id, buyer_id, listing_id) plus `messages` (or reuse social messages with a type).

---

## Shopping and discovery

- **Price alerts** — Table: user_id, listing_id (or item_id), target_price, notified_at. Job checks listings and inserts into `notifications` when price drops.
- **Saved searches** — user_id, query, filters (JSONB), last_run_at, notify_on_new (boolean). Optional job that runs saved searches and notifies when new listings match.
- **Recently viewed (listings)** — If listings service wants its own “recently viewed” (separate from shopping), a small table or reuse shopping.recently_viewed with item_type = 'listing'.

---

## Orders and fulfillment

- **Order events / audit** — Table: order_id, event_type (created, paid, shipped, cancelled), payload (JSONB), created_at. Useful for support and analytics.
- **Shipments** — shipment_id, order_id, carrier, tracking_code, shipped_at, delivered_at. Link to orders for tracking.

---

## Feedback and trust

- **Seller stats (denormalized)** — Per seller: total_sales, avg_rating, count_reviews. Updated on review insert or via job; avoids aggregating feedback.reviews every time.
- **Listing-level reviews** — Optional: add listing_id to feedback.reviews (or a separate table) for “reviews for this listing” in addition to transaction-level reviews.

---

## Analytics and ops

- **Daily/hourly aggregates** — Tables or materialized views: orders per day, revenue per day, cart abandonment (carts not checked out within 24h). For dashboards and tuning.
- **Feature flags or config** — Key-value or small table for toggles (e.g. free_shipping_threshold, tax_rate_by_country) without code deploy.

---

## Auth and account

- **User’s country** — Already in auth.user_addresses (country_code). Use for tax/shipping and cart_session override.
- **Sessions / devices** — If you need “log out everywhere” or “sessions” list, a sessions table (user_id, token_or_ref, device_info, created_at, expires_at).

---

## Backup and schema

- **Bundled SQL** — `scripts/bundle-db-schemas.sh` generates one file per DB under `infra/db/bundles/` (e.g. `5436-shopping.sql`). Use for backup-like apply: one file per DB to get full schema.
- **Clear breakdown** — `docs/SCHEMA_TABLE_BREAKDOWN.md` lists port → DB → schema → table for all 8 DBs.
