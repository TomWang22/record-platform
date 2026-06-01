import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";

import { resolvePublicUsersByHandle } from "./resolve-public-user.js";

type AuthedRequest = Request & { userId?: string };

export type MarketplaceFeedbackRow = {
  id: string;
  seller_user_id: string;
  buyer_user_id: string;
  listing_id: string;
  order_id: string | null;
  transaction_id: string;
  rating: number;
  comment: string | null;
  role: "buyer_to_seller" | "seller_to_buyer";
  created_at: string;
  updated_at: string;
  listing_title?: string | null;
};

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sendOk(res: Response, data: unknown, status = 200): void {
  res.status(status).json(data);
}

function sendErr(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function sentimentFromRating(rating: number): "positive" | "neutral" | "negative" {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

export function buildFeedbackSummary(rows: MarketplaceFeedbackRow[]) {
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: rows.filter((r) => r.rating === stars).length,
  }));
  const totalReviews = rows.length;
  const positive = rows.filter((r) => r.rating >= 4).length;
  const neutral = rows.filter((r) => r.rating === 3).length;
  const negative = rows.filter((r) => r.rating <= 2).length;
  const averageStars =
    totalReviews > 0
      ? Math.round((rows.reduce((a, r) => a + r.rating, 0) / totalReviews) * 10) / 10
      : 0;
  const score =
    totalReviews > 0 ? Math.round((positive / totalReviews) * 100) : 0;

  return {
    score,
    totalReviews,
    positive,
    neutral,
    negative,
    averageStars,
    distribution,
    reviews: rows.map((r) => ({
      id: r.id,
      stars: r.rating,
      sentiment: sentimentFromRating(r.rating),
      role: r.role === "buyer_to_seller" ? ("buyer" as const) : ("seller" as const),
      body: r.comment ?? "",
      listingTitle: r.listing_title ?? undefined,
      transactionId: r.transaction_id,
      listingId: r.listing_id,
      createdAt: r.created_at,
    })),
  };
}

async function loadFeedbackForUser(
  pool: Pool,
  userId: string,
  limit = 50,
): Promise<MarketplaceFeedbackRow[]> {
  const r = await pool.query(
    `SELECT f.id, f.seller_user_id, f.buyer_user_id, f.listing_id, f.order_id, f.transaction_id,
            f.rating, f.comment, f.role, f.created_at, f.updated_at,
            COALESCE(f.comment, '') AS listing_title
     FROM trust.marketplace_feedback f
     WHERE f.seller_user_id = $1::uuid OR f.buyer_user_id = $1::uuid
     ORDER BY f.created_at DESC
     LIMIT $2::int`,
    [userId, limit],
  );
  return r.rows as MarketplaceFeedbackRow[];
}

let schemaReady: Promise<void> | null = null;

