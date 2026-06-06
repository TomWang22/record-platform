/**
 * GET /listings/:id/revisions — owner-only revision history (bootstrap + outbox contract).
 */
import type { Response } from "express";
import { verifyJwt } from "@common/utils/auth";
import { pool } from "./lib/db.js";
import { validateListingId } from "./validation.js";

export type AuthedRequest = {
  params: { id: string };
  headers: { authorization?: string };
  body?: unknown;
  userId?: string;
};

export async function handleListingRevisionsHttp(req: AuthedRequest, res: Response): Promise<void> {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  let userId: string;
  try {
    userId = String(verifyJwt(token).sub || "");
  } catch {
    res.status(401).json({ error: "invalid token" });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }

  const validation = validateListingId(req.params.id);
  if (!validation.ok) {
    res.status(400).json({ error: validation.message });
    return;
  }

  try {
    const own = await pool.query(
      `SELECT user_id FROM listings.listings WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      [validation.value],
    );
    if (!own.rows[0]) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (String(own.rows[0].user_id) !== userId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    let r;
    try {
      r = await pool.query(
        `SELECT id, editor_user_id, snapshot, changes, created_at
         FROM listings.listing_revisions
         WHERE listing_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT 100`,
        [validation.value],
      );
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "42703") {
        r = await pool.query(
          `SELECT id, editor_user_id, snapshot, created_at
           FROM listings.listing_revisions
           WHERE listing_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 100`,
          [validation.value],
        );
      } else {
        throw e;
      }
    }
    res.json({ revisions: r.rows, items: r.rows });
  } catch (e) {
    console.error("[listings] revisions error:", e);
    res.status(500).json({ error: "internal" });
  }
}
