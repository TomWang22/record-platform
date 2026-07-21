/**
 * Phase A — emit SALE_COMPLETED from checkout settlement.
 * Writes listings.sale_completed_events when available, and updates lifecycle_status.
 */
import crypto from 'node:crypto'
import type { Pool } from 'pg'

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

/**
 * Persist SALE_COMPLETED + set listings.lifecycle_status = SOLD.
 * Never emits for archived-only transitions (caller must pass post-checkout sold listing).
 */
export async function emitSaleCompletedFromCheckout(
  listingsPool: Pool,
  input: SaleCompletedInput,
): Promise<{ sale_event_id: string; evidence_snapshot_hash: string } | null> {
  const price = Number(input.finalPrice)
  if (!input.listingId || !Number.isFinite(price) || price <= 0) return null

  const completedAt = input.completedAt || new Date()
  const saleEventId = `sale-${input.listingId}-${crypto.randomBytes(6).toString('hex')}`
  const marketEventId = `me-${saleEventId}`
  const currency = (input.currency || 'USD').toUpperCase()
  const settlementSource = input.settlementSource || 'CHECKOUT_SETTLEMENT'
  const payload = {
    event_type: 'SALE_COMPLETED',
    sale_event_id: saleEventId,
    market_event_id: marketEventId,
    listing_id: input.listingId,
    source_listing_id: input.listingId,
    order_id: input.orderId || null,
    purchase_id: input.purchaseId || null,
    payment_transaction_id: input.paymentTransactionId || null,
    settlement_source: settlementSource,
    sale_mechanism: input.saleMechanism || 'buy_now',
    completed_at: completedAt.toISOString(),
    sold_at: completedAt.toISOString(),
    final_price: price,
    price_normalized: price,
    currency_normalized: currency,
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
  const payloadHash = sha256(payload)
  const evidenceSnapshotHash = sha256({
    capability: 'sale_completed',
    sale_event_id: saleEventId,
    listing_id: input.listingId,
    final_price: price,
    currency,
    completed_at: completedAt.toISOString(),
  })
  const evidenceSnapshotId = `es-${evidenceSnapshotHash.slice(0, 16)}`

  try {
    await listingsPool.query(
      `UPDATE listings.listings
       SET lifecycle_status = 'SOLD'
       WHERE id = $1::uuid
         AND COALESCE(lifecycle_status, 'ACTIVE') <> 'ARCHIVED'`,
      [input.listingId],
    )
  } catch (err: any) {
    // Column may not exist until migration 49 is applied.
    if (!String(err?.message || '').includes('lifecycle_status')) {
      console.warn('[shopping] lifecycle_status update skipped:', err?.message)
    }
  }

  try {
    await listingsPool.query(
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
       ON CONFLICT (sale_event_id) DO NOTHING`,
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
  } catch (err: any) {
    // Table may not exist until migration 49 — do not fail checkout.
    console.warn('[shopping] sale_completed_events insert skipped:', err?.message)
    return { sale_event_id: saleEventId, evidence_snapshot_hash: evidenceSnapshotHash }
  }

  return { sale_event_id: saleEventId, evidence_snapshot_hash: evidenceSnapshotHash }
}