export function ensureMarketplaceFeedbackSchema(pool: Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS trust.marketplace_transactions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          listing_id UUID NOT NULL,
          seller_user_id UUID NOT NULL,
          buyer_user_id UUID NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'completed',
          completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS trust.marketplace_feedback (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          seller_user_id UUID NOT NULL,
          buyer_user_id UUID NOT NULL,
          listing_id UUID NOT NULL,
          order_id UUID,
          transaction_id UUID NOT NULL REFERENCES trust.marketplace_transactions(id) ON DELETE CASCADE,
          rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
          comment TEXT,
          role VARCHAR(32) NOT NULL CHECK (role IN ('buyer_to_seller', 'seller_to_buyer')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (transaction_id, role)
        );
      `)
      .then(() => undefined)
      .catch((e) => {
        schemaReady = null;
        throw e;
      });
  }
  return schemaReady;
}

export function registerMarketplaceFeedbackRoutes(
  app: import("express").Express,
  pool: Pool,
  authReadPool: Pool | null,
  requireUser: (req: AuthedRequest, res: Response, next: NextFunction) => void,
): void {
  void ensureMarketplaceFeedbackSchema(pool).catch((e) =>
    console.error("[marketplace-feedback] schema init failed", e),
  );

  app.get(
    "/marketplace-feedback/me",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        await ensureMarketplaceFeedbackSchema(pool);
        const userId = req.userId!;
        const rows = await loadFeedbackForUser(pool, userId);
        sendOk(res, buildFeedbackSummary(rows));
      } catch (e) {
        console.error("[marketplace-feedback/me]", e);
        sendErr(res, 500, "internal");
      }
    },
  );

  app.get("/marketplace-feedback/users/:username", async (req, res) => {
    try {
      await ensureMarketplaceFeedbackSchema(pool);
      const username = String(req.params.username || "").trim();
      if (!username) {
        sendErr(res, 400, "username required");
        return;
      }
      if (!authReadPool) {
        sendOk(res, buildFeedbackSummary([]));
        return;
      }
      const resolved = await resolvePublicUsersByHandle(authReadPool, username);
      const user = resolved[0];
      if (!user?.id) {
        sendErr(res, 404, "user not found");
        return;
      }
      const rows = await pool.query(
        `SELECT f.id, f.seller_user_id, f.buyer_user_id, f.listing_id, f.order_id, f.transaction_id,
                f.rating, f.comment, f.role, f.created_at, f.updated_at
         FROM trust.marketplace_feedback f
         WHERE f.seller_user_id = $1::uuid
         ORDER BY f.created_at DESC
         LIMIT 50`,
        [user.id],
      );
      sendOk(res, buildFeedbackSummary(rows.rows as MarketplaceFeedbackRow[]));
    } catch (e) {
      console.error("[marketplace-feedback/users]", e);
      sendErr(res, 500, "internal");
    }
  });

  app.post(
    "/marketplace-feedback",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        await ensureMarketplaceFeedbackSchema(pool);
        const userId = req.userId!;
        const {
          transaction_id,
          listing_id,
          seller_user_id,
          buyer_user_id,
          order_id,
          rating,
          comment,
          role,
        } = (req.body ?? {}) as Record<string, unknown>;

        if (
          !transaction_id ||
          !listing_id ||
          !seller_user_id ||
          !buyer_user_id ||
          !role ||
          rating == null
        ) {
          sendErr(res, 400, "missing required fields");
          return;
        }
        const roleStr = String(role);
        if (roleStr !== "buyer_to_seller" && roleStr !== "seller_to_buyer") {
          sendErr(res, 400, "invalid role");
          return;
        }
        const ratingNum = Number(rating);
        if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
          sendErr(res, 400, "rating must be 1-5");
          return;
        }
        for (const id of [transaction_id, listing_id, seller_user_id, buyer_user_id]) {
          if (!isValidUuid(String(id))) {
            sendErr(res, 400, "invalid uuid");
            return;
          }
        }
        if (roleStr === "buyer_to_seller" && userId !== String(buyer_user_id)) {
          sendErr(res, 403, "only buyer can leave buyer_to_seller feedback");
          return;
        }
        if (roleStr === "seller_to_buyer" && userId !== String(seller_user_id)) {
          sendErr(res, 403, "only seller can leave seller_to_buyer feedback");
          return;
        }

        const tx = await pool.query(
          `SELECT id, status FROM trust.marketplace_transactions WHERE id = $1::uuid`,
          [transaction_id],
        );
        if (!tx.rows[0] || tx.rows[0].status !== "completed") {
          sendErr(res, 400, "transaction not completed");
          return;
        }

        const ins = await pool.query(
          `INSERT INTO trust.marketplace_feedback
             (seller_user_id, buyer_user_id, listing_id, order_id, transaction_id, rating, comment, role)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8)
           RETURNING id, created_at`,
          [
            seller_user_id,
            buyer_user_id,
            listing_id,
            order_id ?? null,
            transaction_id,
            ratingNum,
            comment ?? null,
            roleStr,
          ],
        );
        sendOk(
          res,
          { id: ins.rows[0].id, created_at: ins.rows[0].created_at },
          201,
        );
      } catch (e: any) {
        if (e?.code === "23505") {
          sendErr(res, 409, "feedback already exists for this transaction and role");
          return;
        }
        console.error("[marketplace-feedback POST]", e);
        sendErr(res, 500, "internal");
      }
    },
  );

  /** E2E/contract seed — requires TRUST_E2E_SEED=1 */
  app.post(
    "/marketplace-feedback/seed-contract",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      if (process.env.TRUST_E2E_SEED !== "1") {
        sendErr(res, 404, "not found");
        return;
      }
      try {
        await ensureMarketplaceFeedbackSchema(pool);
        const sellerId = String(req.body?.seller_user_id || req.userId);
        const buyerId = String(req.body?.buyer_user_id || req.userId);
        const listingId = String(req.body?.listing_id || "");
        if (!isValidUuid(sellerId) || !isValidUuid(buyerId) || !isValidUuid(listingId)) {
          sendErr(res, 400, "invalid ids");
          return;
        }
        const seeds = [
          { role: "buyer_to_seller", rating: 5, comment: "Record matched description, packed well." },
          { role: "buyer_to_seller", rating: 5, comment: "Excellent communication." },
          { role: "buyer_to_seller", rating: 4, comment: "Smooth transaction." },
          { role: "buyer_to_seller", rating: 3, comment: "Arrived safely; sleeve had minor wear." },
          { role: "buyer_to_seller", rating: 1, comment: "Not as described — resolved with partial refund." },
        ];
        const inserted: string[] = [];
        for (const s of seeds) {
          const txRow = await pool.query(
            `INSERT INTO trust.marketplace_transactions (listing_id, seller_user_id, buyer_user_id, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'completed')
             RETURNING id`,
            [listingId, sellerId, buyerId],
          );
          const tid = txRow.rows[0].id as string;
          const r = await pool.query(
            `INSERT INTO trust.marketplace_feedback
               (seller_user_id, buyer_user_id, listing_id, transaction_id, rating, comment, role)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)
             ON CONFLICT (transaction_id, role) DO UPDATE
               SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()
             RETURNING id`,
            [sellerId, buyerId, listingId, tid, s.rating, s.comment, s.role],
          );
          inserted.push(r.rows[0].id);
        }
        sendOk(res, { feedback_ids: inserted });
      } catch (e) {
        console.error("[marketplace-feedback seed]", e);
        sendErr(res, 500, "internal");
      }
    },
  );
}
