/**
 * T15.4B — Scan active in-platform auctions and persist risk signals.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { getRpKafka } from "@common/utils/kafka";
import { buildKafkaMessageHeaders, withKafkaProduceSpan } from "@common/utils/otel";
import {
  incOchOutboxPublishAttempt,
  incOchOutboxPublishFailure,
  incOchOutboxPublishSuccess,
  setOchOutboxOldestUnpublishedAgeSeconds,
  setOchOutboxUnpublishedCount,
} from "@common/utils";
import {
  incOutboxBrokerAck,
  incOutboxDbAck,
  incOutboxFailure,
  incOutboxProduceAttempt,
  incOutboxSelected,
  observeOutboxPublishLatency,
  setOutboxOldestPendingAgeSeconds,
  setOutboxPending,
} from "./outbox-publish-metrics.js";

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

let lastPendingGaugeRefreshMs = 0;

async function refreshOutboxPendingGauges(auctionPool: Pool): Promise<void> {
  const now = Date.now();
  // Full pending COUNT on multi-million-row table is expensive; throttle hard.
  if (now - lastPendingGaugeRefreshMs < 600_000) return;
  lastPendingGaugeRefreshMs = now;
  try {
    const r = await auctionPool.query<{ c: string; oldest_sec: number | null }>(
      `SELECT count(*)::text AS c,
              COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0)::float8 AS oldest_sec
       FROM auction_monitor.outbox_events WHERE published = false`,
    );
    const n = Number(r.rows[0]?.c ?? 0);
    const oldest = Number(r.rows[0]?.oldest_sec ?? 0);
    setOutboxPending(n);
    setOutboxOldestPendingAgeSeconds(oldest);
    setOchOutboxUnpublishedCount(n);
    setOchOutboxOldestUnpublishedAgeSeconds(oldest);
  } catch {
    // gauges are best-effort; never fail the publisher on refresh
  }
}

/**
 * Publish oldest unpublished auction-monitor outbox rows.
 * Broker acknowledgment (KafkaJS RecordMetadata) and database acknowledgment
 * (published=true) are counted and logged separately — never equated.
 */
