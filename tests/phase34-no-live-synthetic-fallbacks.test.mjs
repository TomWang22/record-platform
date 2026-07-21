/**
 * Phase C: fail if ungated live synthetic floors / seed merges / hard-coded comps remain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanLiveSyntheticFallbacks,
  formatFindings,
} from '../scripts/lib/phase34-synthetic-fallback-verifier.mjs';
import {
  assertUnitTestHooksAllowed,
  assertPhase34HooksDisabledInProduction,
  assertNoForceFloorFieldsInLiveBody,
  unitTestHooksAllowed,
} from '../scripts/lib/phase34-synthetic-sales-gate.mjs';
import { analyzeRecommendations } from '../scripts/lib/phase33d-recommendations.mjs';
import { analyzeMarketAnalytics } from '../scripts/lib/phase33e-analytics.mjs';
import { analyzeAuction } from '../scripts/lib/phase33c-auction.mjs';
import { analyzeNegotiation } from '../scripts/lib/phase33d-negotiation.mjs';
import { analyzeScarcity } from '../scripts/lib/phase33c-scarcity.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scanner finds zero ungated live synthetic fallbacks', () => {
  const result = scanLiveSyntheticFallbacks({ root: REPO });
  assert.equal(
    result.ok,
    true,
    `ungated live synthetic paths:\n${formatFindings(result.findings)}`,
  );
});

test('force floors throw without PHASE34_UNIT_TEST_HOOKS', () => {
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  assert.throws(
    () =>
      analyzeAuction({
        analysis_mode: 'watchlist_batch',
        requesting_principal_fixture: 'p1',
        watchlist_owner_principal_fixture: 'p1',
        force_watchlist_floor: true,
      }),
    /PHASE34_UNIT_TEST_HOOKS_REQUIRED|SYNTHETIC_COMPLETED_SALE_PATH_BLOCKED/,
  );
  assert.throws(
    () =>
      analyzeRecommendations({
        requesting_principal_fixture: 'p1',
        recommendation_mode: 'collection_gap',
        force_recommendation_floor: true,
      }),
    /PHASE34_UNIT_TEST_HOOKS_REQUIRED/,
  );
  assert.throws(
    () =>
      analyzeMarketAnalytics({
        requesting_principal_fixture: 'p1',
        analytics_mode: 'release_market_summary',
        force_analytics_floor: true,
      }),
    /PHASE34_UNIT_TEST_HOOKS_REQUIRED/,
  );
  assert.throws(
    () =>
      analyzeNegotiation({
        participant_side: 'seller',
        requesting_principal_fixture: 'p1',
        authorized_thread_id: 't1',
        thread: { thread_id: 't1', participant_principals: ['p1', 'b1'] },
        asking_price: 41,
        force_negotiation_market_floor: true,
      }),
    /PHASE34_UNIT_TEST_HOOKS_REQUIRED/,
  );
});

test('recs/analytics auto-floor does not invent data without hooks', () => {
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  const recs = analyzeRecommendations({
    requesting_principal_fixture: 'p1',
    recommendation_mode: 'collection_gap',
    owner_proof_prompt: 'diversify under $60',
    user_intent: 'diversify under $60',
    candidates: [],
  });
  assert.ok((recs.result.recommendations || []).length < 5);

  const analytics = analyzeMarketAnalytics({
    requesting_principal_fixture: 'p1',
    analytics_mode: 'release_market_summary',
    owner_proof_prompt: 'Blue Note sales',
    user_intent: 'Blue Note sales',
    events: [],
  });
  assert.equal(analytics.result.sample_size ?? 0, 0);
});

test('JP pressing does not invent comps without hooks', () => {
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  const out = analyzeScarcity({
    subject: { pressing_id: 'CL1355-US', catalog_number: 'CL 1355' },
    user_intent: 'I meant the Japanese pressing, not the US mono.',
    candidates: [],
  });
  assert.equal(out.envelope.abstention.abstained, true);
  const blob = JSON.stringify(out);
  assert.doesNotMatch(blob, /jp-pressing-completed-sale/);
});

test('negotiation panel source has no completed-sale-comp hardcodes', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'webapp/components/ai/intelligence/negotiation-intelligence-panel.tsx'),
    'utf8',
  );
  assert.doesNotMatch(src, /completed-sale-comp-/);
});

test('adapters do not seed completed-sale-comp', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'scripts/lib/phase34-product-journeys/adapters.mjs'),
    'utf8',
  );
  assert.doesNotMatch(src, /completed-sale-comp-/);
});

test('production hook guard fails closed', () => {
  assert.throws(
    () =>
      assertPhase34HooksDisabledInProduction({
        NODE_ENV: 'production',
        PHASE34_UNIT_TEST_HOOKS: '1',
      }),
    /PHASE34_HOOKS_FORBIDDEN_IN_PRODUCTION/,
  );
  assert.equal(
    assertPhase34HooksDisabledInProduction({ NODE_ENV: 'development', PHASE34_UNIT_TEST_HOOKS: '1' })
      .ok,
    true,
  );
});

test('live API body rejects force_* without hooks', () => {
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  assert.throws(
    () => assertNoForceFloorFieldsInLiveBody({ force_sold_floor: true }),
    /FORCE_FLOOR_FIELDS_REJECTED/,
  );
  process.env.PHASE34_UNIT_TEST_HOOKS = '1';
  try {
    assert.equal(assertNoForceFloorFieldsInLiveBody({ force_sold_floor: true }).ok, true);
    assert.equal(unitTestHooksAllowed(), true);
    assert.equal(assertUnitTestHooksAllowed('test').ok, true);
  } finally {
    delete process.env.PHASE34_UNIT_TEST_HOOKS;
  }
});

test('python semantic fixtures gate catalog cards', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'services/python-ai-service/app/ai/embedding_semantic_fixtures.py'),
    'utf8',
  );
  assert.match(src, /_unit_test_hooks_allowed/);
  assert.match(src, /FIXTURE_CATALOG_BLOCKED|fixture_catalog_blocked/);
  assert.match(src, /PHASE34_UNIT_TEST_HOOKS/);
});

test('python routes reject force floors outside hooks', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'services/python-ai-service/app/ai/routes.py'),
    'utf8',
  );
  assert.match(src, /FORCE_FLOOR_FIELDS_REJECTED/);
  assert.match(src, /unit_test_hooks_allowed/);
});
