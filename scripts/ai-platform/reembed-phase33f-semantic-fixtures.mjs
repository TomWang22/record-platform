#!/usr/bin/env node
/**
 * Recompute non-production fixture vectors on the committed corpus (no production writes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEMANTIC_EMBEDDING,
  buildDocumentEmbedText,
  structuredFixtureEmbed,
  contentHashForText,
} from '../lib/phase33f-semantic-retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(__dirname, 'retrieval-corpus');

function main() {
  const docsPath = path.join(CORPUS, 'documents.json');
  const embPath = path.join(CORPUS, 'embedding-fixture-records.json');
  const docsFile = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
  const embFile = JSON.parse(fs.readFileSync(embPath, 'utf8'));

  for (const doc of docsFile.documents) {
    const text = buildDocumentEmbedText(doc);
    doc.synthetic_vector = structuredFixtureEmbed(text, {
      artist: doc.artist,
      title: String(doc.release_title || doc.title || '').replace(/\([^)]*\)/g, ' ').trim(),
      release_title: String(doc.release_title || doc.title || '').replace(/\([^)]*\)/g, ' ').trim(),
      // Catalog/pressing/color stay out of the stored unit vector (dilution); they
      // are applied at score time via alignedQueryDocVectors when the query asks.
    });
    doc.embedding_version = SEMANTIC_EMBEDDING.embedding_version;
    doc.embedding_dimension = SEMANTIC_EMBEDDING.dimension;
    doc.embedding_content_hash = contentHashForText(text);
  }

  const records = embFile.records.map((rec, idx) => {
    const doc = docsFile.documents[idx % docsFile.documents.length];
    return {
      ...rec,
      model_id: SEMANTIC_EMBEDDING.model_or_fixture_id,
      model_version: SEMANTIC_EMBEDDING.embedding_version,
      dimension: SEMANTIC_EMBEDDING.dimension,
      normalization: SEMANTIC_EMBEDDING.normalization,
      content_hash: doc.embedding_content_hash,
      synthetic_vector: doc.synthetic_vector,
      deletion_state: doc.deletion_state || 'ACTIVE',
      reembedding_required: false,
      distance_metric: SEMANTIC_EMBEDDING.distance_metric,
    };
  });

  fs.writeFileSync(docsPath, `${JSON.stringify(docsFile, null, 2)}\n`);
  fs.writeFileSync(embPath, `${JSON.stringify({ schema_version: 1, records }, null, 2)}\n`);
  const manifestPath = path.join(CORPUS, 'corpus-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    man.embedding_fixture = SEMANTIC_EMBEDDING;
    man.phase33f_semantic_reembed = true;
    fs.writeFileSync(manifestPath, `${JSON.stringify(man, null, 2)}\n`);
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      documents_reembedded: docsFile.documents.length,
      embedding_version: SEMANTIC_EMBEDDING.embedding_version,
      dimension: SEMANTIC_EMBEDDING.dimension,
      production_writes: false,
    }, null, 2)}\n`,
  );
}

main();
