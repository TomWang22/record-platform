import { Router, type Request, type Response } from "express";
import { pool } from "../lib/db.js";
import { pushCartReservedNotification } from "../pushShoppingNotification.js";

const INTERNAL_SECRET = (
  process.env.LISTINGS_BOOKING_INTERNAL_SECRET ||
  process.env.BOOKING_LISTINGS_INTERNAL_SECRET ||
  ""
).trim();

function requireInternalSecret(req: Request, res: Response): boolean {
  const secret = String(req.get("x-listings-internal-secret") || "").trim();
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

export function internalCartRouter(): Router {
  const router = Router();

  router.post("/cart/reserve-offer", async (req: Request, res: Response) => {
    if (!requireInternalSecret(req, res)) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const buyerUserId = String(body.buyer_user_id || "").trim();
    const listingId = String(body.listing_id || "").trim();
    const offerId = String(body.offer_id || "").trim();
    const amountCents = Number(body.amount_cents);
    const listingTitle = body.listing_title != null ? String(body.listing_title) : null;
    const sellerDisplay = body.seller_display != null ? String(body.seller_display) : null;

    if (!buyerUserId || !listingId || !offerId) {
      res.status(400).json({ error: "buyer_user_id, listing_id, offer_id required" });
      return;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: "invalid amount_cents" });
      return;
    }

    try {
      const existingOffer = await pool.query(
        `SELECT id, price, metadata FROM shopping.shopping_cart
         WHERE user_id = $1::uuid AND item_type = 'listing' AND item_id = $2::uuid
           AND metadata->>'offer_id' = $3`,
        [buyerUserId, listingId, offerId],
      );
      if (existingOffer.rows[0]) {
        const row = existingOffer.rows[0] as { id: string };
        res.status(200).json({ cart_item_id: row.id, reserved: true, duplicate: true });
        return;
      }

      const acceptedOther = await pool.query(
        `SELECT id FROM shopping.shopping_cart
         WHERE user_id = $1::uuid AND item_type = 'listing' AND item_id = $2::uuid
           AND metadata->>'purchase_type' = 'best_offer'
           AND metadata->>'offer_id' IS NOT NULL
           AND metadata->>'offer_id' <> $3
         LIMIT 1`,
        [buyerUserId, listingId, offerId],
      );
      if (acceptedOther.rows[0]) {
        res.status(409).json({ error: "listing already reserved for another offer" });
        return;
      }

      const priceDollars = Math.round(amountCents) / 100;
      const metadata = {
        purchase_type: "best_offer",
        offer_id: offerId,
        title: listingTitle,
        seller_display: sellerDisplay,
        reserved_at: new Date().toISOString(),
        amount_cents: Math.round(amountCents),
      };

      const existingListing = await pool.query(
        `SELECT id FROM shopping.shopping_cart
         WHERE user_id = $1::uuid AND item_type = 'listing' AND item_id = $2::uuid
           AND (metadata->>'purchase_type' IS NULL OR metadata->>'purchase_type' = 'buy_now')
         LIMIT 1`,
        [buyerUserId, listingId],
      );

      let cartItemId: string;
      if (existingListing.rows[0]) {
        const upd = await pool.query(
          `UPDATE shopping.shopping_cart
           SET price = $1, quantity = 1, metadata = $2::jsonb, updated_at = now()
           WHERE id = $3::uuid
           RETURNING id`,
          [priceDollars, JSON.stringify(metadata), (existingListing.rows[0] as { id: string }).id],
        );
        cartItemId = (upd.rows[0] as { id: string }).id;
      } else {
        const ins = await pool.query(
          `INSERT INTO shopping.shopping_cart
             (user_id, item_type, item_id, listing_id, quantity, price, metadata)
           VALUES ($1::uuid, 'listing', $2::uuid, $2::uuid, 1, $3, $4::jsonb)
           RETURNING id`,
          [buyerUserId, listingId, priceDollars, JSON.stringify(metadata)],
        );
        cartItemId = (ins.rows[0] as { id: string }).id;
      }

      void pushCartReservedNotification({
        buyerUserId,
        listingId,
        listingTitle,
        purchaseType: "best_offer",
        amountCents: Math.round(amountCents),
      });
      res.status(201).json({ cart_item_id: cartItemId, reserved: true });
    } catch (err) {
      console.error("[shopping] reserve-offer error:", err);
      res.status(500).json({ error: "failed to reserve offer in cart" });
    }
  });

  router.post("/cart/reserve-auction-win", async (req: Request, res: Response) => {
    if (!requireInternalSecret(req, res)) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const buyerUserId = String(body.buyer_user_id || "").trim();
    const listingId = String(body.listing_id || "").trim();
    const amountCents = Number(body.amount_cents);
    const listingTitle = body.listing_title != null ? String(body.listing_title) : null;
    const sellerDisplay = body.seller_display != null ? String(body.seller_display) : null;

    if (!buyerUserId || !listingId) {
      res.status(400).json({ error: "buyer_user_id, listing_id required" });
      return;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: "invalid amount_cents" });
      return;
    }

    try {
      const existing = await pool.query(
        `SELECT id FROM shopping.shopping_cart
         WHERE user_id = $1::uuid AND item_type = 'listing' AND item_id = $2::uuid
           AND metadata->>'purchase_type' = 'auction_win'
         LIMIT 1`,
        [buyerUserId, listingId],
      );
      if (existing.rows[0]) {
        res.status(200).json({
          cart_item_id: (existing.rows[0] as { id: string }).id,
          reserved: true,
          duplicate: true,
        });
        return;
      }

      const priceDollars = Math.round(amountCents) / 100;
      const metadata = {
        purchase_type: "auction_win",
        title: listingTitle,
        seller_display: sellerDisplay,
        reserved_at: new Date().toISOString(),
        amount_cents: Math.round(amountCents),
      };

      const ins = await pool.query(
        `INSERT INTO shopping.shopping_cart
           (user_id, item_type, item_id, listing_id, quantity, price, metadata)
         VALUES ($1::uuid, 'listing', $2::uuid, $2::uuid, 1, $3, $4::jsonb)
         RETURNING id`,
        [buyerUserId, listingId, priceDollars, JSON.stringify(metadata)],
      );
      void pushCartReservedNotification({
        buyerUserId,
        listingId,
        listingTitle,
        purchaseType: "auction_win",
        amountCents: Math.round(amountCents),
      });
      res.status(201).json({
        cart_item_id: (ins.rows[0] as { id: string }).id,
        reserved: true,
      });
    } catch (err) {
      console.error("[shopping] reserve-auction-win error:", err);
      res.status(500).json({ error: "failed to reserve auction win in cart" });
    }
  });

  return router;
}

export default internalCartRouter;
