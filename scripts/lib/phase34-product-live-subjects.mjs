/**
 * Resolve real marketplace subjects for live product-harness sessions.
 * Never embeds tokens, emails, or raw PII into returned ids beyond UUID subjects.
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function defaultCa() {
  const chain = path.join(REPO_ROOT, 'certs/dev-chain.pem');
  const root = path.join(REPO_ROOT, 'certs/dev-root.pem');
  if (fs.existsSync(chain)) return chain;
  return root;
}

function httpsJson({ baseUrl, token, urlPath, caCert }) {
  const u = new URL(urlPath, baseUrl.replace(/\/$/, '') + '/');
  const ca = fs.readFileSync(caCert || defaultCa());
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-RP-E2E-Contract': '1',
          Accept: 'application/json',
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
          let body = null;
          try {
            body = JSON.parse(raw);
          } catch {
            body = { _raw: raw.slice(0, 200) };
          }
          if ((res.statusCode || 500) >= 400) {
            const err = new Error(`subject resolve HTTP ${res.statusCode} ${urlPath}`);
            err.statusCode = res.statusCode;
            err.body = body;
            reject(err);
            return;
          }
          resolve(body);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function loginContractUser({ baseUrl, email, password, caCert }) {
  const u = new URL('/api/auth/login', baseUrl.replace(/\/$/, '') + '/');
  const ca = fs.readFileSync(caCert || defaultCa());
  const payload = JSON.stringify({ email, password });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RP-E2E-Contract': '1',
          'Content-Length': Buffer.byteLength(payload),
        },
        ca,
        servername: u.hostname,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if ((res.statusCode || 500) >= 400 || !body.token) {
            reject(new Error(`login failed HTTP ${res.statusCode}`));
            return;
          }
          resolve({ token: body.token, user: body.user || null });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * @returns {Promise<{
 *   record_id: string,
 *   listing_id: string,
 *   auction_listing_id: string,
 *   thread_id: string | null,
 *   scarcity_record_id?: string,
 *   valuation_record_id?: string,
 * }>}
 */
export async function resolveLiveSubjects({ baseUrl, token, caCert }) {
  const records = await httpsJson({
    baseUrl,
    token,
    caCert,
    urlPath: '/api/records?limit=100',
  });
  const listings = await httpsJson({
    baseUrl,
    token,
    caCert,
    urlPath: '/api/listings/search?limit=100',
  });
  const recordList = Array.isArray(records) ? records : records?.items || records?.data || [];
  const listingList =
    listings?.listings || listings?.items || listings?.data || (Array.isArray(listings) ? listings : []);

  const findRecord = (...preds) =>
    recordList.find((r) => preds.every((p) => p(r))) || null;

  const scarcityRecord =
    findRecord(
      (r) => /CL\s*1355/i.test(String(r.catalogNumber || r.catalog_number || '')),
      (r) => /miles/i.test(String(r.artist || '')),
    ) ||
    findRecord((r) => /kind of blue/i.test(String(r.name || r.title || ''))) ||
    null;

  const valuationRecord =
    findRecord(
      (r) => /BLP\s*1569/i.test(String(r.catalogNumber || r.catalog_number || '')),
      (r) => /kenny/i.test(String(r.artist || '')),
    ) ||
    findRecord((r) => /quiet kenny/i.test(String(r.name || r.title || ''))) ||
    null;

  const record_id = scarcityRecord?.id || valuationRecord?.id || recordList[0]?.id;

  const listingForRecord = (recordId) =>
    listingList.find(
      (i) =>
        String(i.source_record_id || i.record_id || '') === String(recordId) &&
        String(i.status || i.listing_status || 'active').toLowerCase() !== 'deleted',
    ) || null;

  // Prefer a listing that carries real artist/catalog metadata over bare E2E browse stubs.
  const richListing =
    listingList.find(
      (i) =>
        (i.artist || i.catalogNumber || i.catalog_number) &&
        !/^E2E Browse/i.test(String(i.title || '')),
    ) ||
    listingList.find((i) => !/^E2E Browse/i.test(String(i.title || ''))) ||
    listingList[0];

  const listing_id =
    listingForRecord(scarcityRecord?.id)?.id ||
    listingForRecord(valuationRecord?.id)?.id ||
    richListing?.id ||
    listingList[0]?.id;

  const auction =
    listingList.find((i) => String(i.saleType || i.sale_type || '').toLowerCase() === 'auction') ||
    null;
  const auction_listing_id = auction?.id || listing_id;

  let thread_id = null;
  try {
    const messages = await httpsJson({
      baseUrl,
      token,
      caCert,
      urlPath: '/api/messages?limit=10',
    });
    const msgs = messages?.messages || [];
    thread_id = msgs[0]?.thread_id || msgs[0]?.parent_message_id || msgs[0]?.id || null;
  } catch {
    thread_id = null;
  }

  if (!record_id || !listing_id) {
    const err = new Error('live subjects missing record_id or listing_id');
    err.code = 'PHASE34_PRODUCT_SUBJECTS_MISSING';
    throw err;
  }

  return {
    record_id,
    listing_id,
    auction_listing_id,
    thread_id,
    id: record_id,
    scarcity_record_id: scarcityRecord?.id || record_id,
    valuation_record_id: valuationRecord?.id || record_id,
  };
}

export function subjectForCapability(subjects, capability) {
  switch (capability) {
    case 'scarcity':
      return {
        id: subjects.scarcity_record_id || subjects.record_id,
        record_id: subjects.scarcity_record_id || subjects.record_id,
        listing_id: subjects.listing_id,
      };
    case 'valuation':
      return {
        id: subjects.valuation_record_id || subjects.record_id,
        record_id: subjects.valuation_record_id || subjects.record_id,
        listing_id: subjects.listing_id,
      };
    case 'recommendations':
      return {
        id: subjects.record_id,
        record_id: subjects.record_id,
        listing_id: subjects.listing_id,
      };
    case 'auction_intelligence':
      return {
        id: subjects.auction_listing_id,
        record_id: subjects.record_id,
        listing_id: subjects.auction_listing_id,
      };
    case 'negotiation_assistance':
      return {
        id: subjects.thread_id || subjects.listing_id,
        record_id: subjects.record_id,
        listing_id: subjects.listing_id,
        thread_id: subjects.thread_id,
      };
    case 'semantic_search':
    case 'embeddings':
    case 'market_analytics':
      return {
        id: subjects.listing_id,
        record_id: subjects.record_id,
        listing_id: subjects.listing_id,
      };
    default: {
      const _exhaustive = capability;
      return {
        id: subjects.record_id,
        record_id: subjects.record_id,
        listing_id: subjects.listing_id,
        _unexpected: _exhaustive,
      };
    }
  }
}
