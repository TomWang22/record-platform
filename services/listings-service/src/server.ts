import "./otel-bootstrap.js";
import express from "express";
import { register, httpCounter, mountRpHttpHealth, rpGrpcHealthOptions, installShutdownSignalHandlers } from "@common/utils";

installShutdownSignalHandlers({ service: "listings-service" });
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
mountRpHttpHealth(app, {
  service: "listings-service",
  readiness: async () => {
    try {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("DB check timeout")), 2000)),
      ]);
      return true;
    } catch {
      return false;
    }
  },
  grpc: rpGrpcHealthOptions("listings-service", "listings.ListingsService"),
});
app.use((req, res, next) => { res.on("finish", () => httpCounter.inc({ service: "listings", route: req.path, method: req.method, code: res.statusCode })); next(); });
app.get("/metrics", async (_req, res) => { res.setHeader("Content-Type", register.contentType); res.end(await register.metrics()); });

// Cache statistics endpoint
app.get("/cache/stats", async (_req, res) => {
  try {
    const { getCacheHitMissStats, getCacheStats } = await import("./lib/redis-cache.js");
    const hitMissStats = getCacheHitMissStats();
    const redisStats = await getCacheStats();
    res.json({
      cache: {
        ...hitMissStats,
        redis: redisStats,
      },
      redis: redis ? { connected: true } : { connected: false },
    });
  } catch (err: any) {
    res.status(500).json({ error: "failed to get cache stats", message: err.message });
  }
});

import ratingsRouter from './routes/ratings.js';
import { createListingsHttpApp } from "./http-server.js";
import { mountListingsOffersHttp } from "./listings-offers-http.js";
import { mountListingsAuctionHttp } from "./listings-auction-http.js";

/** Gateway rewrites POST /api/listings/create → POST /create (housing-schema contract). */
const listingsContractHttp = createListingsHttpApp();

const LISTING_UUID_PARAM =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.post("/create", (req, res, next) => {
  listingsContractHttp(req, res, next);
});

/** Owner inventory (gateway → GET /api/listings/mine → /mine). */
app.get("/mine", (req, res, next) => {
  listingsContractHttp(req, res, next);
});

/** Public marketplace search (gateway → GET /listings/search). */
app.get("/listings/search", (req, res, next) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  req.url = `/search${qs}`;
  listingsContractHttp(req, res, next);
});

/** Public marketplace detail by UUID only — must not capture /listings/search or /listings/mine. */
app.get("/listings/:id", (req, res, next) => {
  if (!LISTING_UUID_PARAM.test(String(req.params.id ?? ""))) {
    return next();
  }
  listingsContractHttp(req, res, next);
});

/** Owner PATCH (title, price, amenities, sale mode) — contract http-server handler, not legacy router stub. */
app.patch("/listings/:id", (req, res, next) => {
  if (!LISTING_UUID_PARAM.test(String(req.params.id ?? ""))) {
    return next();
  }
  listingsContractHttp(req, res, next);
});

/** Gallery media attach/delete/reorder (contract http-server; not legacy /:id/images). */
app.post("/listings/:id/media", (req, res, next) => {
  if (!LISTING_UUID_PARAM.test(String(req.params.id ?? ""))) {
    return next();
  }
  listingsContractHttp(req, res, next);
});

app.delete("/listings/:id/media/:mediaId", (req, res, next) => {
  if (
    !LISTING_UUID_PARAM.test(String(req.params.id ?? "")) ||
    !LISTING_UUID_PARAM.test(String(req.params.mediaId ?? ""))
  ) {
    return next();
  }
  listingsContractHttp(req, res, next);
});

app.patch("/listings/:id/media-order", (req, res, next) => {
  if (!LISTING_UUID_PARAM.test(String(req.params.id ?? ""))) {
    return next();
  }
  listingsContractHttp(req, res, next);
});

mountListingsOffersHttp(app);
mountListingsAuctionHttp(app);

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
const port = Number(process.env.LISTINGS_PORT || 4003);

// Start gRPC before HTTP so /readyz local mTLS check can reach a listening server.
if (process.env.ENABLE_GRPC !== "false") {
  import("./grpc-server.js")
    .then(({ startGrpcServer }) => {
      const grpcPort = parseInt(process.env.GRPC_PORT || "50062", 10);
      startGrpcServer(grpcPort);
    })
    .catch((e) => {
      console.error("Failed to start gRPC server:", e);
    });
}

app.listen(port, () => console.log(`listings HTTP server up on port ${port}`));
