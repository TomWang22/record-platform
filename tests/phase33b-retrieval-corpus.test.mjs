import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { validatePhase33bRetrievalCorpus } from '../scripts/lib/phase33b-retrieval-corpus.mjs';
import {
  evaluateMode,
  ndcgAt,
  scoreDocument,
} from '../scripts/lib/phase33b-retrieval-metrics.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO_ROOT, 'scripts/ai-platform');
const CLI = path.join(SRC, 'verify-phase33b-retrieval-corpus.mjs');
const EVAL_CLI = path.join(SRC, 'evaluate-retrieval-corpus.mjs');

let tmpRoot;
let packageRoot;

function corpusPath(...parts) {
  return path.join(packageRoot, 'retrieval-corpus', ...parts);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function validate() {
  return validatePhase33bRetrievalCorpus(REPO_ROOT, { packageRoot });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase33b-corpus-'));
  packageRoot = path.join(tmpRoot, 'ai-platform');
  fs.cpSync(SRC, packageRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('phase33b retrieval corpus', () => {
  it('valid complete package', () => {
    const report = validatePhase33bRetrievalCorpus(REPO_ROOT);
    assert.equal(report.status, 'PASS', report.violations.join('\n'));
    assert.ok(report.counts.queries >= 300);
    assert.ok(report.counts.documents >= 1500);
    assert.ok(report.counts.judgments >= 5000);
  });

  it('CLI emits JSON on stdout', () => {
    const result = spawnSync(process.execPath, [CLI], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'PASS');
  });

  it('duplicate query ID', () => {
    const doc = readJson(corpusPath('queries.json'));
    doc.queries.push({ ...doc.queries[0] });
    writeJson(corpusPath('queries.json'), doc);
    assert.ok(validate().violations.some((v) => v.startsWith('duplicate_query_id:')));
  });

  it('duplicate document ID', () => {
    const doc = readJson(corpusPath('documents.json'));
    doc.documents.push({ ...doc.documents[0] });
    writeJson(corpusPath('documents.json'), doc);
    assert.ok(validate().violations.some((v) => v.startsWith('duplicate_document_id:')));
  });

  it('missing judgment reference', () => {
    const doc = readJson(corpusPath('relevance-judgments.json'));
    doc.judgments[0].document_id = 'doc_does_not_exist';
    writeJson(corpusPath('relevance-judgments.json'), doc);
    assert.ok(validate().violations.some((v) => v.startsWith('missing_judgment_document_ref:')));
  });

  it('invalid relevance grade', () => {
    const doc = readJson(corpusPath('relevance-judgments.json'));
    doc.judgments[0].relevance_grade = 9;
    writeJson(corpusPath('relevance-judgments.json'), doc);
    assert.ok(validate().violations.some((v) => v.startsWith('invalid_relevance_grade:')));
  });

  it('hard negative marked exact match', () => {
    const doc = readJson(corpusPath('hard-negatives.json'));
    doc.hard_negatives[0].exact_pressing_match = true;
    writeJson(corpusPath('hard-negatives.json'), doc);
    assert.ok(validate().violations.some((v) => v.startsWith('hard_negative_marked_exact_match:')));
  });

  it('private result marked authorized for wrong user', () => {
    const docs = readJson(corpusPath('documents.json'));
    const privateDoc = docs.documents.find((d) => d.privacy_class === 'OWNER_PRIVATE');
    const judgments = readJson(corpusPath('relevance-judgments.json'));
    judgments.judgments.push({
      query_id: readJson(corpusPath('queries.json')).queries[0].query_id,
      document_id: privateDoc.document_id,
      relevance_grade: -1,
      exact_release_match: false,
      exact_pressing_match: false,
      condition_match: false,
      authorized: true,
      fresh: true,
      reason_codes: ['bad'],
    });
    writeJson(corpusPath('relevance-judgments.json'), judgments);
    assert.ok(validate().violations.some((v) => v.startsWith('private_result_marked_authorized:')));
  });

  it('invalid content hash', () => {
    const emb = readJson(corpusPath('embedding-fixture-records.json'));
    emb.records[0].content_hash = 'not-a-hash';
    writeJson(corpusPath('embedding-fixture-records.json'), emb);
    assert.ok(validate().violations.some((v) => v.startsWith('invalid_content_hash:')));
  });

  it('invalid embedding dimension', () => {
    const emb = readJson(corpusPath('embedding-fixture-records.json'));
    emb.records[0].dimension = -1;
    writeJson(corpusPath('embedding-fixture-records.json'), emb);
    assert.ok(validate().violations.some((v) => v.startsWith('invalid_embedding_dimension:')));
  });

  it('missing source version', () => {
    const emb = readJson(corpusPath('embedding-fixture-records.json'));
    emb.records[0].source_version = '';
    writeJson(corpusPath('embedding-fixture-records.json'), emb);
    assert.ok(validate().violations.some((v) => v.includes('missing_embedding_field') || v.includes('missing_source_version')));
  });

  it('missing authorization scope', () => {
    const emb = readJson(corpusPath('embedding-fixture-records.json'));
    emb.records[0].authorization_scope = 'not_a_scope';
    writeJson(corpusPath('embedding-fixture-records.json'), emb);
    assert.ok(validate().violations.some((v) => v.startsWith('missing_authorization_scope:')));
  });

  it('metric calculation correctness', () => {
    assert.equal(ndcgAt([3, 2, 0], 3) > 0, true);
    const score = scoreDocument('keyword', 'miles davis blue', {
      title: 'Miles Davis Kind of Blue',
      text: 'miles davis vinyl',
    });
    assert.ok(score > 0);
  });

  it('keyword/semantic silent fallback forbidden', () => {
    assert.throws(() => scoreDocument('vector_prod', 'q', { title: 'x' }), /unsupported_mode/);
  });

  it('grouped metric correctness and zero-result / abstention', () => {
    const report = evaluateMode({
      mode: 'keyword',
      queries: [
        {
          query_id: 'q1',
          text: 'zzzz-no-match-unique',
          capability_id: 'semantic_search',
          query_class: 'abstention',
          participant_side: 'buyer',
          experience_level: 'novice',
          data_density_class: 'sparse',
          language_noise_class: 'clean',
          requesting_principal_fixture: 'principal_fixture_buyer_a',
          authorized_scopes: ['public_market'],
          prohibited_scopes: [],
          expect_abstention: true,
          expected_gate: 'abstain',
        },
      ],
      documents: [
        {
          document_id: 'd1',
          title: 'unrelated',
          text: 'cats dogs',
          privacy_class: 'PUBLIC',
          authorization_scope: 'public_market',
          deletion_state: 'ACTIVE',
        },
      ],
      judgments: [],
    });
    assert.equal(report.global.zero_result_rate, 1);
    assert.ok(report.by_capability.semantic_search);
  });

  it('deleted source not returned', () => {
    const report = evaluateMode({
      mode: 'keyword',
      queries: [
        {
          query_id: 'q1',
          text: 'miles pressing',
          capability_id: 'semantic_search',
          query_class: 'exact_pressing',
          participant_side: 'buyer',
          experience_level: 'novice',
          data_density_class: 'medium',
          language_noise_class: 'clean',
          requesting_principal_fixture: 'principal_fixture_buyer_a',
          authorized_scopes: ['public_market'],
          prohibited_scopes: [],
        },
      ],
      documents: [
        {
          document_id: 'd_del',
          title: 'miles pressing',
          text: 'miles pressing',
          privacy_class: 'PUBLIC',
          authorization_scope: 'public_market',
          deletion_state: 'DELETED',
        },
        {
          document_id: 'd_ok',
          title: 'miles pressing active',
          text: 'miles pressing active',
          privacy_class: 'PUBLIC',
          authorization_scope: 'public_market',
          deletion_state: 'ACTIVE',
        },
      ],
      judgments: [
        {
          query_id: 'q1',
          document_id: 'd_ok',
          relevance_grade: 3,
          authorized: true,
          exact_release_match: true,
          exact_pressing_match: true,
        },
      ],
    });
    assert.equal(report.global.deleted_source_retrieval_rate, 0);
    assert.ok(report.per_query[0].top_document_ids.includes('d_ok'));
    assert.ok(!report.per_query[0].top_document_ids.includes('d_del'));
  });

  it('evaluator offline fixtures succeed', () => {
    const out = path.join(tmpRoot, 'eval-out');
    const result = spawnSync(process.execPath, [EVAL_CLI, '--out', out], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'PASS');
    assert.ok(fs.existsSync(path.join(out, 'retrieval-metrics.json')));
    assert.ok(fs.existsSync(path.join(out, 'final-report.md')));
  });
});
