import express from "express";
import { register, httpCounter } from "@common/utils/src/metrics";
import oauthRouter from "./oauth-discogs";
import axios from "axios";
import settingsRouter from "./settings";
import { getRedis } from "@common/utils/src/redis";

const app = express();
const redis = getRedis();

app.use(express.json());
app.get("/healthz", (_req,res)=>res.json({ok:true}));
app.use((req, res, next) => { res.on("finish", () => httpCounter.inc({ service: "listings", route: req.path, method: req.method, code: res.statusCode })); next(); });
app.get("/metrics", async (_req, res) => { res.setHeader("Content-Type", register.contentType); res.end(await register.metrics()); });

app.use("/oauth", oauthRouter);
app.use("/settings", settingsRouter);

app.get("/search/ebay", async (req, res) => {
  const qRaw = (req.query.q as string || "");
  const q = qRaw.replace(/[<>\"'`;(){}]/g, "");
  if (!q) return res.status(400).json({ error: "q required" });

  const cacheKey = `ebay:q:${q}`;
  try { await redis.connect().catch(()=>{}); } catch {}

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.setHeader("X-Cache","HIT").json(JSON.parse(cached));
  } catch {}

  const token = process.env.EBAY_OAUTH_TOKEN;
  if (!token) return res.status(200).json({ query: q, items: [] });
  try {
    const r = await axios.get("https://api.ebay.com/buy/browse/v1/item_summary/search", {
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
    try { await redis.setex(cacheKey, 60, JSON.stringify(payload)); } catch {}
    res.setHeader("Cache-Control","public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("X-Cache","MISS");
    res.json(payload);
  } catch {
    res.status(500).json({ error: "ebay search failed" });
  }
});
const port = Number(process.env.LISTINGS_PORT || 4003);
app.listen(port, () => console.log(`listings up on ${port}`));
