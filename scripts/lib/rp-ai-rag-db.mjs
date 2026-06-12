/**
 * T15.2C — RAG corpus DB helpers (python_ai + source DBs).
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const DB_PORTS = {
  records: 5433,
  listings: 5435,
  shopping: 5436,
  auth: 5437,
  analytics: 5439,
  python_ai: 5440,
  notification: 5441,
  messaging: 5434,
};

export function pgConfig(port, database) {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env[`RP_PG_PORT_${port}`] || port),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database,
  };
}

export async function withClient(port, database, fn) {
  const client = new pg.Client(pgConfig(port, database));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function applyRagMigrationIfNeeded() {
  const sqlPath = path.join(REPO_ROOT, 'infra/db/10-ai-rag-corpus.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await withClient(DB_PORTS.python_ai, 'python_ai', async (c) => {
    await c.query(sql);
  });
}

export async function startIngestionRun() {
  return withClient(DB_PORTS.python_ai, 'python_ai', async (c) => {
    const r = await c.query(
      `INSERT INTO ai.ai_ingestion_runs (status, started_at) VALUES ('running', now()) RETURNING id`,
    );
    return r.rows[0].id;
  });
}

export async function finishIngestionRun(runId, status, sourceCounts, error = null) {
  await withClient(DB_PORTS.python_ai, 'python_ai', async (c) => {
    await c.query(
      `UPDATE ai.ai_ingestion_runs
       SET status = $2, finished_at = now(), source_counts = $3::jsonb, error = $4
       WHERE id = $1`,
      [runId, status, JSON.stringify(sourceCounts), error],
    );
  });
}

export async function findExistingDocument(client, doc) {
  const r = await client.query(
    `SELECT id, checksum FROM ai.ai_documents
     WHERE source_type = $1 AND source_id = $2
       AND COALESCE(owner_user_id, '') = COALESCE($3::text, '')
       AND visibility = $4`,
    [doc.source_type, doc.source_id, doc.owner_user_id, doc.visibility],
  );
  return r.rows[0] ?? null;
}

export async function upsertDocument(client, doc, chunks, dryRun) {
  const existing = await findExistingDocument(client, doc);
  if (existing?.checksum === doc.checksum) {
    return { action: 'skipped', document_id: existing.id };
  }
  if (dryRun) {
    return { action: existing ? 'would_update' : 'would_insert' };
  }

  let documentId = existing?.id;
  if (documentId) {
    await client.query(
      `UPDATE ai.ai_documents SET
         title = $2, summary = $3, source_updated_at = $4, checksum = $5,
         metadata = $6::jsonb, updated_at = now()
       WHERE id = $1`,
      [
        documentId,
        doc.title,
        doc.summary,
        doc.source_updated_at,
        doc.checksum,
        JSON.stringify(doc.metadata ?? {}),
      ],
    );
    await client.query(`DELETE FROM ai.ai_document_chunks WHERE document_id = $1`, [documentId]);
  } else {
    const ins = await client.query(
      `INSERT INTO ai.ai_documents (
         source_type, source_id, owner_user_id, visibility, title, summary,
         source_updated_at, checksum, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING id`,
      [
        doc.source_type,
        doc.source_id,
        doc.owner_user_id,
        doc.visibility,
        doc.title,
        doc.summary,
        doc.source_updated_at,
        doc.checksum,
        JSON.stringify(doc.metadata ?? {}),
      ],
    );
    documentId = ins.rows[0].id;
  }

  for (const ch of chunks) {
    const refs = ch.source_refs?.length ? ch.source_refs : doc.source_refs ?? [];
    await client.query(
      `INSERT INTO ai.ai_document_chunks (
         document_id, chunk_index, content, token_count, embedding, embedding_model,
         checksum, source_refs
       ) VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6::jsonb)`,
      [documentId, ch.chunk_index, ch.content, ch.token_count ?? null, ch.checksum, JSON.stringify(refs)],
    );
  }
  return { action: existing ? 'updated' : 'inserted', document_id: documentId };
}

export async function tableExists(client, schema, table) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return r.rows.length > 0;
}

export async function columnExists(client, schema, table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [schema, table, column],
  );
  return r.rows.length > 0;
}

export async function fetchMessageOptInUsers() {
  return withClient(DB_PORTS.auth, 'auth', async (c) => {
    const r = await c.query(
      `SELECT id::text FROM auth.users
       WHERE COALESCE(settings->>'ai_rag_message_opt_in', 'false') = 'true'`,
    );
    return new Set(r.rows.map((row) => row.id));
  });
}

export async function seedE2EContractDocs(client) {
  const seedFlag = process.env.AI_RAG_E2E_SEED === '1';
  if (!seedFlag) return 0;
  const {
    normalizeRecord,
    normalizePublicListing,
    normalizeOboOfferSummary,
    normalizeAuctionBidSummary,
    normalizeNotification,
    chunkNormalizedText,
  } = await import('./rp-ai-normalize-documents.mjs');

  const now = new Date().toISOString();
  const userId = '00000000-0000-4000-8000-000000000001';
  const listingId = '00000000-0000-4000-8000-000000000002';
  const offerId = '00000000-0000-4000-8000-000000000003';
  const notifId = '00000000-0000-4000-8000-000000000004';
  const recordId = '00000000-0000-4000-8000-000000000005';

  const docs = [
    normalizeRecord({
      id: recordId,
      user_id: userId,
      artist: 'Contract Artist',
      name: 'Contract Album',
      format: 'LP',
      updated_at: now,
      created_at: now,
    }),
    normalizePublicListing({
      id: listingId,
      user_id: userId,
      title: 'Contract Listing',
      listing_type: 'fixed_price',
      price: 19.99,
      currency: 'USD',
      is_active: true,
      updated_at: now,
      created_at: now,
    }),
    ...normalizeOboOfferSummary(
      {
        id: offerId,
        listing_id: listingId,
        buyer_user_id: userId,
        seller_user_id: '00000000-0000-4000-8000-000000000099',
        amount_cents: 1500,
        currency: 'USD',
        status: 'pending',
        attempt_number: 1,
        updated_at: now,
        created_at: now,
      },
      'Contract Listing',
    ),
    normalizeAuctionBidSummary(
      { id: listingId, title: 'Contract Auction', updated_at: now, created_at: now },
      { status: 'active', current_bid_cents: 2000, bid_count: 1, updated_at: now, ends_at: now },
      [{ bidder_user_id: userId, amount_cents: 2000, created_at: now }],
    ),
    normalizeNotification({
      id: notifId,
      user_id: userId,
      event_type: 'listing.updated',
      channel: 'push',
      status: 'sent',
      payload: { listing_id: listingId },
      created_at: now,
    }),
  ];

  let n = 0;
  for (const doc of docs) {
    const chunks = chunkNormalizedText(doc.normalized_text);
    chunks.forEach((ch) => {
      ch.source_refs = doc.source_refs;
    });
    const r = await upsertDocument(client, doc, chunks, false);
    if (r.action !== 'skipped') n += 1;
  }
  return n;
}
