#!/usr/bin/env node
/**
 * T20.10N — Bounded notification metadata-only refresh.
 * Updates ai.ai_documents.metadata only; never touches chunks or embeddings.
 * Default: dry-run. Actual writes require APPLY=1 and TARGET_USER_ID.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNotification } from './lib/rp-ai-normalize-documents.mjs';
import { withClient, DB_PORTS } from './lib/rp-ai-rag-db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const ENTITY_KEYS = ['listing_id', 'record_id', 'offer_id', 'auction_id', 'bid_id'];
const SOURCE_TYPE = 'notification';

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function metadataEqual(a, b) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function gainedKeys(oldMeta, newMeta) {
  const gained = {};
  for (const k of ENTITY_KEYS) {
    if (!oldMeta?.[k] && newMeta?.[k]) gained[k] = true;
  }
  return gained;
}

async function fetchCounts(client, userId) {
  const global = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM ai.ai_documents WHERE source_type = 'notification') AS notification_docs,
      (SELECT COUNT(*)::int
       FROM ai.ai_document_chunks c
       JOIN ai.ai_documents d ON d.id = c.document_id
       WHERE d.source_type = 'notification' AND c.embedding_vec IS NOT NULL) AS embedded_notification_chunks,
      (SELECT COUNT(*)::int
       FROM ai.ai_documents
       WHERE source_type = 'notification'
         AND (
           metadata ? 'listing_id' OR metadata ? 'record_id' OR metadata ? 'offer_id'
           OR metadata ? 'auction_id' OR metadata ? 'bid_id'
         )) AS notification_docs_with_entity_metadata
  `);
  const userScoped = await client.query(
    `SELECT
       COUNT(*)::int AS notification_docs,
       COUNT(*) FILTER (WHERE metadata ? 'listing_id')::int AS with_listing_id,
       COUNT(*) FILTER (WHERE metadata ? 'offer_id')::int AS with_offer_id,
       COUNT(*) FILTER (WHERE metadata ? 'record_id')::int AS with_record_id,
       COUNT(*) FILTER (WHERE metadata ? 'auction_id')::int AS with_auction_id,
       COUNT(*) FILTER (WHERE metadata ? 'bid_id')::int AS with_bid_id
     FROM ai.ai_documents
     WHERE source_type = 'notification' AND owner_user_id = $1`,
    [userId],
  );
  const chunks = await client.query(
    `SELECT COUNT(*)::int AS chunk_count,
            COUNT(*) FILTER (WHERE c.embedding_vec IS NOT NULL)::int AS embedded_chunk_count
     FROM ai.ai_document_chunks c
     JOIN ai.ai_documents d ON d.id = c.document_id
     WHERE d.source_type = 'notification' AND d.owner_user_id = $1`,
    [userId],
  );
  return {
    global: global.rows[0],
    user: userScoped.rows[0],
    chunks: chunks.rows[0],
  };
}

async function main() {
  const userId = (process.env.TARGET_USER_ID ?? '').trim();
  if (!userId) {
    console.error('TARGET_USER_ID is required');
    process.exit(2);
  }

  const apply = process.env.APPLY === '1';
  const reportJson = process.env.REPORT_JSON
    || path.join(REPO_ROOT, 'bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.json');
  const reportMd = process.env.REPORT_MD
    || path.join(REPO_ROOT, 'bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.md');

  const beforeCounts = await withClient(DB_PORTS.python_ai, 'python_ai', (c) => fetchCounts(c, userId));

  const sourceRows = await withClient(DB_PORTS.notification, 'notification', async (client) => {
    const r = await client.query(
      `SELECT id::text, user_id::text, event_type, channel::text, status::text, payload, created_at
       FROM notification.notifications
       WHERE user_id = $1::uuid`,
      [userId],
    );
    return r.rows;
  });
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));

  const aiDocs = await withClient(DB_PORTS.python_ai, 'python_ai', async (client) => {
    const r = await client.query(
      `SELECT id::text, source_id, metadata
       FROM ai.ai_documents
       WHERE source_type = $1 AND owner_user_id = $2`,
      [SOURCE_TYPE, userId],
    );
    return r.rows;
  });

  const stats = {
    target_user_id: userId,
    mode: apply ? 'apply' : 'dry-run',
    matching_ai_notification_docs: aiDocs.length,
    updated: 0,
    skipped_unchanged: 0,
    skipped_missing_source: 0,
    gained: Object.fromEntries(ENTITY_KEYS.map((k) => [k, 0])),
    chunks_touched: 0,
    embeddings_touched: 0,
    text_content_changed: 0,
  };

  await withClient(DB_PORTS.python_ai, 'python_ai', async (client) => {
    for (const doc of aiDocs) {
      const source = sourceById.get(doc.source_id);
      if (!source) {
        stats.skipped_missing_source += 1;
        continue;
      }

      const oldMeta = parseMeta(doc.metadata);
      const newMeta = normalizeNotification(source).metadata ?? {};
      if (metadataEqual(oldMeta, newMeta)) {
        stats.skipped_unchanged += 1;
        continue;
      }

      const gained = gainedKeys(oldMeta, newMeta);
      for (const k of ENTITY_KEYS) {
        if (gained[k]) stats.gained[k] += 1;
      }

      if (apply) {
        const res = await client.query(
          `UPDATE ai.ai_documents
           SET metadata = $1::jsonb, updated_at = now()
           WHERE id = $2::uuid
             AND source_type = $3
             AND owner_user_id = $4
             AND metadata IS DISTINCT FROM $1::jsonb`,
          [JSON.stringify(newMeta), doc.id, SOURCE_TYPE, userId],
        );
        if (res.rowCount > 0) stats.updated += 1;
        else stats.skipped_unchanged += 1;
      } else {
        stats.updated += 1;
      }
    }
  });

  const afterCounts = await withClient(DB_PORTS.python_ai, 'python_ai', (c) => fetchCounts(c, userId));

  const noTouchProof = {
    notification_docs_unchanged:
      beforeCounts.global.notification_docs === afterCounts.global.notification_docs,
    embedded_chunks_unchanged:
      beforeCounts.global.embedded_notification_chunks
      === afterCounts.global.embedded_notification_chunks,
    user_chunks_unchanged:
      beforeCounts.chunks.chunk_count === afterCounts.chunks.chunk_count,
    user_embedded_chunks_unchanged:
      beforeCounts.chunks.embedded_chunk_count === afterCounts.chunks.embedded_chunk_count,
  };

  const result = {
    ticket: 'T20.10N',
    generated_at: new Date().toISOString(),
    apply,
    writes_performed: apply ? stats.updated : 0,
    stats,
    before: beforeCounts,
    after: afterCounts,
    no_touch_proof: noTouchProof,
    backup_hint: process.env.BACKUP_TIMESTAMP ?? null,
  };

  fs.mkdirSync(path.dirname(reportJson), { recursive: true });
  fs.writeFileSync(reportJson, `${JSON.stringify(result, null, 2)}\n`);

  const md = [
    '# T20.10N — Notification metadata-only refresh',
    '',
    `**Generated:** ${result.generated_at}`,
    `**Mode:** ${apply ? 'APPLY (actual write)' : 'dry-run'}`,
    `**TARGET_USER_ID:** \`${userId}\``,
    '',
    '## Results',
    '',
    `| Metric | Count |`,
    `|--------|------:|`,
    `| Updated docs | ${stats.updated} |`,
    `| Skipped unchanged | ${stats.skipped_unchanged} |`,
    `| Gained listing_id | ${stats.gained.listing_id} |`,
    `| Gained offer_id | ${stats.gained.offer_id} |`,
    `| Chunks touched | ${stats.chunks_touched} |`,
    `| Embeddings touched | ${stats.embeddings_touched} |`,
    '',
    '## Global SQL before/after',
    '',
    '| Metric | Before | After |',
    '|--------|-------:|------:|',
    `| notification docs | ${beforeCounts.global.notification_docs} | ${afterCounts.global.notification_docs} |`,
    `| embedded notification chunks | ${beforeCounts.global.embedded_notification_chunks} | ${afterCounts.global.embedded_notification_chunks} |`,
    `| docs with entity metadata | ${beforeCounts.global.notification_docs_with_entity_metadata} | ${afterCounts.global.notification_docs_with_entity_metadata} |`,
    '',
    '## Contract user',
    '',
    `| Metric | Before | After |`,
    `|--------|-------:|------:|`,
    `| notification docs | ${beforeCounts.user.notification_docs} | ${afterCounts.user.notification_docs} |`,
    `| with listing_id | ${beforeCounts.user.with_listing_id} | ${afterCounts.user.with_listing_id} |`,
    `| embedded chunks | ${beforeCounts.chunks.embedded_chunk_count} | ${afterCounts.chunks.embedded_chunk_count} |`,
    '',
  ].join('\n');
  fs.writeFileSync(reportMd, md);

  console.log(`✅ T20.10N ${apply ? 'actual' : 'dry-run'} complete`);
  console.log(`   updated: ${stats.updated}`);
  console.log(`   gained listing_id: ${stats.gained.listing_id}`);
  console.log(`   chunks/embeddings touched: ${stats.chunks_touched}/${stats.embeddings_touched}`);
  console.log(`   entity metadata global: ${beforeCounts.global.notification_docs_with_entity_metadata} → ${afterCounts.global.notification_docs_with_entity_metadata}`);
  console.log(`   JSON: ${reportJson}`);

  const proofOk = Object.values(noTouchProof).every(Boolean);
  if (apply && !proofOk) {
    console.error('FAIL: chunk/embedding/doc count proof failed');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
