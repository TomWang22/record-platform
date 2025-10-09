import { Kafka, logLevel } from "kafkajs";
import axios from "axios";
import { Pool } from "pg";
import http from "http";

const POSTGRES_URL = process.env.POSTGRES_URL!;
const KAFKA_BROKER = process.env.KAFKA_BROKER || "kafka:9092";
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || "record-platform";
const EBAY_TOKEN = process.env.EBAY_OAUTH_TOKEN;

const healthPort = Number(process.env.AUCTION_MONITOR_PORT) || 4010;

const pool = new Pool({ connectionString: POSTGRES_URL });

const kafka = new Kafka({
  clientId: KAFKA_CLIENT_ID,
  brokers: [KAFKA_BROKER],
  logLevel: logLevel.NOTHING,
});
const admin = kafka.admin();
const producer = kafka.producer();

let dbReady = false;
let kafkaReady = false;

http
  .createServer((_req, res) => {
    const ok = dbReady && kafkaReady;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, dbReady, kafkaReady }));
  })
  .listen(healthPort, () => console.log("health server on", healthPort));

function computeTotals(
  price: number,
  ship: number,
  importCharges: number | undefined | null,
  dutyRatePct: number
) {
  const duty =
    importCharges != null
      ? Number(importCharges)
      : (Math.max(price, 0) + Math.max(ship, 0)) * (dutyRatePct / 100);
  const total = Math.round((price + ship + duty) * 100) / 100;
  return { duty, total };
}

async function waitForDb() {
  for (;;) {
    try {
      await pool.query("select 1");
      dbReady = true;
      console.log("db ok");
      return;
    } catch (e: any) {
      dbReady = false;
      console.error("db not ready:", e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function startKafka() {
  try {
    await admin.connect();
    await admin
      .createTopics({
        topics: [{ topic: "auctions.events", numPartitions: 3, replicationFactor: 1 }],
        waitForLeaders: true,
      })
      .catch(() => {});
    await producer.connect();
    kafkaReady = true;
    console.log("kafka ok");
  } catch (e: any) {
    kafkaReady = false;
    console.error("kafka init error:", e.message);
  }
}

async function pollOnce() {
  if (!dbReady) throw new Error("db not ready");

  // If you haven’t set EBAY_OAUTH_TOKEN yet, just exit quietly.
  if (!EBAY_TOKEN) {
    console.log("EBAY_OAUTH_TOKEN not set; skipping ebay polling");
    return;
  }

  const { rows: wl } = await pool.query(`
    SELECT w.id, w.user_id, w.source, w.query,
           COALESCE(us.country_code,'US') as country_code,
           COALESCE(us.fee_rate,0.0) as fee_rate,
           COALESCE(us.duty_rate,0.0) as duty_rate
    FROM listings.watchlist w
    LEFT JOIN listings.user_settings us ON us.user_id=w.user_id
  `);

  for (const it of wl) {
    if (it.source !== "ebay") continue;

    let r;
    try {
      r = await axios.get("https://api.ebay.com/buy/browse/v1/item_summary/search", {
        params: { q: it.query, limit: 20, sort: "endingSoon" },
        headers: { Authorization: `Bearer ${EBAY_TOKEN}` },
        timeout: 10_000,
      });
    } catch (e: any) {
      console.error("ebay fetch error:", e.message);
      continue;
    }

    const items = (r.data?.itemSummaries || []).map((x: any) => {
      const price = parseFloat(x?.price?.value || "0");
      const ship = parseFloat(x?.shippingOptions?.[0]?.shippingCost?.value || "0");
      const importCharges = x?.importCharges?.value ? parseFloat(x.importCharges.value) : null;
      const { duty, total } = computeTotals(price, ship, importCharges, Number(it.duty_rate || 0));
      return {
        source: "ebay",
        item_id: x.itemId,
        title: x.title,
        price,
        currency: x?.price?.currency || "USD",
        shipping: ship,
        duty,
        ends_at: x?.itemEndDate || null,
        url: x.itemWebUrl,
        total,
        country: it.country_code,
      };
    });

    for (const a of items) {
      await pool.query(
        "SELECT listings.upsert_auction($1,$2,$3,$4,$5,$6,$7,$8)",
        [a.source, a.item_id, a.title, a.price, a.currency, a.shipping, a.ends_at, a.url]
      );

      if (kafkaReady) {
        await producer.send({
          topic: "auctions.events",
          messages: [{ key: `${a.source}:${a.item_id}`, value: JSON.stringify(a) }],
        });
      }
    }
  }
}

(async () => {
  await waitForDb();
  await startKafka();

  console.log("auction-monitor up");

  // polling loop
  setInterval(() => {
    pollOnce().catch((err) => console.error("poll error:", err.message));
  }, 60_000);

  // retry kafka if it wasn’t ready at boot
  setInterval(() => {
    if (!kafkaReady) startKafka().catch(() => {});
  }, 30_000);
})();

// graceful shutdown
process.on("SIGTERM", async () => {
  try { await producer.disconnect(); } catch {}
  try { await admin.disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(0);
});