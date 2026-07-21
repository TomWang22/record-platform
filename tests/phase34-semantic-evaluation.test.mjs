/**
 * Phase F — semantic evaluation assertion classes, dossier, corpus expand, CI dry-run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMANTIC_ASSERTION_CLASSES,
  CORE_SEMANTIC_GATES,
  HUMAN_QUALITY_FLOOR,
  HUMAN_QUALITY_DIMENSIONS,
  evaluateAssertionClass,
  evaluateSemanticGates,
  buildSemanticResponseDossier,
  scoreHumanQualityRubric,
  assertHumanQualityFloor,
  assertSemanticGatesPass,
} from '../scripts/lib/phase34-semantic-evaluation.mjs';
import {
  buildCompactCorpus,
  expandCorpus,
  evaluateCorpus,
  runCorpusCiDryRun,
  corpusCapabilitySessionCounts,
  writeCompactCorpus,
  loadCompactCorpus,
  MIN_COMPACT_EVALUATED_TURNS,
  MIN_EXPANDED_EVALUATED_TURNS,
  CUSTOMER_FACING,
} from '../scripts/lib/phase34-semantic-corpus.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function goodDossier(overrides = {}) {
  return buildSemanticResponseDossier({
    capability: 'valuation',
    session_id: 'sess-test',
    turn_id: 'turn-1',
    scenario_id: 'valuation-success',
    scenario_class: 'A_success',
    customer_text: 'Fair range is $40 to $48 from two authorized settled comps.',
    key_values: { sold_count: 2, fair_low: 40, fair_high: 48 },
    calc_values: [40, 48, 2],
    included_event_ids: ['sale-1', 'sale-2'],
    excluded_event_ids: [
      { id: 'bad-1', decision: 'EXCLUDED_RIGHTS', reason: 'forbidden', rights_status: 'FORBIDDEN' },
    ],
    evidence_items: [
      {
        id: 'sale-1',
        evidence_id: 'sale-1',
        included: true,
        rights_status: 'FIRST_PARTY',
        event_type: 'SALE_COMPLETED',
        price: 40,
      },
      {
        id: 'sale-2',
        evidence_id: 'sale-2',
        included: true,
        rights_status: 'FIRST_PARTY',
        event_type: 'SALE_COMPLETED',
        price: 48,
      },
    ],
    claim_ledger: {
      claim_ledger_id: 'cl-test',
      verification_status: 'PASS',
      entries: [
        {
          claim_id: 'c-sold',
          claim_type: 'sold_count',
          normalized_claim_value: 2,
          expected_count: 2,
          material: true,
          supporting_snapshot_item_ids: ['sale-1', 'sale-2'],
          verification_result: 'SUPPORTED',
        },
      ],
    },
    subject_resolution: { match_status: 'MATCHED_EXACT_PRESSING' },
    retrieval_execution: {
      requested_mode: 'keyword',
      executed_mode: 'keyword',
      vector_executed: false,
    },
    ...overrides,
  });
}

test('F1: all assertion classes are defined and evaluate', () => {
  assert.equal(SEMANTIC_ASSERTION_CLASSES.length, 12);
  const d = goodDossier();
  for (const cls of SEMANTIC_ASSERTION_CLASSES) {
    const r = evaluateAssertionClass(cls, d);
    assert.ok(['PASS', 'FAIL', 'SKIP'].includes(r.status), cls);
  }
  const gates = evaluateSemanticGates(d);
  assert.equal(gates.status, 'PASS');
  assertSemanticGatesPass(gates, { classes: CORE_SEMANTIC_GATES });
});

test('F1: invention fails when unsupported money appears', () => {
  const d = goodDossier({
    customer_text: 'Fair range is $999 from thin air.',
    key_values: { sold_count: 2, fair_low: 40, fair_high: 48 },
    calc_values: [40, 48, 2],
  });
  // Rebuild gates against mutated text
  const invented = {
    ...d,
    customer_text: 'Fair range is $999 from thin air.',
    full_response_text: 'Fair range is $999 from thin air.',
    direct_answer: 'Fair range is $999 from thin air.',
  };
  const r = evaluateAssertionClass('no_invention', invented);
  assert.equal(r.status, 'FAIL');
  assert.ok(r.reasons.some((x) => /999|unsupported/i.test(x)));
});

test('F1: honest limit passes with empty evidence + limitations', () => {
  const d = buildSemanticResponseDossier({
    capability: 'auction_intelligence',
    session_id: 'sess-hl',
    turn_id: 't-hl',
    scenario_class: 'C_honest_limit',
    honest_limit: true,
    customer_text:
      'No authorized bids are in scope for this empty watchlist subject, so I will not invent auction velocity.',
    key_values: { bid_count: 0 },
    included_event_ids: [],
    excluded_event_ids: [{ id: 'x1', decision: 'EXCLUDED_STALE', reason: 'stale' }],
    limitations: ['INSUFFICIENT_EVIDENCE', 'EMPTY_WATCHLIST_SUBJECT'],
    claim_ledger: {
      claim_ledger_id: 'cl-hl',
      verification_status: 'PASS',
      entries: [
        {
          claim_id: 'c0',
          claim_type: 'bid_count',
          normalized_claim_value: 0,
          expected_count: 0,
          material: true,
          supporting_snapshot_item_ids: [],
          verification_result: 'SUPPORTED',
        },
      ],
    },
    evidence_snapshot: {
      evidence_snapshot_id: 'es-hl',
      evidence_snapshot_hash: 'dddddddddddddddddddddddddddddddd',
    },
  });
  const r = evaluateAssertionClass('honest_limit_correctness', d);
  assert.equal(r.status, 'PASS');
  assertSemanticGatesPass(evaluateSemanticGates(d, { classes: CORE_SEMANTIC_GATES }));
});

test('F1: negotiation correction recomputation case', () => {
  const d = buildSemanticResponseDossier({
    capability: 'negotiation_assistance',
    session_id: 'nego-corr',
    turn_id: 't2',
    scenario_class: 'B_correction',
    customer_text: 'Updated: shipping is $5, not $6. Recalculated using the corrected shipping fact.',
    key_values: { shipping_amount_usd: 5, prior_shipping_amount_usd: 6 },
    calc_values: [5, 6],
    what_changed: 'Shipping corrected from $6 to $5',
    included_event_ids: ['nego-1'],
    evidence_items: [
      {
        id: 'nego-1',
        evidence_id: 'nego-1',
        included: true,
        rights_status: 'FIRST_PARTY',
        event_type: 'ASKING_LISTING',
      },
    ],
    session_facts: [
      {
        fact_id: 'f1',
        key: 'shipping_amount_usd',
        value: 6,
        active: false,
        authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
      },
      {
        fact_id: 'f2',
        key: 'shipping_amount_usd',
        value: 5,
        active: true,
        authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
        supersedes_fact_id: 'f1',
      },
    ],
    correction_record: {
      superseded_fact_id: 'f1',
      recomputed: true,
      retrieval_checkpoint_created: true,
      retrieval_checkpoint_id: 'rcp-1',
      what_changed: 'shipping 6→5',
    },
    evidence_snapshot: {
      evidence_snapshot_id: 'es-corr',
      evidence_snapshot_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
    extra: {},
  });
  const withPre = {
    ...d,
    pre_correction_evidence_snapshot_hash: 'ffffffffffffffffffffffffffffffff',
    material_correction: true,
    pipeline_recomputed: true,
  };
  assert.equal(evaluateAssertionClass('correction_recomputation', withPre).status, 'PASS');
  assert.equal(evaluateAssertionClass('session_fact_authority', withPre).status, 'PASS');
  assert.equal(evaluateAssertionClass('no_invention', withPre).status, 'PASS');
});

test('F4: human quality rubric floor constant and scoring', () => {
  assert.equal(HUMAN_QUALITY_FLOOR.average_min, 3.0);
  assert.equal(HUMAN_QUALITY_DIMENSIONS.length, 10);
  const q = scoreHumanQualityRubric(goodDossier());
  assert.equal(q.floor_met, true);
  assertHumanQualityFloor(q);
  const leaky = scoreHumanQualityRubric({
    ...goodDossier(),
    customer_text: 'engine_invoked=true NOT_INVOKED_BY_POLICY',
    full_response_text: 'engine_invoked=true NOT_INVOKED_BY_POLICY',
    direct_answer: 'engine_invoked=true NOT_INVOKED_BY_POLICY',
  });
  assert.ok(leaky.scores.technical_leakage <= 1);
});

test('F2: compact corpus covers 8 capabilities and session floors', () => {
  const corpus = buildCompactCorpus();
  assert.ok(corpus.evaluated_turn_count >= MIN_COMPACT_EVALUATED_TURNS);
  const counts = corpusCapabilitySessionCounts(corpus);
  for (const cap of Object.keys(counts)) {
    assert.ok(counts[cap] >= 1, `missing ${cap}`);
  }
  for (const cap of CUSTOMER_FACING) {
    assert.ok(counts[cap] >= 10, `${cap} sessions ${counts[cap]} < 10`);
  }
  const nego = corpus.sessions.find((s) => s.session_id === 'nego-sess-01');
  assert.ok(nego);
  const tags = nego.turns.map((t) => t.dossier.scenario_id);
  for (const need of [
    'shipping_change',
    'condition_change',
    'floor_change',
    'tone_change',
    'fabricate_leverage_refuse',
    'draft_insert',
    'cancel_send',
    'confirm_send',
    'memory_correction',
    'forget',
  ]) {
    assert.ok(tags.some((t) => String(t).includes(need)), `missing nego ${need}`);
  }
  const auc = corpus.sessions.find((s) => s.session_id === 'auction-sess-01');
  for (const need of [
    'bid_history_variation',
    'watcher_rich_bid_light',
    'acceleration',
    'clustered_endings',
    'underpriced',
    'overheated',
    'no_bid_honest_limit',
    'window_24h_correction',
  ]) {
    assert.ok(
      auc.turns.some((t) => String(t.dossier.scenario_id).includes(need)),
      `missing auction ${need}`,
    );
  }
});

test('F2: expandCorpus reaches >=500 evaluated turns deterministically', () => {
  const a = expandCorpus('phase34-ci-expand-v1', { compact: buildCompactCorpus() });
  const b = expandCorpus('phase34-ci-expand-v1', { compact: buildCompactCorpus() });
  assert.ok(a.evaluated_turn_count >= MIN_EXPANDED_EVALUATED_TURNS);
  assert.equal(a.evaluated_turn_count, b.evaluated_turn_count);
  assert.equal(a.turns[100].turn_id, b.turns[100].turn_id);
  assert.equal(a.turns[100].dossier.evidence_snapshot_hash, b.turns[100].dossier.evidence_snapshot_hash);
});

test('F2: CI runner dry-run PASS on expanded corpus for core gates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-sem-corpus-'));
  writeCompactCorpus(dir);
  const loaded = loadCompactCorpus(dir);
  assert.ok(loaded.evaluated_turn_count >= MIN_COMPACT_EVALUATED_TURNS);
  const result = runCorpusCiDryRun({
    seed: 'phase34-ci-expand-v1',
    minTurns: MIN_EXPANDED_EVALUATED_TURNS,
    corpusDir: dir,
  });
  assert.equal(result.ok, true);
  assert.ok(result.expanded_evaluated_turn_count >= MIN_EXPANDED_EVALUATED_TURNS);
  assert.equal(result.evaluation_status, 'PASS');
  const expanded = expandCorpus('phase34-ci-expand-v1', { compact: loaded });
  const ev = evaluateCorpus(expanded, { coreOnly: true });
  assert.equal(ev.status, 'PASS');
  assert.equal(ev.fail_count, 0);
});
