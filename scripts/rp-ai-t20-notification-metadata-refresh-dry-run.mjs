#!/usr/bin/env node
/**
 * T20.10M — Bounded notification metadata refresh dry-run (read-only).
 * Compares existing python_ai notification docs vs T20.10L normalization.
 * Performs zero writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeNotification,
  extractNotificationEntityMetadata,
} from './lib/rp-ai-normalize-documents.mjs';
import { withClient, DB_PORTS } from './lib/rp-ai-rag-db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const ENTITY_KEYS = ['listing_id', 'record_id', 'offer_id', 'auction_id', 'bid_id'];

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function entityKeysPresent(meta) {
  const out = {};
  for (const k of ENTITY_KEYS) {
    out[k] = Boolean(meta?.[k]);
  }
  return out;
}

function gainedKeys(oldMeta, newMeta) {
  const gained = {};
  for (const k of ENTITY_KEYS) {
    if (!oldMeta?.[k] && newMeta?.[k]) gained[k] = true;
  }
  return gained;
}

function metadataEqual(a, b) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function chunkTextFromRows(rows) {
  return rows
    .sort((x, y) => x.chunk_index - y.chunk_index)
    .map((r) => r.content)
    .join('\n\n');
}

async function fetchGlobalCounts() {
  return withClient(DB_PORTS.python_ai, 'python_ai', async (client) => {
    const docs = await client.query(
      `SELECT COUNT(*)::int AS n FROM ai.ai_documents WHERE source_type = 'notification'`,
    );
    const embedded = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM ai.ai_document_chunks c
       JOIN ai.ai_documents d ON d.id = c.document_id
       WHERE d.source_type = 'notification' AND c.embedding_vec IS NOT NULL`,
    );
    const withEntity = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM ai.ai_documents
       WHERE source_type = 'notification'
         AND (
           metadata ? 'listing_id' OR metadata ? 'record_id' OR metadata ? 'offer_id'
           OR metadata ? 'auction_id' OR metadata ? 'bid_id'
         )`,
    );
    return {
      notification_docs: docs.rows[0].n,
      embedded_notification_chunks: embedded.rows[0].n,
      notification_docs_with_entity_metadata: withEntity.rows[0].n,
    };
  });
}

async function main() {
  const userId = process.env.TARGET_USER_ID;
  if (!userId) {
    console.error('TARGET_USER_ID is required');
    process.exit(2);
  }

  const reportJson = process.env.REPORT_JSON
    || path.join(REPO_ROOT, 'bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.json');
  const reportMd = process.env.REPORT_MD
    || path.join(REPO_ROOT, 'bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.md');

  const beforeCounts = await fetchGlobalCounts();

  const sourceRows = await withClient(DB_PORTS.notification, 'notification', async (client) => {
    const r = await client.query(
      `SELECT id::text, user_id::text, event_type, channel::text, status::text, payload, created_at
       FROM notification.notifications
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC`,
      [userId],
    );
    return r.rows;
  });

  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));

  const { aiDocs, chunksByDocId } = await withClient(DB_PORTS.python_ai, 'python_ai', async (client) => {
    const r = await client.query(
      `SELECT id::text, source_id, owner_user_id, visibility, title, summary,
              source_updated_at, checksum, metadata
       FROM ai.ai_documents
       WHERE source_type = 'notification' AND owner_user_id = $1`,
      [userId],
    );
    const docs = r.rows;
    const docIds = docs.map((d) => d.id);
    const chunksByDocId = new Map();
    if (docIds.length > 0) {
      const chunkRes = await client.query(
        `SELECT document_id::text, chunk_index, content,
                (embedding_vec IS NOT NULL) AS has_embedding
         FROM ai.ai_document_chunks
         WHERE document_id = ANY($1::uuid[])
         ORDER BY document_id, chunk_index`,
        [docIds],
      );
      for (const row of chunkRes.rows) {
        const list = chunksByDocId.get(row.document_id) ?? [];
        list.push(row);
        chunksByDocId.set(row.document_id, list);
      }
    }
    return { aiDocs: docs, chunksByDocId };
  });

  const stats = {
    target_user_id: userId,
    source_notification_rows: sourceRows.length,
    matching_ai_notification_docs: aiDocs.length,
    ai_docs_missing_source_row: 0,
    source_rows_without_ai_doc: 0,
    docs_metadata_unchanged: 0,
    docs_metadata_would_change: 0,
    docs_missing_entity_metadata: 0,
    would_gain: Object.fromEntries(ENTITY_KEYS.map((k) => [k, 0])),
    text_content_would_change: 0,
    checksum_would_change: 0,
    standard_reindex_would_touch_embeddings: 0,
    metadata_only_update_viable: 0,
  };

  const samples = [];

  for (const doc of aiDocs) {
    const oldMeta = parseMeta(doc.metadata);
    const hadEntity = ENTITY_KEYS.some((k) => oldMeta[k]);
    if (!hadEntity) stats.docs_missing_entity_metadata += 1;

    const source = sourceById.get(doc.source_id);
    if (!source) {
      stats.ai_docs_missing_source_row += 1;
      continue;
    }

    const newDoc = normalizeNotification(source);
    const newMeta = newDoc.metadata ?? {};
    const gained = gainedKeys(oldMeta, newMeta);

    const chunks = chunksByDocId.get(doc.id) ?? [];

    const oldText = chunkTextFromRows(chunks);
    const newText = newDoc.normalized_text;
    const textChanged = oldText.trim() !== newText.trim();
    const metaChanged = !metadataEqual(oldMeta, newMeta);
    const checksumChanged = doc.checksum !== newDoc.checksum;
    const hasEmbedding = chunks.some((c) => c.has_embedding);

    if (metaChanged) {
      stats.docs_metadata_would_change += 1;
      for (const k of ENTITY_KEYS) {
        if (gained[k]) stats.would_gain[k] += 1;
      }
    } else {
      stats.docs_metadata_unchanged += 1;
    }

    if (textChanged) stats.text_content_would_change += 1;
    if (checksumChanged) stats.checksum_would_change += 1;
    if (checksumChanged && hasEmbedding) {
      stats.standard_reindex_would_touch_embeddings += 1;
    }
    if (metaChanged && !textChanged) {
      stats.metadata_only_update_viable += 1;
    }

    if (metaChanged && samples.length < 5) {
      samples.push({
        source_id: doc.source_id,
        old_metadata: oldMeta,
        new_metadata: newMeta,
        gained_keys: Object.keys(gained).filter((k) => gained[k]),
        text_changed: textChanged,
        checksum_changed: checksumChanged,
        has_embedding: hasEmbedding,
      });
    }
  }

  const aiSourceIds = new Set(aiDocs.map((d) => d.source_id));
  stats.source_rows_without_ai_doc = sourceRows.filter((r) => !aiSourceIds.has(r.id)).length;

  const afterCounts = await fetchGlobalCounts();

  const noWriteProof = {
    before: beforeCounts,
    after: afterCounts,
    unchanged:
      beforeCounts.notification_docs === afterCounts.notification_docs
      && beforeCounts.embedded_notification_chunks === afterCounts.embedded_notification_chunks
      && beforeCounts.notification_docs_with_entity_metadata
        === afterCounts.notification_docs_with_entity_metadata,
  };

  const payloadAudit = Object.fromEntries(
    ENTITY_KEYS.map((k) => [
      `rows_with_${k}`,
      sourceRows.filter((r) => extractNotificationEntityMetadata(r.payload ?? {})[k]).length,
    ]),
  );

  const result = {
    ticket: 'T20.10M',
    generated_at: new Date().toISOString(),
    mode: 'dry-run-only',
    writes_performed: 0,
    stats,
    payload_audit: payloadAudit,
    no_write_proof: noWriteProof,
    samples,
    notes: [
      'Standard rp-ai-rag-reindex upsert deletes and recreates chunks when checksum changes — would destroy embeddings.',
      'Approved actual refresh should use metadata-only UPDATE (and checksum) without chunk delete.',
    ],
  };

  fs.mkdirSync(path.dirname(reportJson), { recursive: true });
  fs.writeFileSync(reportJson, `${JSON.stringify(result, null, 2)}\n`);

  const md = [
    '# T20.10M — Notification metadata refresh dry-run',
    '',
    `**Generated:** ${result.generated_at}`,
    `**Mode:** dry-run only (zero writes)`,
    `**TARGET_USER_ID:** \`${userId}\``,
    '',
    '## Scope',
    '',
    `| Metric | Count |`,
    `|--------|------:|`,
    `| Source notification rows | ${stats.source_notification_rows} |`,
    `| Matching AI notification docs | ${stats.matching_ai_notification_docs} |`,
    `| AI docs missing source row | ${stats.ai_docs_missing_source_row} |`,
    `| Source rows without AI doc | ${stats.source_rows_without_ai_doc} |`,
    '',
    '## Would-change counts',
    '',
    `| Metric | Count |`,
    `|--------|------:|`,
    `| Docs missing entity metadata today | ${stats.docs_missing_entity_metadata} |`,
    `| Metadata would change | ${stats.docs_metadata_would_change} |`,
    `| Metadata unchanged | ${stats.docs_metadata_unchanged} |`,
    `| Would gain listing_id | ${stats.would_gain.listing_id} |`,
    `| Would gain record_id | ${stats.would_gain.record_id} |`,
    `| Would gain offer_id | ${stats.would_gain.offer_id} |`,
    `| Would gain auction_id | ${stats.would_gain.auction_id} |`,
    `| Would gain bid_id | ${stats.would_gain.bid_id} |`,
    `| Text/content would change | ${stats.text_content_would_change} |`,
    `| Checksum would change | ${stats.checksum_would_change} |`,
    `| Standard reindex would touch embeddings | ${stats.standard_reindex_would_touch_embeddings} |`,
    `| Metadata-only UPDATE viable | ${stats.metadata_only_update_viable} |`,
    '',
    '## Payload audit (source rows)',
    '',
    `| Field | Rows |`,
    `|-------|-----:|`,
    ...ENTITY_KEYS.map((k) => `| ${k} in payload | ${payloadAudit[`rows_with_${k}`] ?? 0} |`),
    '',
    '## No-write proof',
    '',
    '| Metric | Before | After |',
    '|--------|-------:|------:|',
    `| notification docs | ${beforeCounts.notification_docs} | ${afterCounts.notification_docs} |`,
    `| embedded notification chunks | ${beforeCounts.embedded_notification_chunks} | ${afterCounts.embedded_notification_chunks} |`,
    `| docs with entity metadata | ${beforeCounts.notification_docs_with_entity_metadata} | ${afterCounts.notification_docs_with_entity_metadata} |`,
    '',
    `**Unchanged:** ${noWriteProof.unchanged ? 'YES' : 'NO'}`,
    '',
    '## Recommendation',
    '',
    stats.text_content_would_change === 0 && stats.metadata_only_update_viable > 0
      ? '**Approve bounded metadata-only UPDATE** for contract user (not standard reindex upsert).'
      : '**Adjust scope or hold** — review text-change count before any write.',
    '',
    '## Artifacts',
    '',
    `- JSON: \`${reportJson}\``,
    '',
  ].join('\n');

  fs.writeFileSync(reportMd, md);

  console.log(`✅ T20.10M dry-run complete`);
  console.log(`   source rows: ${stats.source_notification_rows}`);
  console.log(`   AI docs: ${stats.matching_ai_notification_docs}`);
  console.log(`   metadata would change: ${stats.docs_metadata_would_change}`);
  console.log(`   metadata-only viable: ${stats.metadata_only_update_viable}`);
  console.log(`   text would change: ${stats.text_content_would_change}`);
  console.log(`   no-write proof: ${noWriteProof.unchanged ? 'PASS' : 'FAIL'}`);
  console.log(`   JSON: ${reportJson}`);
  console.log(`   MD: ${reportMd}`);

  process.exit(noWriteProof.unchanged ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
