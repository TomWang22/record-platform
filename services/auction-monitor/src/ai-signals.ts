/**
 * T15.4B — Scan active in-platform auctions and persist risk signals.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getRpKafka } from "@common/utils/kafka";

export type AuctionAiSignal = {
  listing_id: string;
  signal_code: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  detail: string;
  source_refs: Array<{ source_type: string; source_id: string; freshness?: string }>;
};

const ENSURE_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS auction_monitor;
CREATE TABLE IF NOT EXISTS auction_monitor.ai_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL,
  signal_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  detail TEXT,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outbox_id UUID,
  published BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (listing_id, signal_code)
);
CREATE TABLE IF NOT EXISTS auction_monitor.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  version INT NOT NULL,
  payload BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published BOOLEAN NOT NULL DEFAULT false
);
`;

export async function ensureAiSignalsSchema(auctionPool: Pool): Promise<void> {
  await auctionPool.query(ENSURE_SCHEMA_SQL);
}

const SIGNAL_CODES = new Set([
  "bid_spike",
  "ending_soon",
  "proxy_bid_pressure",
  "reserve_not_met",
  "likely_underpriced",
  "stale_listing",
]);

export function deriveAuctionSignals(row: {
  listing_id: string;
  bid_count: number;
  current_bid_cents: number;
  reserve_met: boolean;
  ends_at: Date | string;
  proxy_bidders: number;
  updated_at?: Date | string;
}): AuctionAiSignal[] {
  const signals: AuctionAiSignal[] = [];
  const ends = new Date(row.ends_at);
  const hoursLeft = (ends.getTime() - Date.now()) / (3600 * 1000);
  const refs = [
    {
      source_type: "auction_bid_summary",
      source_id: row.listing_id,
      freshness: row.updated_at ? String(row.updated_at) : undefined,
    },
  ];

  if (row.bid_count >= 5) {
    signals.push({
      listing_id: row.listing_id,
      signal_code: "bid_spike",
      severity: "medium",
      confidence: 0.65,
      detail: `${row.bid_count} bids recorded on active auction`,
      source_refs: refs,
    });
  }
  if (hoursLeft > 0 && hoursLeft <= 24) {
    signals.push({
      listing_id: row.listing_id,
      signal_code: "ending_soon",
      severity: "high",
      confidence: 0.8,
      detail: `Auction ends within ${Math.round(hoursLeft)} hours`,
      source_refs: refs,
    });
  }
  if (row.proxy_bidders > 0) {
    signals.push({
      listing_id: row.listing_id,
      signal_code: "proxy_bid_pressure",
      severity: "low",
      confidence: 0.55,
      detail: `${row.proxy_bidders} proxy bidder(s) active (max amounts not exposed)`,
      source_refs: refs,
    });
  }
  if (!row.reserve_met && row.bid_count > 0) {
    signals.push({
      listing_id: row.listing_id,
      signal_code: "reserve_not_met",
      severity: "medium",
      confidence: 0.6,
      detail: "Reserve not met on active auction",
      source_refs: refs,
    });
  }
  if (row.bid_count > 0 && row.current_bid_cents < 2000) {
    signals.push({
      listing_id: row.listing_id,
      signal_code: "likely_underpriced",
      severity: "low",
      confidence: 0.5,
      detail: "Current bid below typical marketplace band",
      source_refs: refs,
    });
  }
  if (row.bid_count === 0) {
    signals.push({
      listing_id: row.listing_id,
      signal_code: "stale_listing",
      severity: "low",
      confidence: 0.45,
      detail: "No bids on active auction",
      source_refs: refs,
    });
  }
  return signals.filter((s) => SIGNAL_CODES.has(s.signal_code));
}

export async function scanAndPersistAuctionSignals(
  listingsPool: Pool,
  auctionPool: Pool,
): Promise<{ scanned: number; inserted: number }> {
  const { rows } = await listingsPool.query(
    `SELECT a.listing_id::text, a.bid_count, a.current_bid_cents, a.reserve_met, a.ends_at, a.updated_at,
            l.user_id::text AS seller_user_id,
            (SELECT COUNT(*)::int FROM listings.proxy_bids p WHERE p.listing_id = a.listing_id) AS proxy_bidders
     FROM listings.auction_settings a
     JOIN listings.listings l ON l.id = a.listing_id
     WHERE a.status = 'active'`,
  );
  const client = await auctionPool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const signals = deriveAuctionSignals(row);
      for (const sig of signals) {
        const eventId = randomUUID();
        const payload = JSON.stringify({
          metadata: {
            event_id: eventId,
            event_type: "AuctionRiskDetectedV1",
            aggregate_id: sig.listing_id,
            aggregate_type: "listing_auction",
            occurred_at: new Date().toISOString(),
            producer: "auction-monitor",
            version: "1",
          },
          payload: {
            listing_id: sig.listing_id,
            signal_code: sig.signal_code,
            severity: sig.severity,
            confidence: sig.confidence,
            detail: sig.detail,
            source_refs: sig.source_refs,
            detected_at: new Date().toISOString(),
            seller_user_id: row.seller_user_id,
          },
        });
        const ins = await client.query(
          `INSERT INTO auction_monitor.ai_signals
             (listing_id, signal_code, severity, confidence, detail, source_refs, outbox_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::uuid)
           ON CONFLICT (listing_id, signal_code) DO UPDATE SET
             severity = EXCLUDED.severity,
             confidence = EXCLUDED.confidence,
             detail = EXCLUDED.detail,
             source_refs = EXCLUDED.source_refs,
             detected_at = now(),
             outbox_id = EXCLUDED.outbox_id,
             published = false
           RETURNING id`,
          [
            sig.listing_id,
            sig.signal_code,
            sig.severity,
            sig.confidence,
            sig.detail,
            JSON.stringify(sig.source_refs),
            eventId,
          ],
        );
        if ((ins.rowCount ?? 0) === 0) continue;
        inserted += 1;
        await client.query(
          `INSERT INTO auction_monitor.outbox_events (id, aggregate_id, type, version, payload, published)
           VALUES ($1::uuid, $2, 'AuctionRiskDetectedV1', 1, $3::bytea, false)
           ON CONFLICT (id) DO NOTHING`,
          [eventId, sig.listing_id, Buffer.from(payload, "utf8")],
        );
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { scanned: rows.length, inserted };
}

export async function publishAuctionMonitorOutbox(auctionPool: Pool): Promise<number> {
  const PREFIX = process.env.ENV_PREFIX || "dev";
  const topic = `${PREFIX}.auction_monitor.events`;
  const producer = getRpKafka("outbox-publisher").producer();
  try {
    await producer.connect();
    const { rows } = await auctionPool.query<{
      id: string;
      aggregate_id: string;
      payload: Buffer;
    }>(
      `WITH picked AS (
         SELECT id FROM auction_monitor.outbox_events WHERE published = false
         ORDER BY created_at ASC LIMIT 25 FOR UPDATE SKIP LOCKED
       )
       SELECT b.id::text, b.aggregate_id, b.payload FROM auction_monitor.outbox_events b
       INNER JOIN picked p ON b.id = p.id`,
    );
    for (const row of rows) {
      await producer.send({ topic, messages: [{ key: row.aggregate_id, value: row.payload }] });
      await auctionPool.query(`UPDATE auction_monitor.outbox_events SET published = true WHERE id = $1::uuid`, [
        row.id,
      ]);
      await auctionPool.query(`UPDATE auction_monitor.ai_signals SET published = true WHERE outbox_id = $1::uuid`, [
        row.id,
      ]);
    }
    return rows.length;
  } catch (e) {
    console.warn("[auction-monitor] outbox publish failed:", (e as Error).message);
    return 0;
  } finally {
    await producer.disconnect().catch(() => undefined);
  }
}

export async function listAiSignals(
  auctionPool: Pool,
  opts: { listingId?: string; limit?: number } = {},
): Promise<unknown[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  if (opts.listingId) {
    const r = await auctionPool.query(
      `SELECT id, listing_id, signal_code, severity, confidence, detail, source_refs, detected_at, published
       FROM auction_monitor.ai_signals WHERE listing_id = $1 ORDER BY detected_at DESC LIMIT $2`,
      [opts.listingId, limit],
    );
    return r.rows;
  }
  const r = await auctionPool.query(
    `SELECT id, listing_id, signal_code, severity, confidence, detail, source_refs, detected_at, published
     FROM auction_monitor.ai_signals ORDER BY detected_at DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}
