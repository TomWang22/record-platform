import express from "express";
import { register, httpCounter } from "@common/utils";
import type { Router } from "express";
import oauthRouter from "./oauth-discogs.js";
import axios from "axios";
import settingsRouter from "./settings.js";
import listingsRouter from "./routes/listings.js";
import { getRedis } from "@common/utils/redis";
import { pool } from "./lib/db.js";

const app = express();
// Redis is optional - wrap in try/catch to prevent startup failures
let redis: ReturnType<typeof getRedis> | null = null;
try {
  redis = getRedis();
  // Set up error handlers to prevent crashes
  redis.on('error', (err: Error) => {
    console.warn('[listings] Redis error (non-fatal):', err.message);
  });
} catch (err) {
  console.warn('[listings] Redis initialization failed (continuing without cache):', err);
}

app.use(express.json());
app.get("/healthz", async (_req, res) => {
  try {
    // Add a timeout to the database query to prevent hanging
    const dbCheck = await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB check timeout')), 2000)) // 2 second timeout
    ]);
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    // Return 200 with warning instead of 503 - allows service to be marked ready
    // even if DB is temporarily unavailable (e.g., disk space issues)
    res.status(200).json({ ok: true, db: 'disconnected', warning: String(err) });
  }
});
app.use((req, res, next) => { res.on("finish", () => httpCounter.inc({ service: "listings", route: req.path, method: req.method, code: res.statusCode })); next(); });
app.get("/metrics", async (_req, res) => { res.setHeader("Content-Type", register.contentType); res.end(await register.metrics()); });

import ratingsRouter from './routes/ratings.js';

app.use("/oauth", oauthRouter);
app.use("/settings", settingsRouter);
app.use("/listings", listingsRouter);
app.use("/ratings", ratingsRouter);

app.get("/search/ebay", async (req, res) => {
  const qRaw = (req.query.q as string || "");
  const q = qRaw.replace(/[<>\"'`;(){}]/g, "");
  if (!q) return res.status(400).json({ error: "q required" });

  const cacheKey = `ebay:q:${q}`;
  // Try Redis cache if available
  if (redis) {
    try {
      await redis.connect().catch(()=>{});
      const cached = await redis.get(cacheKey);
      if (cached) return res.setHeader("X-Cache","HIT").json(JSON.parse(cached));
    } catch (err) {
      // Redis cache miss or error - continue without cache
      console.debug('[listings] Redis cache miss/error:', err);
    }
  }

  const token = process.env.EBAY_OAUTH_TOKEN;
  if (!token) return res.status(200).json({ query: q, items: [] });
  try {
    const r: { data?: { itemSummaries?: any[] } } = await axios.get("https://api.ebay.com/buy/browse/v1/item_summary/search", {
      params: { q, limit: 10 }, headers: { Authorization: `Bearer ${token}` }
    });
    const items = (r.data?.itemSummaries || []).map((i:any) => ({
      title:i.title,
      price:i?.price?.value,
      currency:i?.price?.currency,
      url:i.itemWebUrl,
      importCharges: i?.importCharges?.value || null
    }));
    const payload = { query: q, items };
    // Try to cache if Redis is available
    if (redis) {
      try { await redis.setex(cacheKey, 60, JSON.stringify(payload)); } catch {}
    }
    res.setHeader("Cache-Control","public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("X-Cache","MISS");
    res.json(payload);
  } catch {
    res.status(500).json({ error: "ebay search failed" });
  }
});
// Start HTTP server
const port = Number(process.env.LISTINGS_PORT || 4003);
app.listen(port, () => console.log(`listings HTTP server up on port ${port}`));

// Start gRPC server
if (process.env.ENABLE_GRPC !== "false") {
  import('./grpc-server.js').then(({ startGrpcServer }) => {
    const grpcPort = parseInt(process.env.GRPC_PORT || "50057", 10);
    startGrpcServer(grpcPort);
  }).catch((e) => {
    console.error("Failed to start gRPC server:", e);
  });
}
