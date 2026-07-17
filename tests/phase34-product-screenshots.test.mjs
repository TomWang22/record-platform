/**
 * Live Playwright screenshot / accessibility / pin tests (mock Page, real page.screenshot API).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJourneyAdapter } from '../scripts/lib/phase34-product-journeys/adapters.mjs';
import { createMockPlaywrightPage } from '../scripts/lib/phase34-product-mock-page.mjs';
import {
  captureProductScreenshot,
  buildScreenshotFilename,
  projectScreenshotDiskUsage,
  generateContactSheets,
  PLAYWRIGHT_TRACE_POLICY,
  assertScreenshotsBeforePass,
  productScreenshotDir,
} from '../scripts/lib/phase34-product-screenshots.mjs';
import {
  pinFromCommittedRegistry,
  pinFixtureSynthetic,
  assertLivePinsNotSynthetic,
  buildObservedInvocationLedger,
  PIN_SOURCE,
  INVOCATION_STATUS,
} from '../scripts/lib/phase34-product-runtime-pins.mjs';
import { runProductSession, ProductLedgerWriter } from '../scripts/lib/phase34-product-session-runner.mjs';
import { buildInterleavedProductSchedule } from '../scripts/lib/phase34-product-schedule.mjs';
import { executeAccessibilityChecks } from '../scripts/lib/phase34-product-accessibility.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('page.screenshot is actually invoked and writes PNG', async () => {
  const page = createMockPlaywrightPage({ capability: 'scarcity' });
  const row = await captureProductScreenshot(page, {
    capability: 'scarcity',
    scenario_id: 'scarcity__exact__0',
    participant_side: 'buyer',
    viewport: { width: 1280, height: 720 },
    state: 'success',
    session_id: 'sess_abcde123',
    turn_index: 0,
    pack: 'gauntlet',
  });
  assert.equal(page.screenshotCalls.length, 1);
  assert.ok(page.screenshotCalls[0].path.endsWith('.png'));
  assert.ok(fs.existsSync(row.absolute_path));
  assert.equal(row.sha256.length, 64);
  assert.equal(row.visual_review_status, 'OWNER_VISUAL_REVIEW_REQUIRED');
  assert.match(row.relative_path, /webapp\/e2e\/screenshots\/authenticated\/.+\/phase34-product-gauntlet\//);
});

test('live adapter journey calls page.screenshot multiple times and sets accessibility', async () => {
  const adapter = getJourneyAdapter('scarcity');
  const page = createMockPlaywrightPage({
    capability: 'scarcity',
    apiPath: '/api/ai/intelligence/scarcity',
  });
  const prepared = await adapter.prepare({
    session_id: 'sess_live_shot_test',
    turn_id: 'turn_1',
    journey_id: 'journey_1',
    turn_index: 0,
    scenario_id: 'scarcity__record_detail_exact_pressing__0',
    scenario_class: 'record_detail_exact_pressing',
    participant_side: 'buyer',
    authorization_state: 'authorized',
    evidence_strength: 'strong',
  });
  const result = await adapter.executeBrowserJourney(page, prepared);
  assert.ok(page.screenshotCalls.length >= 3, `expected >=3 screenshots, got ${page.screenshotCalls.length}`);
  assert.notEqual(result.accessibility_result, 'NOT_EXECUTED');
  assert.equal(typeof result.horizontal_overflow, 'boolean');
  assert.ok(result.screenshots.length >= 3);
  assertScreenshotsBeforePass(result.screenshots);
  assert.ok(result.screenshot_manifest_entry_ids.length >= 3);
});

test('accessibility execute returns PASS or FAIL not NOT_EXECUTED', async () => {
  const page = createMockPlaywrightPage();
  const a11y = await executeAccessibilityChecks(page, { panelTestId: 'intelligence-scarcity-panel' });
  assert.ok(a11y.accessibility_result === 'PASS' || a11y.accessibility_result === 'FAIL');
  assert.notEqual(a11y.accessibility_result, 'NOT_EXECUTED');
  assert.equal(typeof a11y.horizontal_overflow, 'boolean');
});

test('live registry pins hash actual prompt content', () => {
  const pins = pinFromCommittedRegistry({
    capability: 'scarcity',
    prompt_slot: 1,
    retrieval_mode_requested: 'keyword',
  });
  assert.equal(pins.pin_source, PIN_SOURCE.LIVE_REGISTRY);
  assert.match(pins.prompt_configuration_id, /^scarcity-c01/);
  assert.equal(pins.system_prompt_hash.length, 64);
  // Must not be the naive prompt|<id> synthetic pattern alone as sole proof —
  // hash of real system prompt from registry file.
  const registry = JSON.parse(
    fs.readFileSync(path.join(root, 'scripts/ai-platform/phase34-prompt-registry/scarcity.json'), 'utf8'),
  );
  const system = registry.candidates[0].prompts.system;
  const expected = crypto.createHash('sha256').update(system).digest('hex');
  assert.equal(pins.system_prompt_hash, expected);
  assertLivePinsNotSynthetic(pins);
});

test('fixture synthetic pins are classified and rejected for live', () => {
  const pins = pinFixtureSynthetic({ prompt_configuration_id: 'x' });
  assert.equal(pins.pin_source, PIN_SOURCE.FIXTURE_SYNTHETIC_PIN);
  assert.throws(() => assertLivePinsNotSynthetic(pins));
});

test('invocation ledger uses honest observation statuses', () => {
  const pins = pinFromCommittedRegistry({ capability: 'scarcity', prompt_slot: 1 });
  const inv = buildObservedInvocationLedger({ session_id: 's', turn_id: 't', pins });
  const model = inv.find((i) => i.component === 'model');
  assert.equal(model.observation_status, INVOCATION_STATUS.NOT_INVOKED_BY_POLICY);
  const det = inv.find((i) => i.component === 'deterministic_engine');
  assert.equal(det.observation_status, INVOCATION_STATUS.EXECUTED_NOT_TIMED);
});

test('live session links screenshots to request and H1/H2/H3 ids', async () => {
  const schedule = buildInterleavedProductSchedule({ scale: 'canary', seed: 'shot-link' });
  const row = schedule.rows.find((r) => r.capability === 'scarcity' && r.multi_turn_class === 'single');
  const out = '/tmp/phase34-product-gauntlet-scaffold/live-shot-session';
  fs.rmSync(out, { recursive: true, force: true });
  const ledger = new ProductLedgerWriter(out).ensure();
  const page = createMockPlaywrightPage({
    capability: 'scarcity',
    apiPath: '/api/ai/intelligence/scarcity',
  });
  const result = await runProductSession(row, { page, ledger, fixtureMode: false });
  assert.equal(result.session.evidence_class, 'LIVE_BROWSER');
  assert.equal(result.session.pin_source, PIN_SOURCE.LIVE_REGISTRY);
  assert.ok(result.session.screenshot_count >= 3);
  assert.ok(result.session.link.screenshot_manifest_entry_id);
  assert.ok(result.session.link.canonical_request_hash);
  assert.ok(result.session.link.H1_probe_id);
  assert.notEqual(result.session.accessibility_result, 'NOT_EXECUTED');
  assert.ok(page.screenshotCalls.length >= 3);
});

test('screenshot naming and disk projection', () => {
  const name = buildScreenshotFilename({
    capability: 'negotiation_assistance',
    scenario_id: 'negotiation_assistance__authorized_seller_thread__3',
    participant_side: 'seller',
    viewport: { width: 1280, height: 800 },
    state: 'success',
    session_id: 'sess_7fa2abc',
    turn_index: 3,
  });
  assert.match(name, /negotiation/);
  assert.match(name, /seller/);
  assert.match(name, /desktop/);
  assert.match(name, /success/);
  assert.match(name, /turn03/);
  const proj = projectScreenshotDiskUsage();
  assert.ok(proj.canary.estimated_screenshots >= 240);
  assert.ok(proj.full.estimated_gb > 0);
  assert.equal(PLAYWRIGHT_TRACE_POLICY.screenshots, true);
  const dir = productScreenshotDir('authenticated', 'canary');
  assert.match(dir, /phase34-product-canary/);
});

test('contact sheets generate from manifest rows', () => {
  const out = '/tmp/phase34-product-gauntlet-scaffold/contact-sheets';
  fs.rmSync(out, { recursive: true, force: true });
  const rows = [
    {
      screenshot_id: 'ss_1',
      relative_path: 'webapp/e2e/screenshots/authenticated/2026-07-17/phase34-product-gauntlet/a.png',
      state: 'success',
      capability: 'scarcity',
      viewport: 'desktop',
    },
  ];
  const gen = generateContactSheets(rows, out);
  assert.ok(fs.existsSync(path.join(out, 'combined.html')));
  assert.ok(fs.existsSync(path.join(out, 'visual-gaps.md')));
  assert.equal(gen.visual_review_status, 'OWNER_VISUAL_REVIEW_REQUIRED');
});
