import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEMANTIC_EMBEDDING,
  normalizeQueryText,
  extractStructuredHints,
  structuredFixtureEmbed,
  cosineSimilarity,
  scoreSemanticFixture,
  metadataEligible,
  validateEmbeddingRecord,
  contentHashForText,
  buildDocumentEmbedText,
} from '../scripts/lib/phase33f-semantic-retrieval.mjs';
import {
  keywordScore,
  evaluateMode,
  ndcgAt,
  dcg,
  rankForQuery,
} from '../scripts/lib/phase33b-retrieval-metrics.mjs';
import { assignSplit, loadCommittedSplits, SPLIT_SEED } from '../scripts/lib/phase33f-retrieval-splits.mjs';
import { evaluateRetrievalQualityGates } from '../scripts/lib/phase33f-readiness.mjs';
import { loadCorpus } from '../scripts/lib/phase33b-retrieval-corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.join(__dirname, '../scripts/ai-platform');

test('embedding rejects wrong dimension / zero / NaN', () => {
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]), /dimension/);
  assert.throws(() => cosineSimilarity([0, 0], [0, 0]), /zero/);
  assert.throws(() => cosineSimilarity([1, Number.NaN], [1, 0]), /nan/);
  const viol = validateEmbeddingRecord({
    synthetic_vector: [0, 0, 0],
    dimension: 3,
    embedding_version: 'x',
  });
  assert.ok(viol.includes('zero_vector'));
});

test('content-hash and version contract', () => {
  const h1 = contentHashForText('a');
  const h2 = contentHashForText('b');
  assert.notEqual(h1, h2);
  assert.ok(h1.startsWith('sha256:'));
  assert.equal(SEMANTIC_EMBEDDING.dimension, 96);
  assert.ok(SEMANTIC_EMBEDDING.embedding_version.includes('phase33f'));
});

test('score direction: higher cosine for matching title', () => {
  const q = structuredFixtureEmbed('miles davis kind of blue', { title: 'kind of blue' });
  const good = structuredFixtureEmbed('miles davis kind of blue first pressing', {
    artist: 'Miles Davis',
    title: 'Kind of Blue',
  });
  const bad = structuredFixtureEmbed('flute recital volume two', { title: 'flute recital' });
  assert.ok(cosineSimilarity(q, good) > cosineSimilarity(q, bad));
});

test('catalog abbreviation and misspelling normalization', () => {
  assert.match(normalizeQueryText('CAT 10'), /cat-10/);
  assert.match(normalizeQueryText('Mylas Davis Kynd of Blua'), /miles davis kind of blue/);
  assert.match(normalizeQueryText('dsotm lp'), /dark side of the moon album/);
  const hints = extractStructuredHints('Need P1-1 for CAT-10');
  assert.equal(hints.pressing_id?.toUpperCase(), 'P1-1');
  assert.ok(String(hints.catalog_number || '').toUpperCase().includes('CAT'));
});

test('exact pressing contradiction rejects wrong pressing', () => {
  const q = { text: 'Miles Davis Kind of Blue P1-1', query_class: 'exact_pressing' };
  const ok = metadataEligible(q, { pressing_id: 'P1-1' });
  const bad = metadataEligible(q, { pressing_id: 'P1-9' });
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'EXACT_PRESSING_CONTRADICTION');
});

test('semantic mode does not call keywordScore path', () => {
  const q = { text: 'Miles Davis Kind of Blue', query_class: 'exact_artist_title' };
  const d = {
    document_id: 'doc_release_00001',
    artist: 'Miles Davis',
    release_title: 'Kind of Blue',
    title: 'Kind of Blue',
    color: 'black',
    edition: 'first',
    pressing_id: 'P1-1',
    catalog_number: 'CAT-10',
    text: 'Miles Davis Kind of Blue first pressing black vinyl',
  };
  const sem = scoreSemanticFixture(q, d);
  const kw = keywordScore(q.text, d);
  assert.notEqual(sem.score, kw);
  assert.equal(sem.rejected, false);
  assert.ok(typeof sem.semantic === 'number');
  assert.ok(!Object.values(sem.factors).some((v) => v === kw));
});

test('deleted and private docs never rank', () => {
  const corpus = loadCorpus(PACKAGE);
  const q = corpus.queries.find((x) => x.query_class === 'exact_artist_title');
  const ranked = rankForQuery({
    mode: 'semantic_fixture',
    query: q,
    documents: corpus.documents,
    principalId: q.requesting_principal_fixture,
  });
  assert.ok(ranked.every((r) => r.doc.deletion_state !== 'DELETED'));
  assert.ok(
    ranked.every(
      (r) =>
        !(
          (r.doc.privacy_class === 'OWNER_PRIVATE' || r.doc.privacy_class === 'THREAD_PRIVATE') &&
          r.doc.owner_principal_fixture &&
          r.doc.owner_principal_fixture !== q.requesting_principal_fixture
        ),
    ),
  );
});

