/**
 * Phase 34 runtime — hardened SaleCompleted outbox publisher + normalizer.
 *
 * Lease → Kafka ack → mark published. Retries with backoff. Dead-letters after limit.
 * Pure core is injectable for crash/replay unit tests.
 */
import crypto from 'node:crypto'
import { kafka, rpKafkaTopicIsolationSuffix } from '@common/utils/kafka'
import { listingsPool } from './availability.js'

const ENV_PREFIX = process.env.ENV_PREFIX || 'dev'
export const SALE_COMPLETED_EVENTS_TOPIC =
  process.env.LISTING_EVENTS_TOPIC ||
  `${ENV_PREFIX}.listing.events${rpKafkaTopicIsolationSuffix()}`

export const DEFAULT_MAX_RETRIES = Number(process.env.PHASE34_OUTBOX_MAX_RETRIES || 8)
export const DEFAULT_LEASE_MS = Number(process.env.PHASE34_OUTBOX_LEASE_MS || 30000)
export const SOURCE_SHA =
  process.env.RP_SOURCE_SHA || process.env.SOURCE_SHA || process.env.GIT_SHA || 'unknown'

let producer: Awaited<ReturnType<typeof kafka.producer>> | null = null
let drainTimer: NodeJS.Timeout | null = null
let draining = false

