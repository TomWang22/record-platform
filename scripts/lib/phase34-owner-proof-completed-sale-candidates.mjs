/**
 * Load authorized Phase 34 owner-proof COMPLETED_SALE seed events and project
 * them into scarcity/valuation candidates. Distinct from listings — never
 * treats archived inventory as sold.
 *
 * Phase A: live runtime merge is blocked unless PHASE34_ALLOW_SYNTHETIC_SALES=1
 * or PHASE34_UNIT_TEST_HOOKS=1. Settlement-grade SALE_COMPLETED events come
 * from phase34-sale-completed-store, not this seed path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSyntheticSalesAllowed, syntheticSalesAllowed } from './phase34-synthetic-sales-gate.mjs';
import { listSaleCompletedEvents } from './phase34-sale-completed-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function seedCandidatePaths() {
  const explicit = process.env.PHASE34_COMPLETED_SALES_SEED_PATH;
  return [
    ...(explicit ? [path.resolve(explicit)] : []),
    '/tmp/phase34-owner-proof-completed-sales.live.json',
    path.join(REPO_ROOT, 'scripts/ai-platform/phase34-owner-proof-completed-sales.live.json'),
    path.join(REPO_ROOT, 'webapp/.data/phase34-owner-proof-completed-sales.live.json'),
  ];
}

export function loadOwnerProofCompletedSaleEvents() {
  if (!syntheticSalesAllowed()) {
    return [];
  }
  for (const p of seedCandidatePaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      const events = Array.isArray(parsed) ? parsed : parsed.events;
      if (!Array.isArray(events)) continue;
      return events.filter((e) => String(e?.event_type || '').toUpperCase() === 'COMPLETED_SALE');
    } catch {
      continue;
    }
  }
  return [];
}

function normalizeCatalog(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function eventMatchesSubject(event, subject = {}) {
  const recCat = normalizeCatalog(subject.catalog_number || subject.catalogNumber);
  const evCat = normalizeCatalog(event.catalog_number);
  if (recCat && evCat && recCat === evCat) return true;

  const artist = String(subject.artist || '')
    .trim()
    .toLowerCase();
  const title = String(subject.title || subject.name || '')
    .trim()
    .toLowerCase();
  const hay = [event.artist, event.title, event.label, event.catalog_number]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (artist && title && hay.includes(artist) && hay.includes(title)) return true;
  if (artist && hay.includes(artist) && !title) return true;
  return false;
}

/**
 * Project a COMPLETED_SALE seed event into an engine candidate.
 * Always sale_kind=sold + source_type=sale.
 */
export function completedSaleEventToCandidate(event, subject = {}, index = 0) {
  const price = Number(event.price_normalized ?? event.price_original ?? event.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const listingId = event.source_listing_id || event.listing_id || null;
  const eventId =
    event.market_event_id || event.source_event_id || event.sale_event_id || listingId || `completed-sale-${index}`;
  const currency = event.currency_normalized || event.currency_original || event.currency || 'USD';
  const title = event.title || subject.title || subject.name || 'comparable';
  const eventType = String(event.event_type || 'COMPLETED_SALE').toUpperCase();
  return {
    evidence_id: `sale:${eventId}`,
    source_id: String(listingId || eventId),
    source_type: 'sale',
    sale_kind: 'sold',
    event_type: eventType,
    price,
    currency,
    freshness_status: 'fresh',
    observed_at: event.sold_at || event.observed_at || null,
    pressing_id: subject.pressing_id || null,
    release_id: subject.release_id || null,
    condition: event.media_condition || event.condition || null,
    reason_codes: ['EXACT_PRESSING_MATCH', 'AUTHORIZED_MARKET', 'RECENT_SALE'],
    authorization_scope: event.authorization_scope || 'authenticated_market',
    summary: `Sold ${title} for ${price} ${currency}`,
  };
}

function mergeSettlementSaleCompletedCandidates(input = {}) {
  const subject = input.subject || {};
  const existing = Array.isArray(input.candidates) ? [...input.candidates] : [];
  const seen = new Set(existing.map((c) => c.evidence_id).filter(Boolean));
  const events = listSaleCompletedEvents().filter((e) => eventMatchesSubject(e, subject));
  let added = 0;
  for (let i = 0; i < events.length; i += 1) {
    const candidate = completedSaleEventToCandidate(events[i], subject, i);
    if (!candidate || seen.has(candidate.evidence_id)) continue;
    seen.add(candidate.evidence_id);
    existing.push(candidate);
    added += 1;
  }
  return {
    ...input,
    candidates: existing,
    _sale_completed_settlement_merged: added,
  };
}

/**
 * Merge matching authorized COMPLETED_SALE seed events into request candidates.
 * Live runtime: seed merge is blocked; only settlement SALE_COMPLETED merges.
 */
export function mergeOwnerProofCompletedSaleCandidates(input = {}) {
  const withSettlement = mergeSettlementSaleCompletedCandidates(input);

  if (!syntheticSalesAllowed()) {
    return {
      ...withSettlement,
      _completed_sale_seed_merged: 0,
      _completed_sale_seed_blocked: true,
    };
  }

  assertSyntheticSalesAllowed('mergeOwnerProofCompletedSaleCandidates');

  const subject = withSettlement.subject || {};
  const existing = Array.isArray(withSettlement.candidates) ? [...withSettlement.candidates] : [];
  const seen = new Set(existing.map((c) => c.evidence_id).filter(Boolean));
  const events = loadOwnerProofCompletedSaleEvents().filter((e) => eventMatchesSubject(e, subject));
  let added = 0;
  for (let i = 0; i < events.length; i += 1) {
    const candidate = completedSaleEventToCandidate(events[i], subject, i);
    if (!candidate || seen.has(candidate.evidence_id)) continue;
    seen.add(candidate.evidence_id);
    existing.push(candidate);
    added += 1;
  }
  return {
    ...withSettlement,
    candidates: existing,
    _completed_sale_seed_merged: added,
  };
}
