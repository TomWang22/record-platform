import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertScreenshotDistinctness,
  DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
} from '../scripts/lib/phase34-product-screenshot-distinctness.mjs';
import {
  loadOwnerProofScenarios,
  loadOwnerProofSeedManifest,
  validateOwnerProofExecutableRegistry,
  validateSeedManifestAgainstScenarios,
} from '../scripts/lib/phase34-owner-proof-scenarios.mjs';
import { generateOwnerProofReviewPage } from '../scripts/lib/phase34-owner-proof-review-page.mjs';
import { createOwnerProofLedger } from '../scripts/lib/phase34-owner-proof-ledger.mjs';
import { CAPABILITY_SURFACE_REGISTRY } from '../scripts/lib/phase34-product-journeys/adapters.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('all 24 scenarios validate against executable schema', () => {
  const doc = loadOwnerProofScenarios();
  assert.equal(doc.scenarios.length, 24);
  validateOwnerProofExecutableRegistry(doc);
  for (const scenario of doc.scenarios) {
    assert.equal(scenario.executability, 'FULLY_EXECUTABLE');
  }
});

test('every success scenario has deterministic evidence requirements', () => {
  const scenarios = loadOwnerProofScenarios().scenarios.filter(
    (s) => s.scenario_class === 'A_success',
  );
  assert.equal(scenarios.length, 8);
  for (const scenario of scenarios) {
    assert.ok(scenario.canonical_route);
    assert.ok(scenario.expected_endpoint.startsWith('/api/ai/intelligence/'));
    assert.ok(scenario.terminal_panel_selector);
    assert.ok(scenario.initiating_action_selector);
    assert.ok(scenario.user_intent.length > 10);
    assert.equal(typeof scenario.minimum_evidence, 'number');
    assert.equal(scenario.allow_empty_evidence, false);
  }
});

test('every scenario maps to a mounted canonical route', () => {
  for (const scenario of loadOwnerProofScenarios().scenarios) {
    const reg = CAPABILITY_SURFACE_REGISTRY[scenario.capability];
    assert.ok(reg, scenario.capability);
    const hit =
      (reg.routes || []).includes(scenario.canonical_route) ||
      (reg.mounted_surfaces || []).some(
        (s) => s.status === 'MOUNTED' && s.route === scenario.canonical_route,
      );
    assert.ok(hit, `${scenario.scenario_id} route ${scenario.canonical_route}`);
  }
});

test('every scenario has visible intent mechanism and initiation action', () => {
  for (const scenario of loadOwnerProofScenarios().scenarios) {
    assert.ok(scenario.input_control_selector);
    assert.ok(scenario.initiating_action_selector);
    assert.ok(scenario.initiating_action);
    assert.ok(scenario.input_value.length > 0);
  }
});

test('expected endpoint and terminal selector match capability', () => {
  for (const scenario of loadOwnerProofScenarios().scenarios) {
    assert.equal(scenario.expected_request_capability, scenario.capability);
    assert.match(scenario.expected_endpoint, /^\/api\/ai\/intelligence\//);
    assert.match(scenario.terminal_panel_selector, /intelligence-/);
  }
});

test('seed manifest evidence counts meet capability floors', () => {
  const doc = loadOwnerProofScenarios();
  const manifest = loadOwnerProofSeedManifest();
  validateSeedManifestAgainstScenarios(doc, manifest);
  assert.ok(manifest.evidence_floors.scarcity_success.min_observations >= 5);
  assert.ok(manifest.evidence_floors.valuation_success.min_sold_comparables >= 3);
  assert.ok(manifest.evidence_floors.auction_success.min_watched_lots >= 5);
  assert.ok(manifest.evidence_floors.search_success.min_results >= 5);
  assert.ok(manifest.evidence_floors.recommendations_success.min_rendered_cards >= 5);
  assert.equal(manifest.fixtures.length, 16);
  for (const fixture of manifest.fixtures) {
    assert.ok(fixture.content_hash);
    const cover = fixture.record?.cover_image || '';
    if (cover) {
      assert.doesNotMatch(cover, /picsum|unsplash|loremflickr/i);
    }
    const title = fixture.listing?.title || fixture.record?.title || '';
    if (title && fixture.listing?.status === 'active') {
      assert.doesNotMatch(title, /\[SOLD\]/i);
    }
  }
});

test('negotiation multi-turn requires four distinct turns', () => {
  const scenario = loadOwnerProofScenarios().scenarios.find(
    (s) => s.scenario_id === 'negotiation-four-turn-live',
  );
  assert.ok(scenario);
  assert.equal(scenario.turns.length, 4);
  assert.ok(scenario.turns[0].includes('$35'));
  assert.equal(scenario.turns[3], 'Draft the reply.');
  assert.ok(scenario.required_screenshot_states.length >= 4);
});

test('duplicate screenshots fail distinctness gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p34-exec-dup-'));
  const a = path.join(dir, 'a.png');
  const b = path.join(dir, 'b.png');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(a, png);
  fs.writeFileSync(b, png);
  assert.throws(
    () =>
      assertScreenshotDistinctness(
        [
          { path: a, label: 't1' },
          { path: b, label: 't2' },
        ],
        { maxExactDuplicates: 0 },
      ),
    (err) => err.code === DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loading screenshots cannot satisfy owner proof terminal states', () => {
  for (const scenario of loadOwnerProofScenarios().scenarios) {
    assert.notEqual(scenario.expected_terminal_state, 'loading');
    assert.ok(!scenario.required_screenshot_states.includes('loading'));
    assert.ok(scenario.loading_selectors.length >= 1);
  }
});

