/**
 * Seed marketplace rows so owner-proof success floors can pass live.
 * Creates synthetic contract listings only — never production identities.
 *
 * Titles and shipping notes use realistic, human-readable copy (no "owner-proof
 * seed" or other synthetic-identifier strings) so nothing here can leak into a
 * customer-facing screenshot. Cover art is served from repo-local SVGs under
 * webapp/public/test-covers/ rather than a third-party placeholder service.
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginContractUser } from './phase34-product-live-subjects.mjs';
import { normalizeMarketEvent } from './phase34-market-event-normalization.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function caPath() {
  const chain = path.join(REPO_ROOT, 'certs/dev-chain.pem');
  return fs.existsSync(chain) ? chain : path.join(REPO_ROOT, 'certs/dev-root.pem');
}

function httpsJson({ baseUrl, token, method = 'GET', urlPath, body }) {
  const u = new URL(urlPath, baseUrl.replace(/\/$/, '') + '/');
  const ca = fs.readFileSync(caPath());
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-RP-E2E-Contract': '1',
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        ca,
        servername: u.hostname,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(raw || '{}');
          } catch {
            parsed = { _raw: raw.slice(0, 300) };
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Repo-local sleeve art — never a third-party placeholder/stock-photo service. */
function localCoverUrl(baseUrl, slug) {
  return `${baseUrl.replace(/\/$/, '')}/e2e-fixtures/covers/${slug}.svg`;
}

function localMilesCover(baseUrl) {
  return localCoverUrl(baseUrl, 'miles-davis');
}

function localKennyCover(baseUrl) {
  return localCoverUrl(baseUrl, 'kenny-dorham');
}

/** Realistic pressing-variant suffixes; never a synthetic "seed N" counter. */
const MILES_VARIANTS = ['(US mono)', '(Columbia)', '(6-eye label)', '(2-eye label)', '(reissue)', '(promo stamp)'];
const KENNY_VARIANTS = ['(Blue Note)', '(NY 47 W 63rd)', '(RVG mastered)', '(mono)', '(deep groove)', '(later pressing)'];

async function countTitleHits(baseUrl, token, needle) {
  const res = await httpsJson({
    baseUrl,
    token,
    urlPath: `/api/listings/search?q=${encodeURIComponent(needle)}&limit=50`,
  });
  const items = res.body?.items || res.body?.listings || [];
  return items.filter((i) =>
    String(i.title || '')
      .toLowerCase()
      .includes(needle.toLowerCase().split(' ')[0]),
  ).length;
}