test('deterministic tie-breaking is stable', () => {
  const corpus = loadCorpus(PACKAGE);
  const q = corpus.queries[3];
  const a = rankForQuery({
    mode: 'semantic_fixture',
    query: q,
    documents: corpus.documents,
    principalId: q.requesting_principal_fixture,
  })
    .slice(0, 10)
    .map((r) => r.doc.document_id);
  const b = rankForQuery({
    mode: 'semantic_fixture',
    query: q,
    documents: corpus.documents,
    principalId: q.requesting_principal_fixture,
  })
    .slice(0, 10)
    .map((r) => r.doc.document_id);
  assert.deepEqual(a, b);
});

test('metric helpers: MRR-style dcg/ndcg and Recall@K accounting', () => {
  assert.ok(dcg([3, 2, 0], 3) > dcg([0, 0, 3], 3));
  assert.equal(ndcgAt([3, 2, 1], 3), 1);
  assert.ok(ndcgAt([0, 3], 2) < 1);
});

test('frozen holdout split isolation and hash stability', () => {
  const splits = loadCommittedSplits(PACKAGE);
  assert.ok(splits);
  assert.equal(splits.seed, SPLIT_SEED);
  assert.equal(splits.leakage_checks.cross_split_duplicates, 0);
  const setD = new Set(splits.development_ids);
  const setV = new Set(splits.validation_ids);
  const setH = new Set(splits.holdout_ids);
  for (const id of setH) {
    assert.equal(setD.has(id), false);
    assert.equal(setV.has(id), false);
    assert.equal(assignSplit(id), 'holdout');
  }
  const again = loadCommittedSplits(PACKAGE);
  assert.equal(again.holdout_hash, splits.holdout_hash);
  assert.equal(again.development_hash, splits.development_hash);
});

test('holdout semantic metrics meet policy floors', () => {
  const corpus = loadCorpus(PACKAGE);
  const splits = loadCommittedSplits(PACKAGE);
  const idSet = new Set(splits.holdout_ids);
  const queries = corpus.queries.filter((q) => idSet.has(q.query_id));
  const judgments = corpus.judgments.filter((j) => idSet.has(j.query_id));
  const hardNegatives = corpus.hardNegatives.filter((h) => idSet.has(h.query_id));
  const g = evaluateMode({
    mode: 'semantic_fixture',
    queries,
    documents: corpus.documents,
    judgments,
    hardNegatives,
  }).global;
  assert.ok(g.Recall_at_5 >= 0.35, `R@5 ${g.Recall_at_5}`);
  assert.ok(g.Recall_at_10 >= 0.45, `R@10 ${g.Recall_at_10}`);
  assert.ok(g.MRR >= 0.25, `MRR ${g.MRR}`);
  assert.ok(g.nDCG_at_5 >= 0.3, `nDCG@5 ${g.nDCG_at_5}`);
  assert.ok(g.nDCG_at_10 >= 0.35, `nDCG@10 ${g.nDCG_at_10}`);
  assert.ok(g.exact_pressing_accuracy >= 0.5, `ep ${g.exact_pressing_accuracy}`);
  assert.equal(g.cross_user_leakage_rate, 0);
  assert.equal(g.deleted_source_retrieval_rate, 0);
});

test('readiness gates use frozen holdout for semantic and can be READY', () => {
  const gates = evaluateRetrievalQualityGates({ packageRoot: PACKAGE });
  assert.equal(gates.modes.semantic_fixture.evaluation_split, 'holdout');
  assert.equal(gates.split_leakage, 0);
  assert.equal(gates.status, 'READY', JSON.stringify(gates.failing_policy_metrics.slice(0, 8)));
});

test('document embed text keeps pressing ids out of dilution channels', () => {
  const text = buildDocumentEmbedText({
    artist: 'Miles Davis',
    release_title: 'Kind of Blue (Blue Vinyl)',
    title: 'Kind of Blue (Blue Vinyl)',
    catalog_number: 'CAT-11',
    pressing_id: 'P1-2',
    color: 'blue',
    text: 'Miles Davis Kind of Blue first pressing blue vinyl catalog CAT-11',
  });
  assert.match(text, /kind of blue/);
  assert.doesNotMatch(text, /\bcat-11\b/);
  assert.doesNotMatch(text, /\bp1-2\b/);
});

test('split manifest file is present for source control', () => {
  const p = path.join(PACKAGE, 'retrieval-splits', 'phase33f-semantic-splits.json');
  assert.ok(fs.existsSync(p));
});
