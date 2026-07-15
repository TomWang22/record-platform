import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanaryManifest,
  validateManifestRows,
  hashManifest,
} from '../scripts/lib/phase33f-manifest.mjs';
import {
  compareNormalizedCapabilityOutputs,
  evaluateTripletParity,
} from '../scripts/lib/phase33f-protocol-parity.mjs';
import { evaluateRetrievalQualityGates } from '../scripts/lib/phase33f-readiness.mjs';

test('canary manifest is 720 probes with required allocations', () => {
  const rows = buildCanaryManifest();
  const v = validateManifestRows(rows);
  assert.equal(v.status, 'PASS', JSON.stringify(v.violations.slice(0, 10)));
  assert.equal(rows.length, 720);
  assert.equal(v.summary.per_protocol.h1, 240);
  assert.equal(v.summary.per_protocol.h2, 240);
  assert.equal(v.summary.per_protocol.h3, 240);
  assert.ok(hashManifest(rows).length === 64);
});

test('manifest rejects production mutation and private fields', () => {
  const rows = buildCanaryManifest();
  rows[0].production_mutation_allowed = true;
  rows[1].principal_fixture = 'user@example.com';
  const v = validateManifestRows(rows);
  assert.equal(v.status, 'FAIL');
  assert.ok(v.violations.some((x) => x.startsWith('production_mutation_allowed')));
  assert.ok(v.violations.some((x) => x.startsWith('private_field')));
});

test('protocol parity tolerates presentation and evidence order only', () => {
  const base = {
    capability: 'scarcity',
    capability_mode: 'exact_pressing',
    schema_version: 'v1',
    subject: { pressing_id: 'p1' },
    exact_pressing_claim: true,
    numeric_result: 1,
    confidence: 0.5,
    abstention: { abstained: false },
    limitations: ['A'],
    safety_decision: 'ok',
    privacy_decision: 'ok',
    ranking_order: ['x'],
    retrieval_mode: 'keyword',
    memory_selection: [],
    evidence_ids: ['e1', 'e2'],
    summary_text: 'one',
  };
  const parity = evaluateTripletParity({
    h1: base,
    h2: { ...base, summary_text: 'two' },
    h3: { ...base, evidence_ids: ['e2', 'e1'], summary_text: 'three' },
  });
  assert.equal(parity.status, 'PASS');
});

test('material parity mismatch is fail', () => {
  const a = {
    capability: 'valuation',
    capability_mode: 'exact_pressing',
    schema_version: 'v1',
    subject: { pressing_id: 'p1' },
    exact_pressing_claim: true,
    numeric_result: 30,
    confidence: 0.7,
    abstention: { abstained: false },
    limitations: [],
    safety_decision: 'ok',
    privacy_decision: 'ok',
    ranking_order: [],
    retrieval_mode: 'keyword',
    memory_selection: [],
    evidence_ids: [],
  };
  const r = compareNormalizedCapabilityOutputs(a, { ...a, numeric_result: 90 });
  assert.equal(r.status, 'FAIL');
  assert.ok(r.material_mismatch_count >= 1);
});

test('retrieval quality gates block semantic_fixture below policy floor', () => {
  const gates = evaluateRetrievalQualityGates();
  assert.equal(gates.status, 'BLOCKED');
  const semantic = gates.failing_policy_metrics.filter((f) => f.mode === 'semantic_fixture');
  assert.ok(semantic.length >= 1);
  const recall = semantic.find((f) => String(f.metric).includes('Recall@5'));
  assert.ok(recall);
  assert.ok(recall.measured < recall.threshold);
});