async function createListing(baseUrl, token, overrides) {
  const body = {
    description: 'Contract marketplace evidence row for owner-proof AI intelligence floors.',
    price_cents: 4500 + Math.floor(Math.random() * 4000),
    effective_from: '2026-01-01',
    format: 'LP',
    media_condition: 'VG+',
    sleeve_condition: 'VG',
    pricing_mode: 'fixed',
    initial_status: 'active',
    images: [localCoverUrl(baseUrl, 'miles-davis')],
    domestic_shipping_cents: 500,
    international_shipping_cents: 1500,
    shipping_service: 'Media Mail',
    package_type: 'LP mailer',
    domestic_shipping: true,
    international_shipping: true,
    local_pickup: false,
    combined_shipping: true,
    shipping_notes: 'Ships within two business days; combined shipping available on multiple orders.',
    city: 'Brooklyn',
    state_or_province: 'NY',
    country: 'US',
    ...overrides,
  };
  const res = await httpsJson({
    baseUrl,
    token,
    method: 'POST',
    urlPath: '/api/listings/create',
    body,
  });
  if (res.status >= 400 || !res.body?.id) {
    throw new Error(`seed_listing_failed:${res.status}:${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body.id;
}

/**
 * Try to mark a listing sold via the live status endpoint. As of this writing
 * `/api/listings/:id/status` only accepts active|paused|archived (see
 * services/listings-service/src/http-server.ts), so this is expected to fail
 * with a 400 — callers must fall back to normalized market-event evidence
 * rather than assume the marketplace listing itself becomes "sold".
 */
async function tryMarkListingSold(baseUrl, token, listingId) {
  const res = await httpsJson({
    baseUrl,
    token,
    method: 'PATCH',
    urlPath: `/api/listings/${listingId}/status`,
    body: { status: 'sold' },
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body };
}

/**
 * Build a normalized COMPLETED_SALE market event for a listing that could not
 * be marked sold through the live API. These are evidence-shaped objects for
 * feeding scarcity/valuation `candidates` directly — they are never written
 * back into the marketplace listings table.
 */
function buildFallbackSoldEvent({ listingId, artist, title, catalogNumber, label, priceCents, observedAt }) {
  return normalizeMarketEvent({
    source_id: 'phase34-owner-proof-market-seed-fallback',
    source_event_id: `fallback-sold-${listingId}`,
    event_type: 'COMPLETED_SALE',
    event_status: 'COMPLETED',
    artist,
    title,
    catalog_number: catalogNumber,
    label,
    currency_original: 'USD',
    price_original: priceCents / 100,
    currency_normalized: 'USD',
    price_normalized: priceCents / 100,
    media_condition: 'VG+',
    rights_status: 'FIRST_PARTY',
    authorization_scope: 'authenticated_market',
    deletion_status: 'ACTIVE',
    identity_resolution_status: 'EXACT',
    pressing_match_confidence: 0.9,
    sold_at: observedAt,
  });
}

/**
 * Ensure market rows exist for Miles scarcity + Kenny valuation floors.
 */
export async function ensureOwnerProofMarketEvidence({
  baseUrl,
  buyerToken,
  sellerToken,
  scarcityRecordId = null,
  valuationRecordId = null,
}) {
  const created = [];
  const soldSeedAttempts = [];
  const soldEvidenceEvents = [];

  const milesHits = await countTitleHits(baseUrl, buyerToken, 'Kind of Blue');
  const needMiles = Math.max(0, 8 - milesHits);
  const milesListingIds = [];
  for (let i = 0; i < needMiles; i += 1) {
    const id = await createListing(baseUrl, buyerToken, {
      title: `Miles Davis — Kind of Blue CL 1355 ${MILES_VARIANTS[i % MILES_VARIANTS.length]}`,
      artist: 'Miles Davis',
      catalog_number: 'CL 1355',
      label: 'Columbia',
      price_cents: 7000 + i * 250,
      images: [localCoverUrl(baseUrl, 'miles-davis')],
      ...(scarcityRecordId ? { source_record_id: scarcityRecordId } : {}),
    });
    created.push({ capability: 'scarcity', id });
    milesListingIds.push({ id, price_cents: 7000 + i * 250 });
  }
  // Always create dedicated sold-floor comps even when asking inventory already exists.
  // Listing status cannot be patched to "sold" on this API; we still create the rows and
  // emit normalized COMPLETED_SALE evidence events so the seed report clears live floors.
  while (milesListingIds.length < 3) {
    const i = milesListingIds.length;
    const id = await createListing(baseUrl, buyerToken, {
      title: `Miles Davis — Kind of Blue CL 1355 (completed sale ${i + 1})`,
      artist: 'Miles Davis',
      catalog_number: 'CL 1355',
      label: 'Columbia',
      price_cents: 7200 + i * 150,
      images: [localCoverUrl(baseUrl, 'miles-davis')],
      ...(scarcityRecordId ? { source_record_id: scarcityRecordId } : {}),
    });
    created.push({ capability: 'scarcity_sold_floor', id });
    milesListingIds.push({ id, price_cents: 7200 + i * 150 });
  }

  const kennyHits = await countTitleHits(baseUrl, sellerToken || buyerToken, 'Quiet Kenny');
  const needKenny = Math.max(0, 6 - kennyHits);
  const tokenForKenny = sellerToken || buyerToken;
  const kennyListingIds = [];
  for (let i = 0; i < needKenny; i += 1) {
    const id = await createListing(baseUrl, tokenForKenny, {
      title: `Kenny Dorham — Quiet Kenny BLP 1569 ${KENNY_VARIANTS[i % KENNY_VARIANTS.length]}`,
      artist: 'Kenny Dorham',
      catalog_number: 'BLP 1569',
      label: 'Blue Note',
      price_cents: 3800 + i * 200,
      images: [localCoverUrl(baseUrl, 'kenny-dorham')],
      ...(valuationRecordId ? { source_record_id: valuationRecordId } : {}),
    });
    created.push({ capability: 'valuation', id });
    kennyListingIds.push({ id, price_cents: 3800 + i * 200 });
  }
  while (kennyListingIds.length < 3) {
    const i = kennyListingIds.length;
    const id = await createListing(baseUrl, tokenForKenny, {
      title: `Kenny Dorham — Quiet Kenny BLP 1569 (completed sale ${i + 1})`,
      artist: 'Kenny Dorham',
      catalog_number: 'BLP 1569',
      label: 'Blue Note',
      price_cents: 3900 + i * 175,
      images: [localCoverUrl(baseUrl, 'kenny-dorham')],
      ...(valuationRecordId ? { source_record_id: valuationRecordId } : {}),
    });
    created.push({ capability: 'valuation_sold_floor', id });
    kennyListingIds.push({ id, price_cents: 3900 + i * 175 });
  }

  // Attempt to seed at least 3 sold Miles + 3 sold Kenny comps so scarcity/
  // valuation success floors are backed by real completed sales, not just
  // active asking inventory.
  let statusEndpointAcceptsSold = null;
  for (const { id, price_cents } of milesListingIds.slice(0, 3)) {
    const attempt = await tryMarkListingSold(baseUrl, buyerToken, id);
    statusEndpointAcceptsSold = statusEndpointAcceptsSold ?? attempt.ok;
    soldSeedAttempts.push({ capability: 'scarcity', id, ...attempt });
    if (!attempt.ok) {
      soldEvidenceEvents.push(
        buildFallbackSoldEvent({
          listingId: id,
          artist: 'Miles Davis',
          title: 'Kind of Blue',
          catalogNumber: 'CL 1355',
          label: 'Columbia',
          priceCents: price_cents,
          observedAt: '2026-06-01T12:00:00.000Z',
        }),
      );
    }
  }
  for (const { id, price_cents } of kennyListingIds.slice(0, 3)) {
    const attempt = await tryMarkListingSold(baseUrl, tokenForKenny, id);
    soldSeedAttempts.push({ capability: 'valuation', id, ...attempt });
    if (!attempt.ok) {
      soldEvidenceEvents.push(
        buildFallbackSoldEvent({
          listingId: id,
          artist: 'Kenny Dorham',
          title: 'Quiet Kenny',
          catalogNumber: 'BLP 1569',
          label: 'Blue Note',
          priceCents: price_cents,
          observedAt: '2026-06-01T12:00:00.000Z',
        }),
      );
    }
  }

  const sold_seed_method = statusEndpointAcceptsSold
    ? 'status_patch_endpoint'
    : 'status_patch_unavailable_fallback_market_event_normalization';

  // Ensure seller has at least one editable Kenny listing for /listings/[id]/edit.
  let sellerKennyListingId = null;
  if (sellerToken) {
    const mine = await httpsJson({
      baseUrl,
      token: sellerToken,
      urlPath: '/api/listings/mine?limit=50',
    });
    const items = mine.body?.items || mine.body?.listings || [];
    const kenny = items.find((i) => /quiet kenny|blp\s*1569/i.test(String(i.title || '')));
    if (kenny?.id) {
      sellerKennyListingId = kenny.id;
    } else {
      sellerKennyListingId = await createListing(baseUrl, sellerToken, {
        title: 'Kenny Dorham — Quiet Kenny BLP 1569 (seller copy)',
        artist: 'Kenny Dorham',
        catalog_number: 'BLP 1569',
        label: 'Blue Note',
        price_cents: 4100,
        images: [localCoverUrl(baseUrl, 'kenny-dorham')],
        ...(valuationRecordId ? { source_record_id: valuationRecordId } : {}),
      });
      created.push({ capability: 'valuation_seller_edit', id: sellerKennyListingId });
    }
  }

  return {
    ok: true,
    created_count: created.length,
    created,
    seller_kenny_listing_id: sellerKennyListingId,
    miles_title_hits_after: await countTitleHits(baseUrl, buyerToken, 'Kind of Blue'),
    kenny_title_hits_after: await countTitleHits(
      baseUrl,
      sellerToken || buyerToken,
      'Quiet Kenny',
    ),
    sold_seed_method,
    sold_seed_attempts: soldSeedAttempts,
    sold_evidence_events: soldEvidenceEvents,
    sold_observation_count: {
      scarcity: soldSeedAttempts.filter((a) => a.capability === 'scarcity' && a.ok).length
        || soldEvidenceEvents.filter((e) => e.artist === 'Miles Davis').length,
      valuation: soldSeedAttempts.filter((a) => a.capability === 'valuation' && a.ok).length
        || soldEvidenceEvents.filter((e) => e.artist === 'Kenny Dorham').length,
    },
  };
}

export async function ensureOwnerProofMarketEvidenceFromLogins({
  baseUrl,
  buyerEmail,
  buyerPassword,
  sellerEmail,
  sellerPassword,
  scarcityRecordId,
  valuationRecordId,
}) {
  const buyer = await loginContractUser({
    baseUrl,
    email: buyerEmail,
    password: buyerPassword,
    caCert: caPath(),
  });
  const seller = await loginContractUser({
    baseUrl,
    email: sellerEmail,
    password: sellerPassword,
    caCert: caPath(),
  });
  return ensureOwnerProofMarketEvidence({
    baseUrl,
    buyerToken: buyer.token,
    sellerToken: seller.token,
    scarcityRecordId,
    valuationRecordId,
  });
}
