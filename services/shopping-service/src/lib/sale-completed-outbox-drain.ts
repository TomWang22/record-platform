/**
 * Phase 34 runtime — drain unpublished SaleCompleted outbox rows:
 * 1) publish to Kafka listing.events
 * 2) normalize into intelligence.raw_observations + market_events
 * 3) mark outbox published
 *
 * Integration tenant only until exact-SHA multi-service rollout is complete.
 * Does not invent settlement rows; only drains rows already written by checkout emit.
 */
import crypto from 'node:crypto'
import { kafka, ochKafkaTopicIsolationSuffix } from '@common/utils/kafka'
import { listingsPool } from './availability.js'

const ENV_PREFIX = process.env.ENV_PREFIX || 'dev'
export const SALE_COMPLETED_EVENTS_TOPIC =
  process.env.LISTING_EVENTS_TOPIC ||
  `${ENV_PREFIX}.listing.events${ochKafkaTopicIsolationSuffix()}`

let producer: Awaited<ReturnType<typeof kafka.producer>> | null = null
let drainTimer: NodeJS.Timeout | null = null

function sha256(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

async function getProducer() {
  if (!producer) {
    producer = kafka.producer()
    await producer.connect()
  }
  return producer
}

type OutboxRow = {
  id: string
  aggregate_id: string
  payload: Buffer
}

export type DrainResult = {
  scanned: number
  published: number
  normalized: number
  errors: string[]
}

async function normalizeSaleCompleted(payload: Record<string, unknown>): Promise<string> {
  const inner = (payload.payload as Record<string, unknown>) || payload
  const saleEventId = String(inner.sale_event_id || '')
  const listingId = String(inner.listing_id || inner.source_listing_id || '')
  const marketEventId = String(inner.market_event_id || `me-${saleEventId}`)
  const completedAt = String(inner.completed_at || new Date().toISOString())
  const finalPrice = Number(inner.final_price ?? inner.price_normalized ?? 0)
  const currency = String(inner.currency || inner.currency_normalized || 'USD')
  const rightsStatus = String(inner.rights_status || 'FIRST_PARTY')

  const rawPayload = {
    ...inner,
    rights_class: 'TEST_INTEGRATION_EVENT',
    integration_note:
      'Normalized from shopping SaleCompleted outbox; not historical market evidence.',
  }
  const canonicalPayloadHash = sha256(rawPayload)
  const observationId = `obs-${sha256({
    saleEventId,
    listingId,
    canonicalPayloadHash,
  }).slice(0, 24)}`

  await listingsPool.query(
    `INSERT INTO intelligence.raw_observations (
       observation_id, source_class, source_connector, source_record_id, source_event_type,
       observed_at, effective_at, raw_payload, canonical_payload_hash,
       authorization_scope, rights_classification, retention_status, deletion_status,
       connector_version, correlation_id
     ) VALUES (
       $1, 'FIRST_PARTY_SETTLEMENT', 'shopping-service-sale-completed-outbox', $2, 'SaleCompleted',
       $3::timestamptz, $3::timestamptz, $4::jsonb, $5,
       'first_party_settlement', $6, 'ACTIVE', 'ACTIVE',
       'phase34-runtime-drain-v1', $7
     )
     ON CONFLICT (observation_id) DO NOTHING`,
    [
      observationId,
      saleEventId || listingId,
      completedAt,
      JSON.stringify(rawPayload),
      canonicalPayloadHash,
      rightsStatus,
      saleEventId,
    ],
  )

  const eventPayload = {
    ...inner,
    listing_id: listingId,
    sale_event_id: saleEventId,
    price_normalized: finalPrice,
    currency_normalized: currency,
    rights_class: 'TEST_INTEGRATION_EVENT',
  }
  const eventPayloadHash = sha256(eventPayload)

  await listingsPool.query(
    `INSERT INTO intelligence.market_events (
       market_event_id, observation_id, event_type, event_status, normalization_version,
       subject_artist, subject_title, subject_catalog_number, media_condition,
       currency_original, price_original, currency_normalized, price_normalized,
       occurred_at, rights_status, deletion_status, eligibility_state, payload_hash, payload
     ) VALUES (
       $1, $2, 'SALE_COMPLETED', 'ACTIVE', 'phase34-market-event-v2',
       $3, $4, $5, $6,
       $7, $8, $7, $8,
       $9::timestamptz, $10, 'ACTIVE', 'PENDING', $11, $12::jsonb
     )
     ON CONFLICT (market_event_id) DO NOTHING`,
    [
      marketEventId,
      observationId,
      inner.artist ?? null,
      inner.title ?? null,
      inner.catalog_number ?? null,
      inner.media_condition ?? null,
      currency,
      finalPrice > 0 ? finalPrice : null,
      completedAt,
      rightsStatus,
      eventPayloadHash,
      JSON.stringify(eventPayload),
    ],
  )

  return marketEventId
}

export async function drainSaleCompletedOutboxOnce(limit = 25): Promise<DrainResult> {
  const result: DrainResult = { scanned: 0, published: 0, normalized: 0, errors: [] }
  const { rows } = await listingsPool.query<OutboxRow>(
    `SELECT id::text AS id, aggregate_id, payload
     FROM listings.outbox_events
     WHERE published = false AND type = 'SaleCompleted'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  )
  result.scanned = rows.length
  if (rows.length === 0) return result

  let prod: Awaited<ReturnType<typeof getProducer>> | null = null
  try {
    prod = await getProducer()
  } catch (err: any) {
    result.errors.push(`KAFKA_PRODUCER_CONNECT:${err?.message || err}`)
  }

  for (const row of rows) {
    try {
      const text = Buffer.isBuffer(row.payload)
        ? row.payload.toString('utf8')
        : Buffer.from(row.payload as any).toString('utf8')
      const parsed = JSON.parse(text) as Record<string, unknown>

      if (prod) {
        await prod.send({
          topic: SALE_COMPLETED_EVENTS_TOPIC,
          messages: [
            {
              key: row.aggregate_id,
              value: text,
              headers: {
                event_type: 'SaleCompleted',
                producer: 'shopping-service',
              },
            },
          ],
        })
        result.published += 1
      }

      await normalizeSaleCompleted(parsed)
      result.normalized += 1

      // Mark published only after normalize succeeds. If Kafka failed to connect,
      // still normalize for integration continuity but leave published=false so a
      // later cycle can retry Kafka once the producer is available.
      if (prod) {
        await listingsPool.query(
          `UPDATE listings.outbox_events SET published = true WHERE id = $1::uuid`,
          [row.id],
        )
      } else {
        result.errors.push(`OUTBOX_${row.id}:normalized_without_kafka_publish`)
      }
    } catch (err: any) {
      result.errors.push(`OUTBOX_${row.id}:${err?.message || err}`)
    }
  }

  return result
}

export function startSaleCompletedOutboxDrain(opts?: {
  intervalMs?: number
  enabled?: boolean
}): void {
  const enabled =
    opts?.enabled ??
    String(process.env.PHASE34_SALE_COMPLETED_OUTBOX_DRAIN || '1') !== '0'
  if (!enabled) {
    console.log('[shopping] SaleCompleted outbox drain disabled')
    return
  }
  if (drainTimer) return
  const intervalMs = opts?.intervalMs ?? Number(process.env.PHASE34_SALE_COMPLETED_DRAIN_MS || 5000)
  const tick = async () => {
    try {
      const r = await drainSaleCompletedOutboxOnce()
      if (r.scanned > 0) {
        console.log(
          `[shopping] SaleCompleted outbox drain scanned=${r.scanned} published=${r.published} normalized=${r.normalized} errors=${r.errors.length}`,
        )
        if (r.errors.length) console.warn('[shopping] SaleCompleted outbox drain errors:', r.errors)
      }
    } catch (err: any) {
      console.warn('[shopping] SaleCompleted outbox drain failed:', err?.message || err)
    }
  }
  void tick()
  drainTimer = setInterval(() => void tick(), intervalMs)
  drainTimer.unref?.()
  console.log(`[shopping] SaleCompleted outbox drain started intervalMs=${intervalMs}`)
}

export async function stopSaleCompletedOutboxDrain(): Promise<void> {
  if (drainTimer) {
    clearInterval(drainTimer)
    drainTimer = null
  }
  if (producer) {
    try {
      await producer.disconnect()
    } catch {
      /* ignore */
    }
    producer = null
  }
}