export function sha256(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

export function backoffMs(retryCount: number): number {
  const base = 1000 * Math.pow(2, Math.min(retryCount, 6))
  return Math.min(base, 60_000)
}

export type OutboxRow = {
  id: string
  aggregate_id: string
  payload: Buffer | Uint8Array | string
  retry_count?: number
  payload_hash?: string | null
  idempotency_key?: string | null
}

export type PublishAck = {
  topic: string
  partition: number
  offset: string
}

export type DrainDeps = {
  leaseBatch: (limit: number, owner: string, leaseMs: number) => Promise<OutboxRow[]>
  publish: (row: OutboxRow, text: string, headers: Record<string, string>) => Promise<PublishAck>
  normalize: (parsed: Record<string, unknown>, row: OutboxRow, ack?: PublishAck) => Promise<string>
  markPublished: (row: OutboxRow, ack: PublishAck, owner: string) => Promise<void>
  markRetry: (row: OutboxRow, error: string, nextAttemptAt: Date, owner: string) => Promise<void>
  markDeadLetter: (row: OutboxRow, error: string, owner: string) => Promise<void>
  maxRetries?: number
  now?: () => Date
  owner?: string
  sourceSha?: string
}

export type DrainResult = {
  scanned: number
  published: number
  normalized: number
  retried: number
  dead_lettered: number
  errors: string[]
}

export function parseOutboxPayload(payload: OutboxRow['payload']): {
  text: string
  parsed: Record<string, unknown>
} {
  const text = Buffer.isBuffer(payload)
    ? payload.toString('utf8')
    : typeof payload === 'string'
      ? payload
      : Buffer.from(payload).toString('utf8')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch (err: any) {
    const e = new Error(`MALFORMED_OUTBOX_PAYLOAD:${err?.message || err}`)
    ;(e as any).code = 'MALFORMED_OUTBOX_PAYLOAD'
    throw e
  }
  return { text, parsed }
}

export function buildPublishHeaders(row: OutboxRow, parsed: Record<string, unknown>, sourceSha: string) {
  const inner = (parsed.payload as Record<string, unknown>) || parsed
  const meta = (parsed.metadata as Record<string, unknown>) || {}
  const eventId = String(meta.event_id || row.id)
  const marketEventId = String(inner.market_event_id || '')
  const payloadHash = row.payload_hash || sha256(parsed)
  return {
    event_id: eventId,
    market_event_id: marketEventId,
    event_type: 'SaleCompleted',
    schema_version: '1',
    producer: 'shopping-service',
    source_sha: sourceSha,
    correlation_id: String(inner.sale_event_id || eventId),
    trace_id: String(meta.trace_id || ''),
    occurred_at: String(inner.completed_at || meta.occurred_at || ''),
    payload_hash: payloadHash,
    idempotency_key: String(row.idempotency_key || eventId),
  }
}

/**
 * Core drain algorithm — injectable for crash/replay tests.
 * Mark published only after broker acknowledgement + normalize success.
 */
export async function drainSaleCompletedOutboxCore(
  deps: DrainDeps,
  limit = 25,
): Promise<DrainResult> {
  const result: DrainResult = {
    scanned: 0,
    published: 0,
    normalized: 0,
    retried: 0,
    dead_lettered: 0,
    errors: [],
  }
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES
  const owner = deps.owner || `shopping-drain-${process.pid}`
  const sourceSha = deps.sourceSha || SOURCE_SHA
  const now = deps.now || (() => new Date())

  const rows = await deps.leaseBatch(limit, owner, DEFAULT_LEASE_MS)
  result.scanned = rows.length

  for (const row of rows) {
    const retryCount = Number(row.retry_count || 0)
    try {
      const { text, parsed } = parseOutboxPayload(row.payload)
      const headers = buildPublishHeaders(row, parsed, sourceSha)
      const ack = await deps.publish(row, text, headers)
      result.published += 1
      // Crash window A: after Kafka ack, before normalize/mark — retry must be idempotent.
      const withBroker = {
        ...parsed,
        _broker_partition: ack.partition,
        _broker_offset: Number(ack.offset) || 0,
      }
      await deps.normalize(withBroker, row, ack)
      result.normalized += 1
      await deps.markPublished(row, ack, owner)
    } catch (err: any) {
      const msg = String(err?.message || err)
      result.errors.push(`OUTBOX_${row.id}:${msg}`)
      if (err?.code === 'MALFORMED_OUTBOX_PAYLOAD' || retryCount + 1 >= maxRetries) {
        await deps.markDeadLetter(row, msg, owner)
        result.dead_lettered += 1
      } else {
        const next = new Date(now().getTime() + backoffMs(retryCount))
        await deps.markRetry(row, msg, next, owner)
        result.retried += 1
      }
    }
  }
  return result
}

async function getProducer() {
  if (!producer) {
    producer = kafka.producer()
    await producer.connect()
  }
  return producer
}

export async function normalizeSaleCompleted(
  payload: Record<string, unknown>,
  pool = listingsPool,
): Promise<string> {
  const inner = (payload.payload as Record<string, unknown>) || payload
  const saleEventId = String(inner.sale_event_id || '')
  const listingId = String(inner.listing_id || inner.source_listing_id || '')
  const marketEventId = String(inner.market_event_id || `me-${saleEventId}`)
  const completedAt = String(inner.completed_at || new Date().toISOString())
  const finalPrice = Number(inner.final_price ?? inner.price_normalized ?? 0)
  const currency = String(inner.currency || inner.currency_normalized || 'USD')
  const rightsStatus = String(inner.rights_status || 'FIRST_PARTY')
  const sourceEventId = String(
    (payload.metadata as any)?.event_id || saleEventId || marketEventId,
  )

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

  const eventPayload = {
    ...inner,
    listing_id: listingId,
    sale_event_id: saleEventId,
    price_normalized: finalPrice,
    currency_normalized: currency,
    rights_class: 'TEST_INTEGRATION_EVENT',
  }
  const eventPayloadHash = sha256(eventPayload)

  // Migration 57: decide identity/delivery BEFORE creating market events.
  const topic = SALE_COMPLETED_EVENTS_TOPIC
  const partitionId = Number((payload as any)._broker_partition ?? 0)
  const recordOffset = Number((payload as any)._broker_offset ?? Date.now() % 1_000_000_000)
  const normVersion = 'phase34-market-event-v2'
  const deliveryId = `dlv-${sha256({ topic, partitionId, recordOffset }).slice(0, 28)}`

  const priorDelivery = await pool
    .query(
      `SELECT delivery_lineage_id, result, market_event_id
       FROM intelligence.kafka_delivery_lineage
       WHERE topic = $1 AND partition_id = $2 AND record_offset = $3
       LIMIT 1`,
      [topic, partitionId, recordOffset],
    )
    .catch(() => ({ rows: [] as any[] }))

  if (priorDelivery.rows.length) {
    return String(priorDelivery.rows[0].market_event_id || marketEventId)
  }

  const identity = await pool
    .query(
      `SELECT source_event_id, canonical_payload_hash, accepted_market_event_id
       FROM intelligence.kafka_event_identities
       WHERE source_event_id = $1 AND normalization_version = $2
       LIMIT 1`,
      [sourceEventId, normVersion],
    )
    .catch(() => ({ rows: [] as any[] }))

  if (identity.rows.length) {
    const prev = identity.rows[0]
    if (prev.canonical_payload_hash === eventPayloadHash) {
      await pool
        .query(
          `INSERT INTO intelligence.kafka_delivery_lineage (
             delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
             normalization_version, received_payload_hash, canonical_payload_hash,
             market_event_id, result, duplicate_flag, source_sha
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, 'DUPLICATE_DELIVERY', true, $10
           )
           ON CONFLICT (topic, partition_id, record_offset) DO NOTHING`,
          [
            deliveryId,
            topic,
            partitionId,
            recordOffset,
            sourceEventId,
            normVersion,
            eventPayloadHash,
            prev.canonical_payload_hash,
            prev.accepted_market_event_id || marketEventId,
            SOURCE_SHA,
          ],
        )
        .catch(() => {})
      return String(prev.accepted_market_event_id || marketEventId)
    }

    const quarantineId = `q-${sha256({ sourceEventId, eventPayloadHash }).slice(0, 24)}`
    await pool
      .query(
        `INSERT INTO intelligence.kafka_event_quarantine (
           quarantine_id, topic, partition_id, record_offset, source_event_id, payload, reason
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (quarantine_id) DO NOTHING`,
        [
          quarantineId,
          topic,
          partitionId,
          recordOffset,
          sourceEventId,
          JSON.stringify(eventPayload),
          'IDENTITY_PAYLOAD_CONFLICT',
        ],
      )
      .catch(() => {})
    await pool
      .query(
        `INSERT INTO intelligence.kafka_delivery_lineage (
           delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
           normalization_version, received_payload_hash, canonical_payload_hash,
           market_event_id, result, duplicate_flag, rejection_reason, source_sha
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, 'IDENTITY_PAYLOAD_CONFLICT', false,
           'IDENTITY_PAYLOAD_CONFLICT', $10
         )
         ON CONFLICT (topic, partition_id, record_offset) DO NOTHING`,
        [
          deliveryId,
          topic,
          partitionId,
          recordOffset,
          sourceEventId,
          normVersion,
          eventPayloadHash,
          prev.canonical_payload_hash,
          prev.accepted_market_event_id || null,
          SOURCE_SHA,
        ],
      )
      .catch(() => {})
    const err = new Error(`IDENTITY_PAYLOAD_CONFLICT:${sourceEventId}`)
    ;(err as any).code = 'IDENTITY_PAYLOAD_CONFLICT'
    throw err
  }

  await pool.query(
    `INSERT INTO intelligence.raw_observations (
       observation_id, source_class, source_connector, source_record_id, source_event_type,
       observed_at, effective_at, raw_payload, canonical_payload_hash,
       authorization_scope, rights_classification, retention_status, deletion_status,
       connector_version, correlation_id
     ) VALUES (
       $1, 'FIRST_PARTY_SETTLEMENT', 'shopping-service-sale-completed-outbox', $2, 'SaleCompleted',
       $3::timestamptz, $3::timestamptz, $4::jsonb, $5,
       'first_party_settlement', $6, 'ACTIVE', 'ACTIVE',
       'phase34-runtime-drain-v3', $7
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

  await pool.query(
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

  await pool
    .query(
      `INSERT INTO intelligence.kafka_event_identities (
         source_event_id, normalization_version, canonical_payload_hash,
         accepted_market_event_id, first_topic, first_partition, first_offset, source_sha
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (source_event_id, normalization_version) DO NOTHING`,
      [
        sourceEventId,
        normVersion,
        eventPayloadHash,
        marketEventId,
        topic,
        partitionId,
        recordOffset,
        SOURCE_SHA,
      ],
    )
    .catch(() => {})

  await pool
    .query(
      `INSERT INTO intelligence.kafka_delivery_lineage (
         delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
         normalization_version, received_payload_hash, canonical_payload_hash,
         market_event_id, result, duplicate_flag, source_sha
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACCEPTED', false, $10
       )
       ON CONFLICT (topic, partition_id, record_offset) DO NOTHING`,
      [
        deliveryId,
        topic,
        partitionId,
        recordOffset,
        sourceEventId,
        normVersion,
        eventPayloadHash,
        eventPayloadHash,
        marketEventId,
        SOURCE_SHA,
      ],
    )
    .catch(() => {})

  const lineageId = `lin-${sha256({ sourceEventId, eventPayloadHash, recordOffset }).slice(0, 24)}`
  await pool
    .query(
      `INSERT INTO intelligence.kafka_consumer_lineage (
         lineage_id, topic, partition_id, record_offset, source_event_id, market_event_id,
         payload_hash, normalization_version, result, duplicate_flag, source_sha
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, 'ACCEPTED', false, $9
       )
       ON CONFLICT (topic, partition_id, record_offset) DO NOTHING`,
      [
        lineageId,
        topic,
        partitionId,
        recordOffset,
        sourceEventId,
        marketEventId,
        eventPayloadHash,
        normVersion,
        SOURCE_SHA,
      ],
    )
    .catch(() => {})

  return marketEventId
}

function createPgDeps(pool = listingsPool): DrainDeps {
  return {
    async leaseBatch(limit, owner, leaseMs) {
      try {
        const { rows } = await pool.query(
          `SELECT id::text AS id, aggregate_id, payload, retry_count, payload_hash, idempotency_key
           FROM listings.lease_outbox_batch($1, $2, $3, 'SaleCompleted')`,
          [limit, owner, leaseMs],
        )
        return rows
      } catch {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const { rows } = await client.query(
            `SELECT id::text AS id, aggregate_id, payload, retry_count, payload_hash, idempotency_key
             FROM listings.outbox_events
             WHERE published = false
               AND COALESCE(dead_lettered, false) = false
               AND type = 'SaleCompleted'
               AND next_attempt_at <= NOW()
               AND (leased_until IS NULL OR leased_until < NOW())
             ORDER BY created_at ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [limit],
          )
          if (rows.length) {
            const ids = rows.map((r: any) => r.id)
            await client.query(
              `UPDATE listings.outbox_events
               SET leased_until = NOW() + ($1::text || ' milliseconds')::interval,
                   lease_owner = $2
               WHERE id = ANY($3::uuid[])`,
              [String(leaseMs), owner, ids],
            )
          }
          await client.query('COMMIT')
          return rows
        } catch (err) {
          await client.query('ROLLBACK')
          const { rows } = await pool.query(
            `SELECT id::text AS id, aggregate_id, payload, 0 AS retry_count, NULL AS payload_hash, id::text AS idempotency_key
             FROM listings.outbox_events
             WHERE published = false AND type = 'SaleCompleted'
             ORDER BY created_at ASC
             LIMIT $1`,
            [limit],
          )
          return rows
        } finally {
          client.release()
        }
      }
    },
    async publish(row, text, headers) {
      const prod = await getProducer()
      const res = await prod.send({
        topic: SALE_COMPLETED_EVENTS_TOPIC,
        messages: [
          {
            key: row.aggregate_id,
            value: text,
            headers: Object.fromEntries(
              Object.entries(headers).map(([k, v]) => [k, Buffer.from(String(v))]),
            ),
          },
        ],
      })
      const r0 = res?.[0]
      return {
        topic: SALE_COMPLETED_EVENTS_TOPIC,
        partition: Number(r0?.partition ?? 0),
        offset: String(r0?.offset ?? '0'),
      }
    },
    async normalize(parsed) {
      return normalizeSaleCompleted(parsed, pool)
    },
    async markPublished(row, ack, owner) {
      const { rows } = await pool.query(
        `SELECT listings.acknowledge_outbox_publish($1::uuid, $2, $3, $4, $5::bigint) AS r`,
        [row.id, owner, ack.topic, ack.partition, Number(ack.offset) || 0],
      )
      const r = rows?.[0]?.r
      if (!r || r.result === 'DENIED' || Number(r.affected_rows || 0) < 1) {
        throw new Error(`OUTBOX_ACK_DENIED:${row.id}:${r?.error_class || 'UNKNOWN'}`)
      }
    },
    async markRetry(row, error, nextAttemptAt, owner) {
      const { rows } = await pool.query(
        `SELECT listings.reschedule_outbox_event($1::uuid, $2, $3, $4::timestamptz) AS r`,
        [row.id, owner, error.slice(0, 2000), nextAttemptAt.toISOString()],
      )
      const r = rows?.[0]?.r
      if (!r || r.result === 'DENIED' || Number(r.affected_rows || 0) < 1) {
        throw new Error(`OUTBOX_RESCHEDULE_DENIED:${row.id}:${r?.error_class || 'UNKNOWN'}`)
      }
    },
    async markDeadLetter(row, error, owner) {
      const { rows } = await pool.query(
        `SELECT listings.dead_letter_outbox_event($1::uuid, $2, $3) AS r`,
        [row.id, owner, error.slice(0, 2000)],
      )
      const r = rows?.[0]?.r
      if (!r || r.result === 'DENIED' || Number(r.affected_rows || 0) < 1) {
        throw new Error(`OUTBOX_DEAD_LETTER_DENIED:${row.id}:${r?.error_class || 'UNKNOWN'}`)
      }
    },
  }
}

export async function drainSaleCompletedOutboxOnce(limit = 25): Promise<DrainResult> {
  return drainSaleCompletedOutboxCore(createPgDeps(), limit)
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
    if (draining) return
    draining = true
    try {
      const r = await drainSaleCompletedOutboxOnce()
      if (r.scanned > 0) {
        console.log(
          `[shopping] SaleCompleted outbox drain scanned=${r.scanned} published=${r.published} normalized=${r.normalized} retried=${r.retried} dlq=${r.dead_lettered} errors=${r.errors.length}`,
        )
        if (r.errors.length) console.warn('[shopping] SaleCompleted outbox drain errors:', r.errors)
      }
    } catch (err: any) {
      console.warn('[shopping] SaleCompleted outbox drain failed:', err?.message || err)
    } finally {
      draining = false
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
