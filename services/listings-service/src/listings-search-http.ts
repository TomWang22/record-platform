/**
 * HTTP GET /listings/search — aligned with restored RP DB (price_cents, deleted_at, listing_media).
 * Used by production server.ts router; keep in sync with search-listings-query.ts.
 */
import type { Request, Response } from "express";
import { pool } from "./lib/db.js";
import { buildListingsSearchQuery } from "./search-listings-query.js";

export async function handleListingsSearchHttp(req: Request, res: Response): Promise<void> {
  try {
    const limitRaw = req.query.limit != null ? Number(req.query.limit) : 50;
    const offsetRaw = req.query.offset != null ? Number(req.query.offset) : 0;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 240) : 50;
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

    const minP =
      req.query.min_price != null
        ? Number(req.query.min_price)
        : req.query.minPrice != null
          ? Number(req.query.minPrice)
          : null;
    const maxP =
      req.query.max_price != null
        ? Number(req.query.max_price)
        : req.query.maxPrice != null
          ? Number(req.query.maxPrice)
          : null;

    const { sql, params } = buildListingsSearchQuery({
      q: String(req.query.q || req.query.query || "").trim(),
      minP: minP != null && !Number.isNaN(minP) ? minP : null,
      maxP: maxP != null && !Number.isNaN(maxP) ? maxP : null,
      limit,
      offset,
      sort: String(req.query.sort || "created_desc").trim(),
    });

    const result = await pool.query(sql, params);
    const rows = result.rows as Record<string, unknown>[];
    const sqlTotal = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const data = rows.map((r) => {
      const row = { ...r };
      delete row.total_count;
      return row;
    });

    res.setHeader("Cache-Control", "public, max-age=10");
    res.json({
      items: data,
      data,
      listings: data,
      totalCount: sqlTotal,
      totalApprox: sqlTotal,
      limit,
      offset,
      hasMore: offset + data.length < sqlTotal,
    });
  } catch (err) {
    console.error("[listings] search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