test('owner review HTML contains 24 scenario cards and resolving links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p34-review-'));
  const doc = loadOwnerProofScenarios();
  const ledger = createOwnerProofLedger(dir);
  const { indexPath, card_count } = generateOwnerProofReviewPage({
    outRoot: dir,
    scenarios: doc.scenarios,
    ledgerRows: ledger.readAll(),
    screenshotsByScenario: {},
  });
  assert.equal(card_count, 24);
  const html = readFileSync(indexPath, 'utf8');
  assert.equal((html.match(/class="card"/g) || []).length, 24);
  assert.match(html, /negotiation-four-turn-live/);
  for (const s of doc.scenarios) {
    assert.match(html, new RegExp(`id="${s.scenario_id}"`));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rehearsal launcher dry-run reports READY_NOT_LAUNCHED', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['scripts/phase34-launch-owner-proof-rehearsal.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'READY_NOT_LAUNCHED');
  assert.equal(payload.logical_scenarios, 24);
  assert.equal(payload.total_turns, 27);
  assert.equal(payload.protocol_rows, 81);
  assert.equal(payload.rehearsal_root_absent, true);
  assert.equal(existsSync('/tmp/phase34-owner-proof-live-rehearsal-v1'), false);
});

test('visible intent controls exist for all eight capabilities', () => {
  const files = [
    'webapp/components/ai/intelligence/scarcity-intelligence-panel.tsx',
    'webapp/components/ai/intelligence/valuation-intelligence-panel.tsx',
    'webapp/components/ai/intelligence/watchlist-temperature-panel.tsx',
    'webapp/components/ai/intelligence/embedding-lineage-panel.tsx',
    'webapp/components/ai/intelligence/search-intelligence-chrome.tsx',
    'webapp/components/ai/intelligence/negotiation-intelligence-panel.tsx',
    'webapp/components/ai/intelligence/recommendations-intelligence-panel.tsx',
    'webapp/components/ai/intelligence/market-analytics-intelligence-panel.tsx',
  ];
  for (const rel of files) {
    const src = readFileSync(join(root, rel), 'utf8');
    assert.match(
      src,
      /OwnerProofIntentControl|intelligence-owner-proof-intent|intelligence-negotiation-user-intent/,
      rel,
    );
  }
  const shared = readFileSync(
    join(root, 'webapp/components/ai/intelligence/owner-proof-intent-control.tsx'),
    'utf8',
  );
  assert.match(shared, /intelligence-owner-proof-intent/);
});

test('customer UI keeps internal codes out of primary copy path', () => {
  const copy = readFileSync(join(root, 'webapp/lib/ai-customer-copy.ts'), 'utf8');
  assert.match(copy, /SAMPLE_SIZE_BELOW_POLICY/);
  assert.match(copy, /too few/i);
  const shell = readFileSync(
    join(root, 'webapp/components/ai/intelligence/intelligence-panel-shell.tsx'),
    'utf8',
  );
  assert.match(shell, /Developer details/);
  assert.match(shell, /Supporting evidence/);
});
