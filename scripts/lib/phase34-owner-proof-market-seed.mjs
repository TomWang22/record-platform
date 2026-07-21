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
 * webapp/public/album-sleeves/ (webapp catch-all — never /media/, which the
 * gateway proxies to media-service).
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
function localCoverUrl(_baseUrl, slug) {
  // Path-only URL so the browser loads through the TLS proxy origin
  // (127.0.0.1:<proxy>). Absolute https://record-platform.test/... bypasses
  // the proxy, trips ERR_CERT_AUTHORITY_INVALID, and fails the journey.
  return `/album-sleeves/${slug}.svg`;
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

async function rewriteAbsoluteAlbumSleeveUrls(baseUrl, token) {
  const mine = await httpsJson({
    baseUrl,
    token,
    urlPath: '/api/listings/mine?limit=100',
  });
  const items = mine.body?.items || mine.body?.listings || [];
  let rewritten = 0;
  for (const item of items) {
    const images = Array.isArray(item.images) ? item.images.map(String) : [];
    if (!images.some((u) => /https?:\/\/[^/]+\/album-sleeves\//i.test(u))) continue;
    const next = images.map((u) => {
      const m = String(u).match(/\/album-sleeves\/([^/?#]+)$/i);
      return m ? `/album-sleeves/${m[1]}` : u;
    });
    const res = await httpsJson({
      baseUrl,
      token,
      method: 'PATCH',
      urlPath: `/api/listings/${item.id}`,
      body: { images: next },
    });
    if (res.status < 400) rewritten += 1;
  }
  return rewritten;
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

/** Human-readable auction titles — no harness/seed vocabulary. */
const AUCTION_WATCHLIST_LOTS = [
  {
    title: 'Horace Silver — Song for My Father BLP 4185',
    artist: 'Horace Silver',
    catalog_number: 'BLP 4185',
    label: 'Blue Note',
    hours_until_end: 6,
    starting_bid_cents: 1200,
    cover: 'kenny-dorham',
  },
  {
    title: 'Art Blakey — Moanin\' BLP 4003',
    artist: 'Art Blakey',
    catalog_number: 'BLP 4003',
    label: 'Blue Note',
    hours_until_end: 12,
    starting_bid_cents: 1800,
    cover: 'kenny-dorham',
  },
  {
    title: 'Lee Morgan — The Sidewinder BLP 4157',
    artist: 'Lee Morgan',
    catalog_number: 'BLP 4157',
    label: 'Blue Note',
    hours_until_end: 18,
    starting_bid_cents: 2100,
    cover: 'kenny-dorham',
  },
  {
    title: 'Wayne Shorter — Speak No Evil BST 84194',
    artist: 'Wayne Shorter',
    catalog_number: 'BST 84194',
    label: 'Blue Note',
    hours_until_end: 36,
    starting_bid_cents: 1600,
    cover: 'miles-davis',
  },
  {
    title: 'Herbie Hancock — Maiden Voyage BST 84195',
    artist: 'Herbie Hancock',
    catalog_number: 'BST 84195',
    label: 'Blue Note',
    hours_until_end: 48,
    starting_bid_cents: 1950,
    cover: 'miles-davis',
  },
  {
    title: 'Dexter Gordon — Go! BLP 4112',
    artist: 'Dexter Gordon',
    catalog_number: 'BLP 4112',
    label: 'Blue Note',
    hours_until_end: 72,
    starting_bid_cents: 1400,
    cover: 'miles-davis',
  },
];

async function fetchWatchlistListingIds(baseUrl, token) {
  const res = await httpsJson({
    baseUrl,
    token,
    urlPath: '/api/shopping/watchlist',
  });
  const items = res.body?.items || res.body?.watchlist || (Array.isArray(res.body) ? res.body : []);
  return items
    .map((i) => i.listingId || i.listing_id || i.item_id || i.id)
    .filter(Boolean)
    .map(String);
}

async function addWatchlistListing(baseUrl, token, listingId, metadata = {}) {
  const existing = await fetchWatchlistListingIds(baseUrl, token);
  if (existing.includes(String(listingId))) return { status: 200, already: true };
  const res = await httpsJson({
    baseUrl,
    token,
    method: 'POST',
    urlPath: '/api/shopping/watchlist',
    body: {
      item_type: 'listing',
      item_id: listingId,
      listing_id: listingId,
      metadata: {
        title: metadata.title || 'Auction lot',
        imageUrl: metadata.imageUrl || localCoverUrl(baseUrl, 'kenny-dorham'),
        saleType: 'auction',
        saleTypeDisplay: 'Auction',
      },
    },
  });
  if (res.status >= 400 && res.status !== 409) {
    throw new Error(`watchlist_add_failed:${res.status}:${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return { status: res.status, already: false };
}

/**
 * Ensure the buyer watchlist has ≥5 active auction lots with mixed end times
 * (inside and outside 24h) so ending-window correction changes membership.
 */
async function ensureBuyerAuctionWatchlist({ baseUrl, buyerToken, sellerToken }) {
  const created = [];
  const lotIds = [];
  const seller = sellerToken || buyerToken;
  for (let i = 0; i < AUCTION_WATCHLIST_LOTS.length; i += 1) {
    const spec = AUCTION_WATCHLIST_LOTS[i];
    const endsAt = new Date(Date.now() + spec.hours_until_end * 3600_000).toISOString();
    const id = await createListing(baseUrl, seller, {
      title: spec.title,
      artist: spec.artist,
      catalog_number: spec.catalog_number,
      label: spec.label,
      description: 'Active auction lot used for watchlist temperature analysis.',
      price_cents: spec.starting_bid_cents,
      pricing_mode: 'auction',
      images: [localCoverUrl(baseUrl, spec.cover)],
      amenities: [
        'sale_type:auction',
        `starting_bid_cents:${spec.starting_bid_cents}`,
        `reserve_price_cents:${Math.round(spec.starting_bid_cents * 2)}`,
        `auction_ends_at:${endsAt}`,
      ],
    });
    created.push({
      capability: 'auction_watchlist',
      id,
      hours_until_end: spec.hours_until_end,
      ends_at: endsAt,
    });
    lotIds.push(id);
    await addWatchlistListing(baseUrl, buyerToken, id, {
      title: spec.title,
      imageUrl: localCoverUrl(baseUrl, spec.cover),
    });
  }

  // Poll briefly until shopping-service reflects the adds.
  let watchlistIds = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    watchlistIds = await fetchWatchlistListingIds(baseUrl, buyerToken);
    if (lotIds.every((id) => watchlistIds.includes(String(id)))) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const within24h = created.filter((c) => c.hours_until_end <= 24).length;
  const outside24h = created.filter((c) => c.hours_until_end > 24).length;
  if (lotIds.length < 5 || within24h < 2 || outside24h < 2) {
    throw new Error(
      `auction_watchlist_seed_insufficient:lots=${lotIds.length} within24h=${within24h} outside24h=${outside24h}`,
    );
  }

  return {
    ok: true,
    min_lots: lotIds.length,
    listing_ids: lotIds,
    within_24h: within24h,
    outside_24h: outside24h,
    watchlist_ids_after: watchlistIds,
    created,
  };
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
 * Host-written seed files are invisible to containerized webapp / python-ai
 * unless copied in. Without this, valuation gathers 0 sold comps and success
 * collapses into the same abstention shell as the weak scenario.
 */
export function syncOwnerProofCompletedSalesSeedIntoCluster(seedPath = OWNER_PROOF_COMPLETED_SALES_SEED_PATH) {
  if (!fs.existsSync(seedPath)) {
    return { synced: false, reason: 'seed_missing', targets: [] };
  }
  const ns = process.env.RECORD_PLATFORM_NAMESPACE || 'record-platform';
  const targets = [
    {
      deploy: 'webapp',
      remotePaths: ['/tmp/phase34-owner-proof-completed-sales.live.json'],
    },
    {
      deploy: 'python-ai-service',
      remotePaths: ['/tmp/phase34-owner-proof-completed-sales.live.json'],
    },
  ];
  const results = [];
  for (const target of targets) {
    const podProc = spawnSync(
      'kubectl',
      [
        '-n',
        ns,
        'get',
        'pods',
        '-l',
        `app=${target.deploy}`,
        '-o',
        'jsonpath={.items[0].metadata.name}',
      ],
      { encoding: 'utf8' },
    );
    const podName = String(podProc.stdout || '').trim();
    if (!podName) {
      results.push({
        deploy: target.deploy,
        remote: target.remotePaths[0],
        mkdir_ok: false,
        copy_ok: false,
        stderr: podProc.stderr || 'pod_not_found',
      });
      continue;
    }
    for (const remote of target.remotePaths) {
      const remoteDir = path.posix.dirname(remote);
      const mkdir = spawnSync(
        'kubectl',
        ['-n', ns, 'exec', podName, '--', 'mkdir', '-p', remoteDir],
        { encoding: 'utf8' },
      );
      const copied = spawnSync(
        'kubectl',
        ['-n', ns, 'cp', seedPath, `${ns}/${podName}:${remote}`],
        { encoding: 'utf8' },
      );
      results.push({
        deploy: target.deploy,
        pod: podName,
        remote,
        mkdir_ok: mkdir.status === 0,
        copy_ok: copied.status === 0,
        stderr: String(copied.stderr || mkdir.stderr || '').slice(0, 400),
      });
    }
  }
  const synced = results.length > 0 && results.every((r) => r.copy_ok);
  return { synced, reason: synced ? 'ok' : 'partial_or_failed', targets: results };
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
  const clusterSeedSync = syncOwnerProofCompletedSalesSeedIntoCluster(seedPaths.primary);
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

  // Buyer watchlist auctions: ≥5 lots with mixed end windows so the 24h
  // correction changes membership, evidence, and the visible temperature panel.
  // Never use force_watchlist_floor — real first-party auction listings only.
  const auctionSeed = await ensureBuyerAuctionWatchlist({
    baseUrl,
    buyerToken,
    sellerToken: sellerToken || buyerToken,
  });
  created.push(...auctionSeed.created);

  const rewrittenBuyer = await rewriteAbsoluteAlbumSleeveUrls(baseUrl, buyerToken);
  const rewrittenSeller = sellerToken
    ? await rewriteAbsoluteAlbumSleeveUrls(baseUrl, sellerToken)
    : 0;

  return {
    ok: true,
    created_count: created.length,
    created,
    seller_kenny_listing_id: sellerKennyListingId,
    auction_watchlist: auctionSeed,
    rewritten_absolute_album_sleeve_urls: {
      buyer: rewrittenBuyer,
      seller: rewrittenSeller,
    },
    miles_title_hits_after: await countTitleHits(baseUrl, buyerToken, 'Kind of Blue'),
    kenny_title_hits_after: await countTitleHits(
      baseUrl,
      sellerToken || buyerToken,
      'Quiet Kenny',
    ),
    sold_seed_method,
    sold_seed_paths: seedPaths,
    sold_seed_cluster_sync: clusterSeedSync,
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
