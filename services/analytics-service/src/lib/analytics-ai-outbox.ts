/**
 * T15.4D — Analytics outbox publisher for AIInsightCreatedV1.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getRpKafka } from "@common/utils/kafka";

const PREFIX = process.env.ENV_PREFIX || "dev";
export const AI_EVENTS_TOPIC = `${PREFIX}.ai.events`;

let producer: ReturnType<ReturnType<typeof getRpKafka>["producer"]> | null = null;
let producerReady = false;

async function ensureProducer(): Promise<ReturnType<ReturnType<typeof getRpKafka>["producer"]> | null> {
  if (process.env.ANALYTICS_OUTBOX_PUBLISHER === "0") return null;
  if (!producer) producer = getRpKafka("outbox-publisher").producer();
  if (!producerReady) {
    try {
      await producer.connect();
      producerReady = true;
    } catch (e) {
      console.warn("[analytics-outbox] kafka connect failed:", (e as Error).message);
      return null;
    }
  }
  return producer;
}

export async function insertAiInsightOutbox(
  client: PoolClient,
  input: {
    userId: string;
    contractId: string;
    sourceRefs: unknown[];
    metrics?: Record<string, unknown>;
  },
): Promise<string> {
  const eventId = randomUUID();
  const payload = JSON.stringify({
    metadata: {
      event_id: eventId,
      event_type: "AIInsightCreatedV1",
      aggregate_id: input.userId,
      aggregate_type: "user_ai_features",
      occurred_at: new Date().toISOString(),
      producer: "analytics-service",
      version: "1",
    },
    payload: {
      insight_id: eventId,
      contract_id: input.contractId,
      user_id: input.userId,
      source_status: "live",
      source_refs: input.sourceRefs,
      metrics: input.metrics ?? {},
      generated_at: new Date().toISOString(),
    },
  });
  await client.query(
    `INSERT INTO analytics.outbox_events (id, aggregate_id, type, version, payload, published)
     VALUES ($1::uuid, $2, 'AIInsightCreatedV1', 1, $3::bytea, false)`,
    [eventId, input.userId, Buffer.from(payload, "utf8")],
  );
  return eventId;
}

export async function publishAnalyticsOutboxTick(pool: Pool): Promise<number> {
  const prod = await ensureProducer();
  if (!prod) return 0;
  const client = await pool.connect();
  let published = 0;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id: string;
      aggregate_id: string;
      payload: Buffer;
    }>(
      `WITH picked AS (
         SELECT id FROM analytics.outbox_events WHERE published = false
         ORDER BY created_at ASC LIMIT 25 FOR UPDATE SKIP LOCKED
       )
       SELECT b.id::text, b.aggregate_id, b.payload FROM analytics.outbox_events b
       INNER JOIN picked p ON b.id = p.id`,
    );
    await client.query("COMMIT");
    for (const row of rows) {
      await prod.send({
        topic: AI_EVENTS_TOPIC,
        messages: [{ key: row.aggregate_id, value: row.payload }],
      });
      await pool.query(`UPDATE analytics.outbox_events SET published = true WHERE id = $1::uuid`, [row.id]);
      published += 1;
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.warn("[analytics-outbox] tick failed:", (e as Error).message);
  } finally {
    client.release();
  }
  return published;
}
