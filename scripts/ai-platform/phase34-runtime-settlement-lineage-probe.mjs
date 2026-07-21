#!/usr/bin/env node
/**
 * Phase 34 runtime integration — settlement lineage probe (integration tenant).
 *
 * Proves checkout → SALE_COMPLETED → lifecycle → outbox persistence when the
 * deployed shopping-service includes emitSaleCompletedFromCheckout.
 *
 * Does NOT claim Kafka consumer normalization or production readiness.
 * Does NOT launch owner visual recapture / attempt 7.
 *
 * Usage:
 *   node scripts/ai-platform/phase34-runtime-settlement-lineage-probe.mjs
 *
 * Env:
 *   E2E_API_BASE (default https://record-platform.test)
 *   CONTRACT_EMAIL / CONTRACT_PASSWORD (or T20_PARTICIPANT_LOGIN_PASSWORD)
 *   LISTINGS_PG* for direct DB assertions (default 127.0.0.1:5435/listings)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const OUT_ROOT =
  process.env.PHASE34_RUNTIME_EVIDENCE_ROOT ||
  '/tmp/phase34-runtime-data-to-answer-integration-v1';
const REPORT_DIR = path.join(REPO, 'reports/phase34-runtime-integration');

const BASE = (process.env.E2E_API_BASE || 'https://record-platform.test').replace(/\/$/, '');
const EMAIL = process.env.CONTRACT_EMAIL || 'e2e-contract@record-platform.local';
const PASSWORD =
  process.env.CONTRACT_PASSWORD ||
  process.env.T20_PARTICIPANT_LOGIN_PASSWORD ||
  'ContractPass123!';
const CA = process.env.CA_CERT || path.join(REPO, 'certs/dev-chain.pem');
const caPem = fs.existsSync(CA) ? fs.readFileSync(CA) : undefined;

function nowIso() {
  return new Date().toISOString();
}

function api(method, urlPath, { token, body, headers } = {}) {
  const url = new URL(`${BASE}${urlPath}`);
  const payload = body === undefined ? null : JSON.stringify(body);
  const reqHeaders = {
    'content-type': 'application/json',
    'X-RP-E2E-Contract': '1',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(headers || {}),
    ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers: reqHeaders,
        ca: caPem,
        rejectUnauthorized: Boolean(caPem),
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode || 0, json, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

async function main() {
  const sourceSha = fs.existsSync(path.join(REPO, '.git'))
    ? fs.readFileSync(path.join(REPO, '.git/HEAD'), 'utf8').trim()
    : null;
  const dossier = {
    probe: 'phase34-runtime-settlement-lineage-probe',
    generated_at: nowIso(),
    base_url: BASE,
    production_claimed: false,
    steps: [],
    ok: false,
    blockers: [],
  };

  const login = await api('POST', '/api/auth/login', {
    body: { email: EMAIL, password: PASSWORD },
  });
  dossier.steps.push({ step: 'login', status: login.status, ok: login.status < 400 });
  if (login.status >= 400) {
    dossier.blockers.push('LOGIN_FAILED');
    writeJson(path.join(OUT_ROOT, 'dossiers/settlement-lineage-probe.json'), dossier);
    writeJson(path.join(REPORT_DIR, 'settlement-lineage-probe.json'), dossier);
    console.log(JSON.stringify(dossier, null, 2));
    process.exit(2);
  }
  const token = login.json?.accessToken || login.json?.token || login.json?.access_token;
  if (!token) {
    dossier.blockers.push('LOGIN_TOKEN_MISSING');
    writeJson(path.join(OUT_ROOT, 'dossiers/settlement-lineage-probe.json'), dossier);
    process.exit(2);
  }

  // Discover an ACTIVE buyable listing via marketplace search (integration tenant).
  const browse = await api('GET', '/api/listings/search?limit=5', { token });
  dossier.steps.push({ step: 'browse_listings', status: browse.status, ok: browse.status < 400 });
  const listings =
    browse.json?.listings ||
    browse.json?.items ||
    browse.json?.results ||
    browse.json?.data ||
    (Array.isArray(browse.json) ? browse.json : []);
  const listing = Array.isArray(listings) ? listings[0] : null;
  if (!listing?.id && !listing?.listing_id) {
    dossier.blockers.push('NO_ACTIVE_LISTING_FOR_CHECKOUT');
    dossier.browse_sample = browse.json;
    writeJson(path.join(OUT_ROOT, 'dossiers/settlement-lineage-probe.json'), dossier);
    writeJson(path.join(REPORT_DIR, 'settlement-lineage-probe.json'), dossier);
    console.log(JSON.stringify(dossier, null, 2));
    process.exit(3);
  }
  const listingId = listing.id || listing.listing_id;
  const listingPrice =
    Number(listing.price_cents != null ? listing.price_cents / 100 : listing.price) || 19.99;
  dossier.listing_id = listingId;

  const add = await api('POST', '/api/cart', {
    token,
    body: {
      item_type: 'listing',
      item_id: listingId,
      listing_id: listingId,
      quantity: 1,
      price: listingPrice,
    },
  });
  dossier.steps.push({ step: 'cart_add', status: add.status, ok: add.status < 400, body: add.json });

  const cartGet = await api('GET', '/api/cart', { token });
  dossier.steps.push({ step: 'cart_get', status: cartGet.status, ok: cartGet.status < 400 });
  const cartItems =
    cartGet.json?.items || cartGet.json?.cart_items || cartGet.json?.data || [];
  const checkoutItems = (Array.isArray(cartItems) ? cartItems : [])
    .filter((it) => String(it.listing_id || it.item_id) === String(listingId) || String(it.item_id) === String(listingId))
    .map((it) => ({
      item_type: it.item_type || 'listing',
      item_id: it.item_id || listingId,
      listing_id: it.listing_id || listingId,
      quantity: it.quantity || 1,
      price: Number(it.price) || listingPrice,
    }));
  if (checkoutItems.length === 0) {
    checkoutItems.push({
      item_type: 'listing',
      item_id: listingId,
      listing_id: listingId,
      quantity: 1,
      price: listingPrice,
    });
  }

  const checkout = await api('POST', '/api/cart/checkout', {
    token,
    body: {
      items: checkoutItems,
      payment_method: 'simulated',
      notes: `runtime-integration-${crypto.randomUUID()}`,
    },
  });
  dossier.steps.push({
    step: 'checkout',
    status: checkout.status,
    ok: checkout.status < 400,
    body: checkout.json,
  });
  if (checkout.status >= 400) {
    dossier.blockers.push('CHECKOUT_FAILED');
  }

  const pool = new pg.Pool({
    host: process.env.LISTINGS_PGHOST || '127.0.0.1',
    port: Number(process.env.LISTINGS_PGPORT || 5435),
    user: process.env.LISTINGS_PGUSER || 'postgres',
    password: process.env.LISTINGS_PGPASSWORD || 'postgres',
    database: process.env.LISTINGS_PGDATABASE || 'listings',
  });

  try {
    const sale = await pool.query(
      `SELECT sale_event_id, market_event_id, settlement_source, final_price::text, payload_hash, evidence_snapshot_id, evidence_snapshot_hash, created_at
       FROM listings.sale_completed_events
       WHERE listing_id = $1::uuid
       ORDER BY created_at DESC LIMIT 5`,
      [listingId],
    );
    const outbox = await pool.query(
      `SELECT id::text, type, published, created_at, convert_from(payload,'UTF8') AS payload_text
       FROM listings.outbox_events
       WHERE aggregate_id = $1 AND type IN ('SaleCompleted','SALE_COMPLETED')
       ORDER BY created_at DESC LIMIT 5`,
      [listingId],
    );
    const life = await pool.query(
      `SELECT lifecycle_status, settlement_evidence_eligible, status::text
       FROM listings.listings WHERE id = $1::uuid`,
      [listingId],
    );
    const market = await pool.query(
      `SELECT market_event_id, event_type, created_at
       FROM intelligence.market_events
       WHERE payload->>'listing_id' = $1
          OR payload->'payload'->>'listing_id' = $1
       ORDER BY created_at DESC LIMIT 5`,
      [listingId],
    ).catch((e) => ({ rows: [], error: String(e.message || e) }));

    dossier.db = {
      sale_completed_events: sale.rows,
      outbox_sale_completed: outbox.rows,
      listing_lifecycle: life.rows[0] || null,
      intelligence_market_events: market.rows,
      intelligence_market_events_error: market.error || null,
    };

    const hasSale = sale.rows.length > 0;
    const hasOutbox = outbox.rows.length > 0;
    const hasMarket = (market.rows || []).length > 0;

    dossier.lineage = {
      initiating_api: 'POST /api/cart/checkout',
      sale_completed_persisted: hasSale,
      outbox_persisted: hasOutbox,
      outbox_published: outbox.rows.some((r) => r.published === true),
      kafka_normalized_market_event: hasMarket,
      notes: [
        'Kafka normalization is only marked true when intelligence.market_events contains a matching row.',
        'TEST_INTEGRATION_EVENT / integration tenant rows must not be presented as historical market evidence.',
      ],
    };

    if (!hasSale) dossier.blockers.push('SALE_COMPLETED_NOT_PERSISTED');
    if (!hasOutbox) dossier.blockers.push('OUTBOX_SALE_COMPLETED_MISSING');
    if (!hasMarket) dossier.blockers.push('MARKET_EVENT_NORMALIZATION_NOT_OBSERVED');
    if (hasOutbox && !outbox.rows.some((r) => r.published === true)) {
      dossier.blockers.push('OUTBOX_SALE_COMPLETED_UNPUBLISHED');
    }

    dossier.ok = dossier.blockers.length === 0;
  } finally {
    await pool.end();
  }

  writeJson(path.join(OUT_ROOT, 'dossiers/settlement-lineage-probe.json'), dossier);
  writeJson(path.join(REPORT_DIR, 'settlement-lineage-probe.json'), dossier);
  writeJson(path.join(OUT_ROOT, 'event-lineage-probe-summary.json'), {
    ok: dossier.ok,
    blockers: dossier.blockers,
    listing_id: dossier.listing_id,
    generated_at: dossier.generated_at,
    source_sha_hint: sourceSha,
  });

  console.log(JSON.stringify({ ok: dossier.ok, blockers: dossier.blockers, listing_id: dossier.listing_id }, null, 2));
  process.exit(dossier.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
