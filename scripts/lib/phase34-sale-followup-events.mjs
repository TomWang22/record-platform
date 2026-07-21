/**
 * Settlement follow-up events (A1/A7): refunds, reversals, chargebacks,
 * auction non-payment, corrections — never mutate SALE_COMPLETED.
 */
import crypto from 'node:crypto';
import { SALE_COMPLETED_EVENT_TYPE } from './phase34-sale-completed-emitter.mjs';

export const SALE_FOLLOWUP_EVENT_TYPES = Object.freeze([
  'SALE_REFUNDED',
  'SALE_REVERSED',
  'PAYMENT_CHARGEBACK',
  'AUCTION_NON_PAYMENT',
  'SALE_CORRECTION_RECORDED',
]);

export function buildSaleFollowupEvent({
  relatedSaleEvent,
  eventType,
  occurredAt = null,
  amount = null,
  currency = null,
  reasonCode = null,
  payloadExtra = {},
} = {}) {
  const type = String(eventType || '');
  if (!SALE_FOLLOWUP_EVENT_TYPES.includes(type)) {
    const err = new Error(`SALE_FOLLOWUP_INVALID_TYPE:${type}`);
    err.code = 'SALE_FOLLOWUP_INVALID_TYPE';
    throw err;
  }
  if (!relatedSaleEvent || relatedSaleEvent.event_type !== SALE_COMPLETED_EVENT_TYPE) {
    const err = new Error('SALE_FOLLOWUP_REQUIRES_SALE_COMPLETED');
    err.code = 'SALE_FOLLOWUP_REQUIRES_SALE_COMPLETED';
    throw err;
  }
  const relatedId = relatedSaleEvent.sale_event_id;
  const followupEventId = `followup-${relatedId}-${type.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
  const occurred = occurredAt || new Date().toISOString();
  const payload = {
    event_type: type,
    followup_event_id: followupEventId,
    related_sale_event_id: relatedId,
    listing_id: relatedSaleEvent.listing_id || relatedSaleEvent.source_listing_id,
    occurred_at: occurred,
    amount,
    currency: currency || relatedSaleEvent.currency_normalized || relatedSaleEvent.currency,
    reason_code: reasonCode,
    original_sale_immutable: true,
    ...payloadExtra,
  };
  const payload_hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return Object.freeze({
    followup_event_id: followupEventId,
    market_event_id: `me-${followupEventId}`,
    related_sale_event_id: relatedId,
    listing_id: payload.listing_id,
    event_type: type,
    occurred_at: occurred,
    amount,
    currency: payload.currency,
    reason_code: reasonCode,
    payload_hash,
    payload,
    immutable: true,
  });
}
