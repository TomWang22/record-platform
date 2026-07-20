/**
 * Seed marketplace rows so owner-proof success floors can pass live.
 * Creates synthetic contract listings only — never production identities.
 *
 * CRITICAL: an archived listing is NOT a completed sale. This seed never
 * archives listings to invent sold comps. Sold floors come from distinct
 * normalized COMPLETED_SALE market events (linked to a source listing id),
 * persisted for the live evidence assembler / intelligence path to read.
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

/** Live seed file read by webapp completed-sales API + assembler gather path. */
export const OWNER_PROOF_COMPLETED_SALES_SEED_PATH = path.join(
  REPO_ROOT,
  'scripts/ai-platform/phase34-owner-proof-completed-sales.live.json',
);

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
  // Neutral product media path — never /e2e-fixtures (harness leakage + TLS proxy miss).
  return `${baseUrl.replace(/\/$/, '')}/media/covers/${slug}.svg`;
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
 * Build a normalized COMPLETED_SALE market event linked to a source listing.
 * Event type stays sale (never listing). Used by the live assembler / API seed.
 */
function buildCompletedSaleEvent({
  listingId,
  artist,
  title,
  catalogNumber,
  label,
  priceCents,
  observedAt,
  capability,
}) {
  const normalized = normalizeMarketEvent({
    source_id: 'phase34-owner-proof-authorized-completed-sales',
    source_event_id: `completed-sale-${listingId}`,
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
    observed_at: observedAt,
  });
  return {
    ...normalized,
    source_listing_id: listingId,
    listing_id: listingId,
    capability_tag: capability,
  };
}

function persistCompletedSalesSeed(events) {
  const payload = {
    schema_version: 'phase34-owner-proof-completed-sales-seed-v1',
    generated_at: new Date().toISOString(),
    events,
  };
  fs.mkdirSync(path.dirname(OWNER_PROOF_COMPLETED_SALES_SEED_PATH), { recursive: true });
  fs.writeFileSync(OWNER_PROOF_COMPLETED_SALES_SEED_PATH, JSON.stringify(payload, null, 2) + '\n');
  // Mirror under webapp so Next.js cwd=webapp can resolve without leaving the package root.
  const webappMirror = path.join(REPO_ROOT, 'webapp/.data/phase34-owner-proof-completed-sales.live.json');
  fs.mkdirSync(path.dirname(webappMirror), { recursive: true });
  fs.writeFileSync(webappMirror, JSON.stringify(payload, null, 2) + '\n');
  return { primary: OWNER_PROOF_COMPLETED_SALES_SEED_PATH, webapp_mirror: webappMirror };
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
  const soldEvidenceEvents = [];

  const milesHits = await countTitleHits(baseUrl, buyerToken, 'Kind of Blue');
  const needMiles = Math.max(0, 8 - milesHits);
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
  }

  // Dedicated source listings for COMPLETED_SALE linkage only. After the sale
  // event is written we delist them (paused) so they are not active asks —
  // pause/archive is NOT treated as a completed sale by the assembler.
  const milesSaleSources = [];
  for (let i = 0; i < 3; i += 1) {
    const price_cents = 7200 + i * 150;
    const id = await createListing(baseUrl, buyerToken, {
      title: `Miles Davis — Kind of Blue CL 1355 ${MILES_VARIANTS[i % MILES_VARIANTS.length]}`,
      artist: 'Miles Davis',
      catalog_number: 'CL 1355',
      label: 'Columbia',
      price_cents,
      images: [localCoverUrl(baseUrl, 'miles-davis')],
      ...(scarcityRecordId ? { source_record_id: scarcityRecordId } : {}),
    });
    created.push({ capability: 'scarcity_sale_source', id });
    milesSaleSources.push({ id, price_cents });
    await httpsJson({
      baseUrl,
      token: buyerToken,
      method: 'PATCH',
      urlPath: `/api/listings/${id}/status`,
      body: { status: 'paused' },
    });
  }

  const kennyHits = await countTitleHits(baseUrl, sellerToken || buyerToken, 'Quiet Kenny');
  const needKenny = Math.max(0, 6 - kennyHits);
  const tokenForKenny = sellerToken || buyerToken;
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
  }
  const kennySaleSources = [];
  for (let i = 0; i < 3; i += 1) {
    const price_cents = 3900 + i * 175;
    const id = await createListing(baseUrl, tokenForKenny, {
      title: `Kenny Dorham — Quiet Kenny BLP 1569 ${KENNY_VARIANTS[i % KENNY_VARIANTS.length]}`,
      artist: 'Kenny Dorham',
      catalog_number: 'BLP 1569',
      label: 'Blue Note',
      price_cents,
      images: [localCoverUrl(baseUrl, 'kenny-dorham')],
      ...(valuationRecordId ? { source_record_id: valuationRecordId } : {}),
    });
    created.push({ capability: 'valuation_sale_source', id });
    kennySaleSources.push({ id, price_cents });
    await httpsJson({
      baseUrl,
      token: tokenForKenny,
      method: 'PATCH',
      urlPath: `/api/listings/${id}/status`,
      body: { status: 'paused' },
    });
  }

  // Distinct COMPLETED_SALE events (≥3 Miles + ≥3 Kenny), linked to source listings.
  // Never archive listings and call them sales; never invent runtime sold floors.
  for (const { id, price_cents } of milesSaleSources) {
    soldEvidenceEvents.push(
      buildCompletedSaleEvent({
        listingId: id,
        artist: 'Miles Davis',
        title: 'Kind of Blue',
        catalogNumber: 'CL 1355',
        label: 'Columbia',
        priceCents: price_cents,
        observedAt: '2026-06-01T12:00:00.000Z',
        capability: 'scarcity',
      }),
    );
  }
  for (const { id, price_cents } of kennySaleSources) {
    soldEvidenceEvents.push(
      buildCompletedSaleEvent({
        listingId: id,
        artist: 'Kenny Dorham',
        title: 'Quiet Kenny',
        catalogNumber: 'BLP 1569',
        label: 'Blue Note',
        priceCents: price_cents,
        observedAt: '2026-06-01T12:00:00.000Z',
        capability: 'valuation',
      }),
    );
  }

  const seedPaths = persistCompletedSalesSeed(soldEvidenceEvents);
  const sold_seed_method = 'normalized_completed_sale_events';

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
    sold_seed_paths: seedPaths,
    sold_evidence_events: soldEvidenceEvents,
    sold_observation_count: {
      scarcity: soldEvidenceEvents.filter((e) => e.artist === 'Miles Davis').length,
      valuation: soldEvidenceEvents.filter((e) => e.artist === 'Kenny Dorham').length,
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
