# Schema design extensions (records, listings, shopping, social, payments)

Single design reference for: **records** (CSV alignment), **listings** (price/location/shipping/bundle/seller availability/promotions), **shopping** (price alerts, saved searches, discounts, bundle shipping, notifications, feedback/analytics), **social/messages** (chat, read receipts, roles, leave), **listing flagging → notify seller**, and **payment simulation**.

---

## 1. Records schema (port 5433) — CSV alignment

**Source:** `records_chunks/chunk_001.csv` (and similar). The **records** schema holds only these rows (collection records).

**Columns (must match CSV):**  
`user_id`, `artist`, `name`, `format`, `catalog_number`, `notes`, `purchased_at`, `price_paid`, `record_grade`, `sleeve_grade`, `release_year`, `release_date`, `pressing_year`, `label`, `label_code`, `has_insert`, `has_booklet`, `has_obi_strip`, `has_factory_sleeve`, `is_promo`.

- **Created by:** `03-database.sql` (base) + `46-records-prisma-columns.sql` (adds `release_year`, `release_date`, `pressing_year`, `label`, `label_code`, and grade columns). No extra tables for records; this is the single source for collection data.

---

## 2. Listings schema (port 5435) — main schema

Listings has many rows. Key extensions:

### 2.1 Price and location

- **Price:** Stored in seller’s currency (`listings.currency`, `listings.price`). Convert to buyer’s currency at display/checkout using a rate (user’s location/country from auth or cart_session).
- **Seller location:** `listings.location` (seller’s location). Optional: `seller_country` (CHAR(2)) for rate/tax. Seller cost/shipping: `listings.shipping_cost`, `listings.shipping_method`; extended options in `listing_shipping_options` (see migrations).

### 2.2 Shipping: single, multiple, or flexible

- **Shipping type:** `shipping_type` — `'single'` (one option), `'multiple'` (several options), `'flexible'` (negotiation).
- **Multiple options:** Table `listings.listing_shipping_options` (listing_id, label, cost, method, sort_order).
- **Flexible:** When `shipping_type = 'flexible'`, buyer and seller can negotiate (e.g. via messages or offer flow).

### 2.3 Bundle

- **Bundles:** `listings.listings.bundle_id` (same `bundle_id` = sold together). Optional `listings.bundles` (id, seller_id, title, total_price) for bundle-level metadata. Discounts: `listings.discount_price`, `listings.sale_ends_at` (from 08-listings-price-media).

### 2.4 Seller availability (offline / preferred hours)

- **Alert if seller offline/unavailable:** Table `listings.seller_availability` (or columns on seller prefs): `user_id`, `is_available` (boolean), `preferred_hours` (e.g. JSONB or text: "Mon–Fri 9–17"), `unavailable_until` (TIMESTAMPTZ), `message` (e.g. "On vacation"). Anyone can be a seller; this is a “heads up” for buyers.

### 2.5 Promotions

- **Promotions:** Seller can mark listing as promoted. Table `listings.listing_promotions` (listing_id, promotion_type, starts_at, ends_at, boost_weight) or columns on `listings.listings`: `promotion_type`, `promotion_ends_at`. Used for sorting/featured and future paid promotion.

### 2.6 Flagging and notify seller (dual write / triggers)

- **Listings:** `listings.listing_reports` (reporter_id, listing_id, reason_code, reason_text, status, message_to_lister_id). Anyone can report (inaccurate, missing info).
- **Complaint to seller:** When a report is created, the app **dual-writes** (or a trigger/job): (1) keep `listing_reports` in listings DB; (2) create a **notification** for the lister (e.g. insert into `shopping.notifications` with type `listing_reported`, payload = report id + reason), or send a message to the lister via social `messages.messages`. Prefer: insert into `shopping.notifications` (user_id = lister, type = `listing_reported`, body = complaint summary) so the seller sees it in-app.

---

## 3. Social / messages (port 5434) — chat, read receipts, roles, leave

### 3.1 One-to-one and multi-person chat

- **1:1:** `messages.messages` with `recipient_id` set, `group_id` NULL.
- **Group:** `messages.groups` + `messages.messages` with `group_id` set. `messages.group_members` (group_id, user_id, role).

### 3.2 user_id, timestamp, read or not (WhatsApp-style)

- **Timestamp:** `messages.messages.created_at`.
- **Read state:** `messages.messages.is_read` (for 1:1 recipient); **who read** in group: `messages.message_reads` (message_id, user_id, read_at, read_by_sender). So “who read it” = query `message_reads` for that message_id.

### 3.3 Attachments

- **Attachments:** `messages.message_attachments` (message_id, file_url, file_type: image/video/audio/document/sticker/other, mime_type, etc.). Same idea as WhatsApp-supported forms.

### 3.4 User leaves / stays; roles (admin, contributor, read-only)

