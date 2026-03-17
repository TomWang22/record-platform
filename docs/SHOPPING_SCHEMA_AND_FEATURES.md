# Shopping schema and features

Summary of shopping DB (port 5436): cart cost, recently viewed, watchlist, country, and feedback/reviews (eBay-style). Aligns with **docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md** (shopping + feedback schemas, 1M cap per schema).

---

## Cart and cost calculation

- **Per-line:** `shopping.shopping_cart` has `quantity` and `price` (snapshot at add time). Cost per line = `quantity * price`.
- **Cart total:** Use view **`shopping.cart_summary`** (from `14-shopping-cart-cost-calculation.sql`): `user_id`, `line_count`, `subtotal`. Subtotal is the sum of line costs; **tax and shipping are computed at checkout** from the user’s ship-to country (see below).
- **Per-line display:** View **`shopping.cart_lines_with_total`** adds computed `line_total = quantity * price` for each row.
- **Checkout:** Orders use `shopping.orders` with `subtotal`, `shipping_cost`, `tax`, `total`. Country for tax/shipping comes from auth or cart_session (see Country below).

---

## Recently viewed

- **Table:** `shopping.recently_viewed` (in `06-shopping-schema.sql`). Same idea as listings “recently viewed”: one row per (user, item_type, item_id), `viewed_at` for ordering.
- **Behavior:** Append-only from the app (user doesn’t edit). Cleanup job can trim to last N per user (e.g. `shopping.cleanup_old_recently_viewed()` keeps last 100).
- **Indexes:** `(user_id, viewed_at DESC)`, `(item_id, item_type)`.

---

## Watchlist

- **Table:** `shopping.watchlist` (in `06-shopping-schema.sql`). UNIQUE on `(user_id, item_type, item_id)`.
- **Removing an item:** Delete the row. When the user removes an item from the watchlist, the app **DELETE**s that row (no soft-delete); “removed” = row is gone. See `07-shopping-watchlist-record-snapshot.sql` (snapshot columns for display; unadd = DELETE row).
- **Optional snapshot columns:** artist, name, format, etc., for display without joining listings.

---

## User’s country (ship-to and tax)

- **Source of truth:** **Auth** holds the user’s address(es) and country. Table `auth.user_addresses` (port 5437) has `country_code` (ISO 2-char) and `is_default`. User can have a default address; country drives tax rate and shipping cost.
- **Shopping override:** `shopping.cart_session` (one row per user) has `ship_to_country`. If set, it overrides the auth default for that cart session; if NULL, use the auth default address country.
- **Orders:** `shopping.orders` has `ship_to_country` (and `subtotal`, `shipping_cost`, `tax`, `total`) for reporting and audit. See `08-shopping-cart-tax-shipping.sql`.

---

## Notifications (cart item removed – out of stock)

- **Table:** `shopping.notifications` (in `15-shopping-notifications.sql`). Columns: `user_id`, `type`, `title`, `body`, `payload` (JSONB), `read_at`, `created_at`.
- **When user A checks out:** The item is removed from all other users’ carts (e.g. user B). The app inserts a notification for user B: “Item removed from your cart – no longer in stock,” so B doesn’t have to remove it manually. One notification per affected user (type `cart_item_removed`).
- **Frontend:** Can list unread notifications (`read_at IS NULL`) and show a badge; mark as read when the user opens the notification.

---

## Feedback and reviews (eBay-style)

- **Schema:** `feedback` (in `13-feedback-review-schema.sql`), in the **shopping** DB (port 5436).
- **Star rating and reviews:** Table `feedback.reviews`: `reviewer_id`, `reviewee_id`, `role` ('seller' | 'buyer'), `transaction_id` (order/purchase), **`rating`** (1–5), `comment`. So both sides can leave a review per transaction (eBay-style).
- **Other:** `feedback.user_profiles`, `feedback.user_activity`, `feedback.collection_stats` for display and activity.

---

## Apply order and tuning

- **Schema apply order** for shopping (port 5436): see **docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md**. Includes `06-shopping-schema.sql` through `15-shopping-notifications.sql` and `13-feedback-review-schema.sql`.
- **Data and tuning:** After schemas are applied, restore from backup if you have one (see **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md**). For tuning, see **infra/db/service-specific-tuning.sql**, **infra/db/comprehensive-db-tuning.sql**, and **docs/COLD_TUNING_AND_PGBENCH.md** / **docs/COLD_TUNING_AND_SEEDING.md**.
