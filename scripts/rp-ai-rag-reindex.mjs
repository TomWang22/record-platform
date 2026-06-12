#!/usr/bin/env node
/**
 * T15.2C — RAG reindex engine (called by rp-ai-rag-reindex.sh).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeRecord,
  normalizePublicListing,
  normalizeOwnerListing,
  normalizeListingRevision,
  normalizeOboOfferSummary,
  normalizeAuctionBidSummary,
  normalizeNotification,
  normalizeMessage,
  chunkNormalizedText,
  SOURCE_TYPES,
} from './lib/rp-ai-normalize-documents.mjs';
import {
  applyRagMigrationIfNeeded,
  startIngestionRun,
  finishIngestionRun,
  upsertDocument,
  withClient,
  DB_PORTS,
  tableExists,
  columnExists,
  fetchMessageOptInUsers,
  seedE2EContractDocs,
} from './lib/rp-ai-rag-db.mjs';
import { buildListingQuery, mapListingRow } from './lib/rp-ai-listing-export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(REPO_ROOT, 'bench_logs/ai-platform');

function parseArgs(argv) {
  const opts = { all: false, sources: new Set(), user: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--source') opts.sources.add(argv[++i]);
    else if (a === '--user') opts.user = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (opts.all) {
    opts.sources = new Set(['records', 'listings', 'offers', 'auctions', 'notifications', 'messages']);
  }
  if (opts.sources.size === 0) throw new Error('specify --all or --source');
  return opts;
}

function initCounts() {
  const c = {};
  for (const v of Object.values(SOURCE_TYPES)) c[v] = { inserted: 0, updated: 0, skipped: 0 };
  return c;
}

function bump(counts, sourceType, action) {
  if (!counts[sourceType]) counts[sourceType] = { inserted: 0, updated: 0, skipped: 0 };
  if (action === 'inserted') counts[sourceType].inserted += 1;
  else if (action === 'updated') counts[sourceType].updated += 1;
  else counts[sourceType].skipped += 1;
}

async function ingestDoc(client, doc, counts, dryRun) {
  const maxChunks = Number(process.env.AI_RAG_MAX_CHUNKS || 32);
  const chunks = chunkNormalizedText(doc.normalized_text, 1200, maxChunks);
  chunks.forEach((ch) => {
    ch.source_refs = doc.source_refs;
  });
  const r = await upsertDocument(client, doc, chunks, dryRun);
  bump(counts, doc.source_type, r.action === 'would_insert' ? 'inserted' : r.action === 'would_update' ? 'updated' : r.action);
}

async function exportRecords(client, aiClient, counts, userFilter, dryRun) {
  let q = `SELECT id::text, user_id::text, artist, name, format, catalog_number,
                  record_grade, sleeve_grade, notes, price_paid, created_at, updated_at
           FROM records.records`;
  const params = [];
  if (userFilter) {
    params.push(userFilter);
    q += ` WHERE user_id = $1::uuid`;
  }
  q += ` ORDER BY updated_at DESC LIMIT 50000`;
  const rows = (await withClient(DB_PORTS.records, 'records', (c) => c.query(q, params))).rows;
  for (const row of rows) {
    const doc = normalizeRecord(row);
    await ingestDoc(aiClient, doc, counts, dryRun);
  }
  return rows.length;
}

async function exportListings(aiClient, counts, userFilter, dryRun) {
  return withClient(DB_PORTS.listings, 'listings', async (lc) => {
    const { q, params } = await buildListingQuery(lc, userFilter);
    const rows = (await lc.query(q, params)).rows.map(mapListingRow);
    for (const row of rows) {
      if (row.is_active && row.listing_type !== 'auction') {
        await ingestDoc(aiClient, normalizePublicListing(row), counts, dryRun);
      }
      await ingestDoc(aiClient, normalizeOwnerListing(row), counts, dryRun);
    }

    if (await tableExists(lc, 'listings', 'listing_revisions')) {
      let rq = `SELECT id::text, listing_id::text, editor_user_id::text, snapshot, created_at
                FROM listings.listing_revisions`;
      const rparams = [];
      if (userFilter) {
        rq += ` WHERE editor_user_id = $1::uuid`;
        rparams.push(userFilter);
      }
      rq += ` ORDER BY created_at DESC LIMIT 10000`;
      const revs = (await lc.query(rq, rparams)).rows;
      const listingMap = new Map(rows.map((r) => [r.id, r]));
      for (const rev of revs) {
        const listing = listingMap.get(rev.listing_id) ?? { title: rev.listing_id, user_id: rev.editor_user_id };
        await ingestDoc(aiClient, normalizeListingRevision(rev, listing), counts, dryRun);
      }
    }
    return rows.length;
  });
}

async function exportOffers(aiClient, counts, userFilter, dryRun) {
  return withClient(DB_PORTS.listings, 'listings', async (lc) => {
    const hasPhase9 = await columnExists(lc, 'listings', 'offers', 'buyer_user_id');
    if (!hasPhase9) return 0;
    let q = `SELECT o.id::text, o.listing_id::text, o.buyer_user_id::text, o.seller_user_id::text,
                    o.amount_cents, o.currency, o.status, o.attempt_number, o.parent_offer_id::text,
                    o.expires_at, o.created_at, o.updated_at, l.title
             FROM listings.offers o
             JOIN listings.listings l ON l.id = o.listing_id`;
    const params = [];
    if (userFilter) {
      q += ` WHERE o.buyer_user_id = $1::uuid OR o.seller_user_id = $1::uuid`;
      params.push(userFilter);
    }
    q += ` ORDER BY o.updated_at DESC LIMIT 20000`;
    const rows = (await lc.query(q, params)).rows;
    for (const row of rows) {
      for (const doc of normalizeOboOfferSummary(row, row.title)) {
        await ingestDoc(aiClient, doc, counts, dryRun);
      }
    }
    return rows.length;
  });
}

async function exportAuctions(aiClient, counts, userFilter, dryRun) {
  return withClient(DB_PORTS.listings, 'listings', async (lc) => {
    const hasSettings = await tableExists(lc, 'listings', 'auction_settings');
    if (!hasSettings) return 0;
    const hasDeletedAt = await columnExists(lc, 'listings', 'listings', 'deleted_at');
    let lq = `SELECT l.id::text, l.user_id::text, l.title, l.created_at, l.updated_at
              FROM listings.auction_settings s
              JOIN listings.listings l ON l.id = s.listing_id`;
    const params = [];
    const where = [];
    if (hasDeletedAt) where.push('l.deleted_at IS NULL');
    if (userFilter) {
      params.push(userFilter);
      where.push(`l.user_id = $${params.length}::uuid`);
    }
    if (where.length) lq += ` WHERE ${where.join(' AND ')}`;
    const listings = (await lc.query(lq, params)).rows;
    for (const listing of listings) {
      const settings = (
        await lc.query(`SELECT status, current_bid_cents, bid_count, ends_at, updated_at
                        FROM listings.auction_settings WHERE listing_id = $1::uuid`, [listing.id])
      ).rows[0];
      const hasPhase10Bids = await columnExists(lc, 'listings', 'bids', 'bidder_user_id');
      let bids = [];
      if (hasPhase10Bids) {
        bids = (
          await lc.query(
            `SELECT bidder_user_id::text, amount_cents, created_at
             FROM listings.bids WHERE listing_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
            [listing.id],
          )
        ).rows;
      }
      await ingestDoc(aiClient, normalizeAuctionBidSummary(listing, settings, bids), counts, dryRun);
    }
    return listings.length;
  });
}

async function exportNotifications(aiClient, counts, userFilter, dryRun) {
  return withClient(DB_PORTS.notification, 'notification', async (nc) => {
    let q = `SELECT id::text, user_id::text, event_type, channel::text, status::text, payload, created_at
             FROM notification.notifications`;
    const params = [];
    if (userFilter) {
      q += ` WHERE user_id = $1::uuid`;
      params.push(userFilter);
    }
    q += ` ORDER BY created_at DESC LIMIT 20000`;
    const rows = (await nc.query(q, params)).rows;
    for (const row of rows) {
      await ingestDoc(aiClient, normalizeNotification(row), counts, dryRun);
    }
    return rows.length;
  });
}

async function exportMessages(aiClient, counts, userFilter, dryRun) {
  const optIn = await fetchMessageOptInUsers();
  if (optIn.size === 0) return 0;
  return withClient(DB_PORTS.messaging, 'messaging', async (mc) => {
    const ids = [...optIn];
    if (userFilter && !optIn.has(userFilter)) return 0;
    const filterIds = userFilter ? [userFilter] : ids;
    const rows = (
      await mc.query(
        `SELECT id::text, conversation_id::text, sender_id::text, body, created_at
         FROM messaging.messages
         WHERE sender_id = ANY($1::uuid[]) AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 5000`,
        [filterIds],
      )
    ).rows;
    for (const row of rows) {
      const doc = normalizeMessage(row, optIn.has(row.sender_id));
      if (doc) await ingestDoc(aiClient, doc, counts, dryRun);
    }
    return rows.length;
  });
}

function writeReports(result) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, 'rag-reindex-run.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  const mdPath = path.join(REPORT_DIR, 'rag-ingestion-contract.md');
  const lines = [
    '# RAG ingestion contract (T15.2)',
    '',
    `Generated: ${result.finished_at}`,
    '',
    '## Reindex run',
    '',
    `- Run ID: \`${result.run_id}\``,
    `- Dry run: ${result.dry_run}`,
    `- Status: **${result.status}**`,
    '',
    '### Actions by source_type',
    '',
    '| source_type | inserted | updated | skipped |',
    '|-------------|----------|---------|---------|',
  ];
  for (const [k, v] of Object.entries(result.counts_by_source_type).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${k} | ${v.inserted} | ${v.updated} | ${v.skipped} |`);
  }
  lines.push('', '### Raw export row counts', '');
  for (const [k, v] of Object.entries(result.raw_export_counts)) {
    lines.push(`- ${k}: ${v}`);
  }
  if (result.e2e_seed_inserted) lines.push('', `E2E contract seed inserted: ${result.e2e_seed_inserted}`);
  lines.push('', '## Design', '', '- analytics normalizes and curates platform signals', '- python-ai retrieves from `ai.ai_documents` / chunks (T15.3 query)', '- Ollama is model backend only', '');
  fs.writeFileSync(mdPath, lines.join('\n'));
}

async function main() {
  const opts = parseArgs(process.argv);
  await applyRagMigrationIfNeeded();

  const counts = initCounts();
  const rawExport = {};
  const runId = opts.dryRun ? null : await startIngestionRun();
  let status = 'completed';
  let error = null;
  let e2eSeed = 0;

  try {
    await withClient(DB_PORTS.python_ai, 'python_ai', async (aiClient) => {
      if (opts.sources.has('records')) rawExport.records = await exportRecords(null, aiClient, counts, opts.user, opts.dryRun);
      if (opts.sources.has('listings')) rawExport.listings = await exportListings(aiClient, counts, opts.user, opts.dryRun);
      if (opts.sources.has('offers')) rawExport.offers = await exportOffers(aiClient, counts, opts.user, opts.dryRun);
      if (opts.sources.has('auctions')) rawExport.auctions = await exportAuctions(aiClient, counts, opts.user, opts.dryRun);
      if (opts.sources.has('notifications')) rawExport.notifications = await exportNotifications(aiClient, counts, opts.user, opts.dryRun);
      if (opts.sources.has('messages')) rawExport.messages = await exportMessages(aiClient, counts, opts.user, opts.dryRun);

      const totalDocs = (
        await aiClient.query(`SELECT COUNT(*)::int AS n FROM ai.ai_documents`)
      ).rows[0].n;
      if (totalDocs === 0) {
        e2eSeed = await seedE2EContractDocs(aiClient);
      }
    });
  } catch (e) {
    status = 'failed';
    error = String(e?.message ?? e);
    throw e;
  } finally {
    if (runId) await finishIngestionRun(runId, status, counts, error);
    const finished_at = new Date().toISOString();
    const result = {
      run_id: runId,
      dry_run: opts.dryRun,
      status,
      error,
      counts_by_source_type: counts,
      raw_export_counts: rawExport,
      e2e_seed_inserted: e2eSeed,
      finished_at,
    };
    writeReports(result);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