- **Roles:** `messages.group_members.role`: `'owner' | 'admin' | 'moderator' | 'member'`. Extend to include `'contributor'` (can post), `'read_only'` (can only read) so role mutation is explicit.
- **Leave:** Add `left_at` (TIMESTAMPTZ) to `group_members`. When user leaves, set `left_at = now()`; hide from active members list; keep history. If user re-joins, insert new row or set `left_at` NULL per policy.

### 3.5 Design for “user stays out or leaves”

- **Stays out:** No delete; just `left_at` set. Thread stays for others; for the user who left, either hide thread (user_deleted_threads) or show “You left this chat”.
- **Role change:** Update `group_members.role`; only owner/admin can change roles. Mutations: admin → member, member → read_only, etc.

---

## 4. Shopping (port 5436) — price alerts, saved searches, discounts, bundle shipping, notifications, feedback/analytics

### 4.1 Notifications

- **Table:** `shopping.notifications` (user_id, type, title, body, payload, read_at, created_at). Used for cart item removed, listing reported (to seller), order updates, price alerts, etc.

### 4.2 Price alerts

- **Table:** `shopping.price_alerts` (user_id, listing_id or item_id, target_price, currency, notified_at). Job checks listings and inserts notification when price drops.

### 4.3 Saved searches (with notify)

- **Table:** `shopping.saved_searches` (user_id, query, filters JSONB, notify_on_new BOOLEAN, last_run_at). When `notify_on_new = true`, job runs search and notifies when new listings match.

### 4.4 Discounts

- **Option A:** `shopping.discount_codes` (code, type: percent/fixed, value, min_order, valid_from, valid_until, usage_limit). Applied at checkout.
- **Option B:** Listing-level only (`listings.discount_price`, `sale_ends_at`). Or both.

### 4.5 Bundle shipping

- **Table:** `shopping.bundle_shipping_offers` (seller_id, bundle_id or rule: e.g. “2+ items same seller”), shipping_discount_type (free_after_n, fixed_amount), threshold, created_at). Or store on order/cart_session: “bundle shipping applied”.

### 4.6 Feedback and analytics

- **Feedback:** `feedback.reviews` (rating 1–5, seller/buyer, transaction_id). Already in place.
- **Analytics:** Events/aggregates in analytics DB (port 5439) or shopping tables (e.g. order totals, conversion); use for “what seller earns / what shopper spent” (see Payment simulation).

---

## 5. Payment simulation (seller earns, shopper spent)

- **Shopper spent:** `shopping.orders.total` (and per-item `shopping.purchase_history.price_paid`). Simulated payment: order.payment_status = 'paid', payment_method = 'simulated'.
- **Seller earns:** For each sold listing, seller earns (e.g. price_paid minus platform fee). Optional table `shopping.seller_earnings` (order_id, listing_id, seller_id, amount, currency, fee, net_earnings, paid_at) or derive from `purchase_history` + listings.user_id (seller). For now: **simulate** in app: sum `purchase_history.price_paid` where listing_id in (listings by seller); optional view or materialized view for reporting.

---

## 6. Listings + Shopping: flagging and complaint to seller

- **Flow:** User reports listing → insert `listings.listing_reports` (listings DB). Application (or job): resolve lister user_id from `listings.listings.user_id`, then insert `shopping.notifications` (user_id = lister, type = 'listing_reported', title = 'Your listing was reported', body = reason_text, payload = { listing_id, report_id, reason_code }). Seller sees notification; can edit/remove listing or dispute.
- **Dual write:** Listings DB stores the report; Shopping DB stores the in-app notification for the seller. No cross-DB trigger; use app or async job.

---

## 7. Schema files (migrations) added

| File | Purpose |
|------|---------|
| Records | 03 + 46 (CSV alignment) — no change. |
| 16-listings-seller-shipping-promotions.sql | shipping_type, listing_shipping_options, seller_currency/location, promotion columns/table. |
| 17-shopping-price-alerts-saved-searches.sql | price_alerts, saved_searches, discount_codes, bundle_shipping_offers. |
| 18-social-messages-roles-leave.sql | group_members.left_at, role (contributor, read_only). |
| 19-listings-seller-availability.sql | seller_availability (is_available, preferred_hours, unavailable_until). |
| 20-listings-flag-notify-seller.sql | Optional: listing_reports.complaint_sent_at; app uses it + shopping.notifications. |
| Payment | Document only; optional seller_earnings view/table later. |

---

## Related

- **docs/SCHEMA_TABLE_BREAKDOWN.md** — Port → schema → table.
- **docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md** — Which SQL files to apply per DB.
- **docs/SHOPPING_SCHEMA_AND_FEATURES.md** — Cart, watchlist, feedback, notifications.
- **docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md** — Row caps.
