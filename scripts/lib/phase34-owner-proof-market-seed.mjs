/**
 * Seed marketplace rows so owner-proof success floors can pass live.
 * Creates synthetic contract listings only — never production identities.
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginContractUser } from './phase34-product-live-subjects.mjs';

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

function cover(text) {
  return `https://placehold.co/800x800/0d2137/7eb8da/png?text=${encodeURIComponent(text)}`;
}

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
    description: 'Owner-proof market evidence seed (contract only).',
    price_cents: 4500 + Math.floor(Math.random() * 4000),
    effective_from: '2026-01-01',
    format: 'LP',
    media_condition: 'VG+',
    sleeve_condition: 'VG',
    pricing_mode: 'fixed',
    initial_status: 'active',
    images: [cover('OwnerProof')],
    domestic_shipping_cents: 500,
    international_shipping_cents: 1500,
    shipping_service: 'Media Mail',
    package_type: 'LP mailer',
    domestic_shipping: true,
    international_shipping: true,
    local_pickup: false,
    combined_shipping: true,
    shipping_notes: 'owner-proof seed',
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
  const milesHits = await countTitleHits(baseUrl, buyerToken, 'Kind of Blue');
  const needMiles = Math.max(0, 8 - milesHits);
  for (let i = 0; i < needMiles; i += 1) {
    const id = await createListing(baseUrl, buyerToken, {
      title: `Miles Davis — Kind of Blue CL 1355 (owner-proof seed ${i + 1})`,
      artist: 'Miles Davis',
      catalog_number: 'CL 1355',
      label: 'Columbia',
      price_cents: 7000 + i * 250,
      images: [cover('Miles+CL1355')],
      ...(scarcityRecordId ? { source_record_id: scarcityRecordId } : {}),
    });
    created.push({ capability: 'scarcity', id });
  }

  const kennyHits = await countTitleHits(baseUrl, sellerToken || buyerToken, 'Quiet Kenny');
  const needKenny = Math.max(0, 6 - kennyHits);
  const tokenForKenny = sellerToken || buyerToken;
  for (let i = 0; i < needKenny; i += 1) {
    const id = await createListing(baseUrl, tokenForKenny, {
      title: `Kenny Dorham — Quiet Kenny BLP 1569 (owner-proof seed ${i + 1})`,
      artist: 'Kenny Dorham',
      catalog_number: 'BLP 1569',
      label: 'Blue Note',
      price_cents: 3800 + i * 200,
      images: [cover('Kenny+BLP1569')],
      ...(valuationRecordId ? { source_record_id: valuationRecordId } : {}),
    });
    created.push({ capability: 'valuation', id });
  }

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
        title: 'Kenny Dorham — Quiet Kenny BLP 1569 (owner-proof seller edit)',
        artist: 'Kenny Dorham',
        catalog_number: 'BLP 1569',
        label: 'Blue Note',
        price_cents: 4100,
        images: [cover('Kenny+Seller')],
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