export async function publishAuctionMonitorOutbox(auctionPool: Pool): Promise<number> {
  const PREFIX = process.env.ENV_PREFIX || "dev";
  const topic = `${PREFIX}.auction_monitor.events`;
  const producer = getRpKafka("outbox-publisher").producer();
  const producerClientId = process.env.KAFKA_CLIENT_ID || "auction-monitor-outbox-publisher";
  const tracer = trace.getTracer("auction-monitor-outbox");
  const invocationId = randomUUID();
  const tickStarted = Date.now();
  let published = 0;

  const rootSpan = tracer.startSpan("auction_monitor.outbox.publish_tick", {
    attributes: {
      "rp.outbox.invocation_id": invocationId,
      "messaging.destination.name": topic,
      "rp.kafka.principal": "User:O=Record Platform,CN=auction-monitor",
    },
  });

  try {
    return await context.with(trace.setSpan(context.active(), rootSpan), async () => {
      await producer.connect();

      const selectStarted = Date.now();
      const selectSpan = tracer.startSpan("auction_monitor.outbox.database_selection");
      let rows: Array<{ id: string; aggregate_id: string; payload: Buffer }>;
      try {
        const result = await auctionPool.query<{
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
        rows = result.rows;
        selectSpan.setAttribute("rp.outbox.selected", rows.length);
      } catch (e) {
        selectSpan.recordException(e instanceof Error ? e : new Error(String(e)));
        selectSpan.setStatus({ code: SpanStatusCode.ERROR });
        incOutboxSelected("error");
        throw e;
      } finally {
        selectSpan.end();
        observeOutboxPublishLatency("database_selection", (Date.now() - selectStarted) / 1000);
      }

      if (rows.length === 0) {
        incOutboxSelected("empty");
        void refreshOutboxPendingGauges(auctionPool);
        console.log(
          JSON.stringify({
            msg: "auction_monitor_outbox_publish_batch",
            invocation_id: invocationId,
            selected: 0,
            broker_acks: 0,
            db_acks: 0,
            failures: 0,
            topic,
            producer_client_id: producerClientId,
            kafka_principal: "User:O=Record Platform,CN=auction-monitor",
            latency_ms: Date.now() - tickStarted,
            note: "no rows",
          }),
        );
        return 0;
      }

      incOutboxSelected("ok");
      let brokerAcks = 0;
      let dbAcks = 0;
      let failures = 0;

      for (const row of rows) {
        const attemptNumber = 1;
        const sendStarted = Date.now();
        incOchOutboxPublishAttempt();
        let produceResultRecorded = false;
        try {
          const metadata = await withKafkaProduceSpan(
            `auction_monitor.outbox.kafka_produce`,
            {
              "messaging.destination.name": topic,
              "rp.outbox.id": row.id,
              "rp.outbox.attempt": attemptNumber,
            },
            async () =>
              producer.send({
                topic,
                messages: [
                  {
                    key: row.aggregate_id,
                    value: row.payload,
                    headers: buildKafkaMessageHeaders(),
                  },
                ],
              }),
          );
          const sendDurationMs = Date.now() - sendStarted;
          observeOutboxPublishLatency("kafka_produce", sendDurationMs / 1000);
          incOutboxProduceAttempt("ok");
          produceResultRecorded = true;

          const meta0 = Array.isArray(metadata) ? metadata[0] : undefined;
          const partition = meta0?.partition;
          const offset = meta0?.offset;
          const brokerAckTs = new Date().toISOString();
          const activeSpan = trace.getActiveSpan();
          const traceId = activeSpan?.spanContext().traceId ?? "NOT_INSTRUMENTED";

          if (partition === undefined || offset === undefined) {
            incOutboxBrokerAck("error");
            throw new Error("kafka_broker_ack_metadata_missing");
          }
          incOutboxBrokerAck("ok");
          brokerAcks += 1;

          const dbStarted = Date.now();
          const dbSpan = tracer.startSpan("auction_monitor.outbox.database_acknowledgment");
          try {
            await auctionPool.query(
              `UPDATE auction_monitor.outbox_events SET published = true WHERE id = $1::uuid`,
              [row.id],
            );
            await auctionPool.query(
              `UPDATE auction_monitor.ai_signals SET published = true WHERE outbox_id = $1::uuid`,
              [row.id],
            );
            incOutboxDbAck("ok");
            incOchOutboxPublishSuccess();
            dbAcks += 1;
            published += 1;
            dbSpan.setAttribute("rp.outbox.db_ack", "ok");
          } catch (e) {
            incOutboxDbAck("error");
            dbSpan.recordException(e instanceof Error ? e : new Error(String(e)));
            dbSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw e;
          } finally {
            dbSpan.end();
            observeOutboxPublishLatency("database_acknowledgment", (Date.now() - dbStarted) / 1000);
          }

          console.log(
            JSON.stringify({
              msg: "auction_monitor_outbox_broker_and_db_ack",
              invocation_id: invocationId,
              outbox_id: row.id,
              event_id: row.id,
              topic,
              partition,
              offset: String(offset),
              broker_ack_timestamp: brokerAckTs,
              producer_client_id: producerClientId,
              kafka_principal: "User:O=Record Platform,CN=auction-monitor",
              trace_id: traceId,
              attempt_number: attemptNumber,
              send_duration_ms: sendDurationMs,
              database_acknowledgment_result: "ok",
            }),
          );
        } catch (e) {
          failures += 1;
          if (!produceResultRecorded) {
            incOutboxProduceAttempt("error");
          }
          incOutboxFailure("publish_or_db_ack");
          incOchOutboxPublishFailure();
          console.warn(
            JSON.stringify({
              msg: "auction_monitor_outbox_publish_row_failed",
              invocation_id: invocationId,
              outbox_id: row.id,
              topic,
              producer_client_id: producerClientId,
              kafka_principal: "User:O=Record Platform,CN=auction-monitor",
              attempt_number: attemptNumber,
              database_acknowledgment_result: "not_attempted_or_failed",
              error_class: e instanceof Error ? e.name : "Error",
            }),
          );
          // Stop the batch on first failure (prior behavior returned 0 on outer catch).
          break;
        }
      }

      void refreshOutboxPendingGauges(auctionPool);
      console.log(
        JSON.stringify({
          msg: "auction_monitor_outbox_publish_batch",
          invocation_id: invocationId,
          selected: rows.length,
          broker_acks: brokerAcks,
          db_acks: dbAcks,
          failures,
          topic,
          producer_client_id: producerClientId,
          kafka_principal: "User:O=Record Platform,CN=auction-monitor",
          latency_ms: Date.now() - tickStarted,
        }),
      );
      rootSpan.setAttribute("rp.outbox.broker_acks", brokerAcks);
      rootSpan.setAttribute("rp.outbox.db_acks", dbAcks);
      return published;
    });
  } catch (e) {
    rootSpan.recordException(e instanceof Error ? e : new Error(String(e)));
    rootSpan.setStatus({ code: SpanStatusCode.ERROR });
    incOutboxFailure("tick");
    console.warn("[auction-monitor] outbox publish failed:", (e as Error).message);
    return published;
  } finally {
    rootSpan.end();
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
