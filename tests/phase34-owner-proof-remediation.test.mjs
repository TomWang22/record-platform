/**
 * Phase 34 owner-proof: customer copy, entity consistency, golden 24, screenshot distinctness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
// Customer copy is TS — exercise via dynamic import of compiled path is hard;
// mirror critical rules with the shared mjs entity + scenarios modules and
// by reading the TS source contracts.

import {
  assertEntityConsistency,
  ENTITY_MEDIA_MISMATCH,
  SOLD_STATUS_CONTRADICTION,
} from '../scripts/lib/phase34-product-entity-consistency.mjs';
import {
  assertScreenshotDistinctness,
  DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
} from '../scripts/lib/phase34-product-screenshot-distinctness.mjs';
import {
  loadOwnerProofScenarios,
  validateOwnerProofRegistry,
} from '../scripts/lib/phase34-owner-proof-scenarios.mjs';

test('owner-proof registry has exactly 24 scenarios (3×8)', () => {
  const raw = loadOwnerProofScenarios();
  assert.equal(raw.scenarios.length, 24);
  validateOwnerProofRegistry(raw);
  const nego = raw.scenarios.find((s) => s.scenario_id === 'negotiation-four-turn-live');
  assert.equal(nego.turns.length, 4);
});

test('entity consistency rejects picsum and SOLD+Active', () => {
  assert.throws(
    () =>
      assertEntityConsistency({
        title: 'Kenny Dorham — Quiet Kenny [SOLD]',
        status: 'active',
        images: ['https://picsum.photos/seed/x/400/400'],
      }),
    (err) =>
      err.code === SOLD_STATUS_CONTRADICTION || err.code === ENTITY_MEDIA_MISMATCH,
  );
  const ok = assertEntityConsistency({
    title: 'Kenny Dorham — Quiet Kenny',
    status: 'active',
    images: ['https://placehold.co/800x800/1a2744/c4a35a/png?text=Kenny+Dorham'],
  });
  assert.equal(ok.ok, true);
});

test('duplicate screenshot masquerading as distinct state fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p34-dup-'));
  const a = path.join(dir, 'a.png');
  const b = path.join(dir, 'b.png');
  // Minimal valid 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(a, png);
  fs.writeFileSync(b, png);
  assert.throws(
    () =>
      assertScreenshotDistinctness([
        { path: a, label: 'turn_1' },
        { path: b, label: 'turn_2' },
      ], { maxExactDuplicates: 0 }),
    (err) => err.code === DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('customer copy source maps SAMPLE_SIZE_BELOW_POLICY', () => {
  const src = fs.readFileSync(path.join(REPO, 'webapp/lib/ai-customer-copy.ts'), 'utf8');
  assert.match(src, /SAMPLE_SIZE_BELOW_POLICY/);
  assert.match(src, /too few comparable sales/i);
  const shell = fs.readFileSync(
    path.join(REPO, 'webapp/components/ai/intelligence/intelligence-panel-shell.tsx'),
    'utf8',
  );
  assert.match(shell, /Supporting evidence/);
  assert.match(shell, /What this means for you/);
  assert.match(shell, /Developer details/);
});

test('vinyl cover fixtures exist and seeds no longer reference picsum', () => {
  const covers = path.join(REPO, 'webapp/public/e2e-fixtures/covers');
  assert.ok(fs.existsSync(path.join(covers, 'kenny-dorham.svg')));
  for (const rel of [
    'webapp/e2e/helpers/seed-phase34-dense.ts',
    'webapp/e2e/helpers/seed-marketplace.ts',
    'webapp/e2e/helpers/seed-collection.ts',
    'webapp/e2e/helpers/listing-contract.ts',
  ]) {
    const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.doesNotMatch(text, /picsum\.photos/);
  }
  assert.match(
    fs.readFileSync(path.join(REPO, 'webapp/e2e/helpers/vinyl-cover-fixtures.ts'), 'utf8'),
    /placehold\.co|data:image\/svg\+xml|e2e-fixtures\/covers/,
  );
});

test('smoke launcher defaults to smoke-v6 root', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'scripts/phase34-launch-product-harness-live-smoke.mjs'),
    'utf8',
  );
  assert.match(src, /smoke-v6/);
  assert.match(src, /phase34-product-harness-live-smoke-v6/);
  assert.match(src, /superseded/i);
});

test('negotiation panel exposes visible user intent and four turn presets', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'webapp/components/ai/intelligence/negotiation-intelligence-panel.tsx'),
    'utf8',
  );
  assert.match(src, /intelligence-negotiation-user-intent/);
  assert.match(src, /They offered \$35/);
  assert.match(src, /Draft the reply/);
  assert.match(src, /intelligence-negotiation-session-id/);
  assert.match(src, /intelligence-negotiation-turn-history/);
  assert.doesNotMatch(src, /engine_invoked=/);
});

test('owner-proof rehearsal launcher is armed but not launched', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'scripts/phase34-launch-owner-proof-rehearsal.mjs'),
    'utf8',
  );
  assert.match(src, /READY_NOT_LAUNCHED/);
  assert.match(src, /phase34-owner-proof-live-rehearsal-v2/);
  assert.match(src, /executeOwnerProofLiveRehearsal/);
  assert.match(src, /assertCiApproval\(\{ headSha, originMainSha \}\)/);
  assert.match(src, /rehearsal_requires_live_action_preflight_pass/);
  assert.equal(fs.existsSync('/tmp/phase34-owner-proof-live-rehearsal-v2'), false);
  assert.equal(fs.existsSync('/tmp/phase34-owner-proof-mini-proof-v1'), false);
});

test('live action preflight launcher is armed but not launched', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'scripts/phase34-verify-owner-proof-live-actions.mjs'),
    'utf8',
  );
  assert.match(src, /READY_NOT_LAUNCHED/);
  assert.match(src, /phase34-owner-proof-live-action-preflight-v1/);
  assert.match(src, /executeOwnerProofLiveActionPreflight/);
  assert.equal(fs.existsSync('/tmp/phase34-owner-proof-live-action-preflight-v1'), false);
});

test('scarcity and valuation run controls are capability-scoped', () => {
  const scarcity = fs.readFileSync(
    path.join(REPO, 'webapp/components/ai/intelligence/scarcity-intelligence-panel.tsx'),
    'utf8',
  );
  const valuation = fs.readFileSync(
    path.join(REPO, 'webapp/components/ai/intelligence/valuation-intelligence-panel.tsx'),
    'utf8',
  );
  assert.match(scarcity, /intelligence-scarcity-run/);
  assert.match(valuation, /intelligence-valuation-run/);
  assert.doesNotMatch(scarcity, /runTestId="intelligence-owner-proof-run"/);
  assert.doesNotMatch(valuation, /runTestId="intelligence-owner-proof-run"/);
});
