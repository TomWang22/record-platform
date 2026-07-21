/**
 * In-process + file-backed immutable SALE_COMPLETED evidence store (Phase A).
 * Production path persists via listings.sale_completed_events (see migration 49).
 * This module backs unit tests and local runtime without requiring DB.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSaleCompletedEvent, isSettlementSaleCompleted } from './phase34-sale-completed-emitter.mjs';
import { buildEvidenceSnapshot } from './phase34-evidence-snapshot.mjs';

const memory = [];

function defaultStorePath() {
  return (
    process.env.PHASE34_SALE_COMPLETED_STORE_PATH ||
    '/tmp/phase34-sale-completed-events.json'
  );
}

function stableHash(event) {
  return crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

export function resetSaleCompletedStoreForTests() {
  memory.length = 0;
  try {
    const p = defaultStorePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

export function listSaleCompletedEvents({ listingId = null, storePath = null } = {}) {
  const fromMemory = memory.filter((e) => isSettlementSaleCompleted(e));
  let fromDisk = [];
  try {
    const p = storePath || defaultStorePath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      const events = Array.isArray(parsed) ? parsed : parsed.events;
      if (Array.isArray(events)) fromDisk = events.filter((e) => isSettlementSaleCompleted(e));
    }
  } catch {
    fromDisk = [];
  }
  const byId = new Map();
  for (const e of [...fromDisk, ...fromMemory]) {
    byId.set(e.sale_event_id || e.market_event_id, e);
  }
  let out = [...byId.values()];
  if (listingId) {
    out = out.filter(
      (e) => String(e.source_listing_id || e.listing_id) === String(listingId),
    );
  }
  return out;
}

/**
 * Persist a settlement-grade SALE_COMPLETED event with an immutable evidence snapshot.
 */
export function persistSaleCompletedEvent(input = {}, { storePath = null } = {}) {
  const event = buildSaleCompletedEvent(input);
  const snapshot = buildEvidenceSnapshot({
    capability: 'sale_completed',
    subject: {
      listing_id: event.source_listing_id || event.listing_id,
      artist: event.artist,
      title: event.title,
      catalog_number: event.catalog_number,
    },
    evidence_items: [
      {
        evidence_id: `sale:${event.sale_event_id}`,
        event_type: event.event_type,
        sale_kind: 'sold',
        source_type: 'sale',
        price: event.price_normalized,
        currency: event.currency_normalized,
        included: true,
      },
    ],
    sold_comparables: [
      {
        evidence_id: `sale:${event.sale_event_id}`,
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
        price: event.price_normalized,
        currency: event.currency_normalized,
      },
    ],
    created_at: event.sold_at || event.observed_at,
  });

  const record = Object.freeze({
    ...event,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    evidence_snapshot_hash: snapshot.evidence_snapshot_hash,
    payload_hash: stableHash(event),
    immutable: true,
  });

  memory.push(record);

  const target = storePath || defaultStorePath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existing = listSaleCompletedEvents({ storePath: target }).filter(
      (e) => (e.sale_event_id || e.market_event_id) !== (record.sale_event_id || record.market_event_id),
    );
    const uniq = new Map();
    for (const e of [...existing, record]) {
      uniq.set(e.sale_event_id || e.market_event_id, e);
    }
    fs.writeFileSync(
      target,
      JSON.stringify({ events: [...uniq.values()], written_at: new Date().toISOString() }, null, 2) +
        '\n',
    );
  } catch {
    // memory-only fallback is acceptable for unit tests
  }

  return record;
}
