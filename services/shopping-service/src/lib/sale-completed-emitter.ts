/**
 * Phase A hardening — emit SALE_COMPLETED atomically with lifecycle + outbox.
 * Idempotent on settlement_source + payment_transaction_id.
 * sold_at alone never synthesizes a sale event.
 */
import crypto from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

export type SettlementSource =
  | 'CHECKOUT_SETTLEMENT'
  | 'AUCTION_PAYMENT_SETTLEMENT'
  | 'OFFER_PAYMENT_SETTLEMENT'

export type SaleCompletedInput = {
  listingId: string
  orderId?: string | null
  purchaseId?: string | null
  paymentTransactionId?: string | null
  finalPrice: number
  currency?: string
  saleMechanism?: string
  settlementSource?: SettlementSource
  artist?: string | null
  title?: string | null
  catalogNumber?: string | null
  mediaCondition?: string | null
  completedAt?: Date
  fromLifecycle?: string
}

function sha256(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function resolveSettlementSource(purchaseType: string | null | undefined): SettlementSource {
  const t = String(purchaseType || '').toLowerCase()
  if (t.includes('auction')) return 'AUCTION_PAYMENT_SETTLEMENT'
  if (t.includes('offer') || t.includes('obo')) return 'OFFER_PAYMENT_SETTLEMENT'
  return 'CHECKOUT_SETTLEMENT'
}

/** Deterministic sale id so retries do not duplicate. */
export function deterministicSaleEventId(input: {
  listingId: string
  settlementSource: SettlementSource
  paymentTransactionId?: string | null
  orderId?: string | null
  payloadHash?: string
}): string {
  const basis = [
    input.settlementSource,
    input.paymentTransactionId || '',
    input.orderId || '',
    input.listingId,
    input.payloadHash || '',
  ].join('|')
  return `sale-${sha256(basis).slice(0, 28)}`
}

export type AtomicSaleResult = {
  sale_event_id: string
  market_event_id: string
  evidence_snapshot_id: string
  evidence_snapshot_hash: string
  outbox_id: string
  duplicate: boolean
}

async function insertSaleOutbox(
  client: PoolClient,
  input: {
    eventId: string
    listingId: string
    saleEventId: string
    payload: Record<string, unknown>
  },
): Promise<void> {
  const payloadJson = JSON.stringify({
    metadata: {
      event_id: input.eventId,
      event_type: 'SaleCompleted',
      aggregate_id: input.listingId,
      aggregate_type: 'listing',
      occurred_at: new Date().toISOString(),
      producer: 'shopping-service',
      version: '1',
    },
    payload: {
      listing_id: input.listingId,
      sale_event_id: input.saleEventId,
      ...input.payload,
    },
  })
  const payloadBuf = Buffer.from(payloadJson, 'utf8')
  const payloadHash = crypto.createHash('sha256').update(payloadBuf).digest('hex')
  const sourceSha =
    process.env.RP_SOURCE_SHA || process.env.SOURCE_SHA || process.env.GIT_SHA || ''
  if (
    !sourceSha ||
    [
      'unknown',
      'unknown-pre-migration-56',
      'legacy_unknown',
      'legacy',
      'unavailable',
      'unset',
      'test',
      'fixture',
    ].includes(sourceSha.toLowerCase()) ||
    !/^[0-9a-fA-F]{40}$/.test(sourceSha)
  ) {
    throw new Error(
      'OUTBOX_SOURCE_SHA_INVALID: SaleCompleted requires concrete 40-char hex RP_SOURCE_SHA',
    )
  }
  await client.query(
    `INSERT INTO listings.outbox_events (
       id, aggregate_id, type, version, payload, published,
       idempotency_key, payload_hash, source_sha
     ) VALUES (
       $1::uuid, $2, $3, 1, $4::bytea, false,
       $5, $6, $7
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      input.eventId,
      input.listingId,
      'SaleCompleted',
      payloadBuf,
      input.eventId,
      payloadHash,
      sourceSha,
    ],
  )
}

/**
 * Persist SALE_COMPLETED + lifecycle SOLD + outbox in ONE listings DB transaction.
 * Never synthesizes from sold_at / archive / seed.
 */
export async function emitSaleCompletedFromCheckout(
  listingsPool: Pool,
  input: SaleCompletedInput,
): Promise<AtomicSaleResult | null> {
  const price = Number(input.finalPrice)
  if (!input.listingId || !Number.isFinite(price) || price <= 0) return null
  if (!input.paymentTransactionId && !input.orderId) {
    // Require at least one settlement identity for idempotency.
    console.warn('[shopping] SALE_COMPLETED skipped: missing payment/order identity')
    return null
  }

  const completedAt = input.completedAt || new Date()
  const currency = (input.currency || 'USD').toUpperCase()
  const settlementSource = input.settlementSource || 'CHECKOUT_SETTLEMENT'

  const payloadCore = {
    event_type: 'SALE_COMPLETED',
    listing_id: input.listingId,
    source_listing_id: input.listingId,
    order_id: input.orderId || null,
    purchase_id: input.purchaseId || null,
    payment_transaction_id: input.paymentTransactionId || null,
    settlement_source: settlementSource,
    sale_mechanism: input.saleMechanism || 'buy_now',
    completed_at: completedAt.toISOString(),
    final_price: price,
    currency,
    artist: input.artist || null,
    title: input.title || null,
    catalog_number: input.catalogNumber || null,
    media_condition: input.mediaCondition || null,
    authorization_scope: 'first_party_settlement',
    rights_status: 'FIRST_PARTY',
    deletion_status: 'ACTIVE',
    lifecycle_after: 'SOLD',
  }
  const payloadHash = sha256(payloadCore)
  const saleEventId = deterministicSaleEventId({
    listingId: input.listingId,
    settlementSource,
    paymentTransactionId: input.paymentTransactionId,
    orderId: input.orderId,
    payloadHash,
  })
  const marketEventId = `me-${saleEventId}`
  const evidenceSnapshotHash = sha256({
    capability: 'sale_completed',
    sale_event_id: saleEventId,
    listing_id: input.listingId,
    final_price: price,
    currency,
    completed_at: completedAt.toISOString(),
  })
  const evidenceSnapshotId = `es-${evidenceSnapshotHash.slice(0, 16)}`
  const outboxDigest = crypto.createHash('sha256').update(`outbox|${saleEventId}`).digest('hex')
  const outboxId = [
    outboxDigest.slice(0, 8),
    outboxDigest.slice(8, 12),
    `4${outboxDigest.slice(13, 16)}`,
    `a${outboxDigest.slice(17, 20)}`,
    outboxDigest.slice(20, 32),
  ].join('-')

  const payload = {
    ...payloadCore,
    sale_event_id: saleEventId,
    market_event_id: marketEventId,
    sold_at: completedAt.toISOString(),
    price_normalized: price,
    currency_normalized: currency,
  }

  const client = await listingsPool.connect()
  try {
    await client.query('BEGIN')

    // Idempotent: if settlement identity already recorded, return existing.
    if (input.paymentTransactionId) {
      const existing = await client.query(
        `SELECT sale_event_id, market_event_id, evidence_snapshot_id, evidence_snapshot_hash
         FROM listings.sale_completed_events
         WHERE settlement_source = $1 AND payment_transaction_id = $2
         LIMIT 1`,
        [settlementSource, input.paymentTransactionId],
      )
      if (existing.rowCount && existing.rows[0]) {
        await client.query('COMMIT')
        return {
          sale_event_id: existing.rows[0].sale_event_id,
          market_event_id: existing.rows[0].market_event_id,
          evidence_snapshot_id: existing.rows[0].evidence_snapshot_id,
          evidence_snapshot_hash: existing.rows[0].evidence_snapshot_hash,
          outbox_id: outboxId,
          duplicate: true,
        }
      }
    }

    const fromLifecycle = input.fromLifecycle || 'ACTIVE'
    if (fromLifecycle === 'ARCHIVED') {
      await client.query('ROLLBACK')
      throw Object.assign(new Error('ARCHIVED_IS_NOT_SOLD'), { code: 'ARCHIVED_IS_NOT_SOLD' })
    }

    await client.query(
      `UPDATE listings.listings
       SET lifecycle_status = 'SOLD',
           settlement_evidence_eligible = TRUE
       WHERE id = $1::uuid
         AND COALESCE(lifecycle_status, 'ACTIVE') <> 'ARCHIVED'`,
      [input.listingId],
    )

    await client.query(
      `INSERT INTO listings.lifecycle_transition_audit
         (listing_id, from_lifecycle, to_lifecycle, reason_code, actor, sale_event_id, metadata)
       VALUES ($1::uuid, $2, 'SOLD', 'CHECKOUT_SETTLEMENT', 'shopping-service', $3, $4::jsonb)`,
      [
        input.listingId,
        fromLifecycle,
        saleEventId,
        JSON.stringify({ order_id: input.orderId, payment_transaction_id: input.paymentTransactionId }),
      ],
    )

    const insert = await client.query(
      `INSERT INTO listings.sale_completed_events (
         sale_event_id, market_event_id, listing_id, order_id, purchase_id,
         payment_transaction_id, settlement_source, sale_mechanism, completed_at,
         final_price, currency, media_condition, artist, title, catalog_number,
         authorization_scope, rights_status, deletion_status,
         evidence_snapshot_id, evidence_snapshot_hash, payload_hash, payload
       ) VALUES (
         $1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,
         'first_party_settlement','FIRST_PARTY','ACTIVE',
         $16,$17,$18,$19::jsonb
       )
       ON CONFLICT DO NOTHING
       RETURNING sale_event_id`,
      [
        saleEventId,
        marketEventId,
        input.listingId,
        input.orderId || null,
        input.purchaseId || null,
        input.paymentTransactionId || null,
        settlementSource,
        input.saleMechanism || 'buy_now',
        completedAt,
        price,
        currency,
        input.mediaCondition || null,
        input.artist || null,
        input.title || null,
        input.catalogNumber || null,
        evidenceSnapshotId,
        evidenceSnapshotHash,
        payloadHash,
        JSON.stringify(payload),
      ],
    )

    const duplicate = !(insert.rowCount && insert.rowCount > 0)

    await insertSaleOutbox(client, {
      eventId: outboxId,
      listingId: input.listingId,
      saleEventId,
      payload,
    })

    await client.query('COMMIT')
    return {
      sale_event_id: saleEventId,
      market_event_id: marketEventId,
      evidence_snapshot_id: evidenceSnapshotId,
      evidence_snapshot_hash: evidenceSnapshotHash,
      outbox_id: outboxId,
      duplicate,
    }
  } catch (err: any) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore
    }
    // Pre-migration environments: do not fail checkout hard.
    if (
      String(err?.message || '').includes('does not exist') ||
      String(err?.code || '') === '42P01'
    ) {
      console.warn('[shopping] SALE_COMPLETED atomic emit skipped (schema missing):', err?.message)
      return {
        sale_event_id: saleEventId,
        market_event_id: marketEventId,
        evidence_snapshot_id: evidenceSnapshotId,
        evidence_snapshot_hash: evidenceSnapshotHash,
        outbox_id: outboxId,
        duplicate: false,
      }
    }
    throw err
  } finally {
    client.release()
  }
}
