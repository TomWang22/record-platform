import { Kafka } from "kafkajs";
import axios from "axios";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const kafka = new Kafka({ clientId: process.env.KAFKA_CLIENT_ID || "record-platform", brokers: [process.env.KAFKA_BROKER || "kafka:9092"] });
const producer = kafka.producer();
const admin = kafka.admin();
const EBAY_TOKEN = process.env.EBAY_OAUTH_TOKEN;

function computeTotals(price:number, ship:number, importCharges:number|undefined|null, dutyRatePct:number){
  const duty = importCharges != null ? Number(importCharges) : (Math.max(price,0)+Math.max(ship,0))*(dutyRatePct/100);
  const total = Math.round((price + ship + duty) * 100) / 100;
  return { duty, total };
}

async function pollOnce() {
  const { rows: wl } = await pool.query(`
    SELECT w.id, w.user_id, w.source, w.query,
           COALESCE(us.country_code,'US') as country_code,
           COALESCE(us.fee_rate,0.0) as fee_rate,
           COALESCE(us.duty_rate,0.0) as duty_rate
    FROM listings.watchlist w
    LEFT JOIN listings.user_settings us ON us.user_id=w.user_id
  `);
  for (const it of wl) {
    if (it.source !== "ebay" || !EBAY_TOKEN) continue;
    const r = await axios.get("https://api.ebay.com/buy/browse/v1/item_summary/search", {
      params: { q: it.query, limit: 20, sort: "endingSoon" },
      headers: { Authorization: `Bearer ${EBAY_TOKEN}` }
    });
    const items = (r.data?.itemSummaries || []).map((x:any) => {
      const price = parseFloat(x?.price?.value || "0");
      const ship  = parseFloat(x?.shippingOptions?.[0]?.shippingCost?.value || "0");
      const importCharges = x?.importCharges?.value ? parseFloat(x.importCharges.value) : null;
      const { duty, total } = computeTotals(price, ship, importCharges, Number(it.duty_rate||0));
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
        country: it.country_code
      };
    });
    for (const a of items) {
      await pool.query("SELECT listings.upsert_auction($1,$2,$3,$4,$5,$6,$7,$8)", [a.source, a.item_id, a.title, a.price, a.currency, a.shipping, a.ends_at, a.url]);
      await producer.send({ topic: "auctions.events", messages: [{ key: `${a.source}:${a.item_id}`, value: JSON.stringify(a) }] });
    }
  }
}

(async () => {
  await admin.connect();
  await admin.createTopics({ topics: [{ topic: "auctions.events", numPartitions: 3, replicationFactor: 1 }], waitForLeaders: true }).catch(()=>{});
  await admin.disconnect();

  await producer.connect();
  console.log("auction-monitor up");
  setInterval(() => pollOnce().catch(err => console.error("poll error", err)), 60_000);
})();
