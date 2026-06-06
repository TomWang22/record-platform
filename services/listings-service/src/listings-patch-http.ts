/**
 * PATCH /listings/:id — owner edit + revision row (outbox contract runtime C).
 */
import type { Response } from "express";
import { verifyJwt } from "@common/utils/auth";
import { pool } from "./lib/db.js";
import { validateListingId } from "./validation.js";
import { insertListingRevisionEntry } from "./listing-revision-write.js";
import type { AuthedRequest } from "./listings-revisions-http.js";

export async function handleListingPatchHttp(req: AuthedRequest, res: Response): Promise<void> {
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

  const validation = validateListingId(req.params.id);
  if (!validation.ok) {
    res.status(400).json({ error: validation.message });
    return;
  }

  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const description =
    body.description != null ? String(body.description) : undefined;
  if (description === undefined) {
    res.status(400).json({ error: "no supported fields to update" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT id, user_id, description FROM listings.listings
       WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
      [validation.value],
    );
    const row = cur.rows[0] as { id: string; user_id: string; description: string } | undefined;
    if (!row) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "not found" });
      return;
    }
    if (String(row.user_id) !== userId) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "forbidden" });
      return;
    }
    await client.query(
      `UPDATE listings.listings SET description = $1, updated_at = now(), version = version + 1
       WHERE id = $2::uuid`,
      [description, validation.value],
    );
    await insertListingRevisionEntry(client, validation.value, userId, {
      description: { from: row.description, to: description },
    });
    await client.query("COMMIT");
    res.status(200).json({ ok: true, id: validation.value });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[listings] patch error:", e);
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
}
