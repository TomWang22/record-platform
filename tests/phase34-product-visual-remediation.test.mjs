/**
 * Phase 34 visual harness remediation — geometry, contact sheets, readiness, telemetry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  measurePageHeightGeometry,
  assertScreenshotGeometryAllowed,
  MAX_NORMAL_PAGE_HEIGHT_RATIO,
} from '../scripts/lib/phase34-product-screenshot-geometry.mjs';
import {
  captureProductScreenshot,
  generateContactSheets,
} from '../scripts/lib/phase34-product-screenshots.mjs';
import {
  assertTerminalPanelReady,
  TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING,
} from '../scripts/lib/phase34-product-terminal-readiness.mjs';
import {
  derivePipelineObservationFromResponse,
  assertRequiredComponentsObserved,
} from '../scripts/lib/phase34-product-pipeline-observation.mjs';
import { buildObservedInvocationLedger, INVOCATION_STATUS } from '../scripts/lib/phase34-product-runtime-pins.mjs';
import { CAPABILITY_SURFACE_REGISTRY } from '../scripts/lib/phase34-product-journeys/adapters.mjs';
import { createMockPlaywrightPage } from '../scripts/lib/phase34-product-mock-page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('height ratio > 4 fails with VISUAL_PAGE_HEIGHT_PATHOLOGY', () => {
  const geo = {
    viewport_height: 1024,
    document_scroll_height: 110000,
    document_client_height: 1024,
    body_scroll_height: 110000,
    height_ratio: 110000 / 1024,
  };
  assert.ok(geo.height_ratio > MAX_NORMAL_PAGE_HEIGHT_RATIO);
  assert.throws(
    () => assertScreenshotGeometryAllowed(geo, { route: '/messages', session_id: 's1', turn_id: 't1' }),
    (err) => err.code === 'VISUAL_PAGE_HEIGHT_PATHOLOGY',
  );
});

test('110000-pixel screenshots are rejected before pack inclusion', () => {
  assert.throws(
    () =>
      assertScreenshotGeometryAllowed(
        {
          viewport_height: 1024,
          document_scroll_height: 110000,
          height_ratio: 110000 / 1024,
        },
        { route: '/messages' },
      ),
    /VISUAL_PAGE_HEIGHT_PATHOLOGY|110000/,
  );
});

test('unbounded fullPage capture is rejected by default capture path', async () => {
  const page = createMockPlaywrightPage({
    capability: 'negotiation_assistance',
    documentHeight: 110000,
    viewport: { width: 768, height: 1024 },
  });
  await assert.rejects(
    () =>
      captureProductScreenshot(page, {
        capability: 'negotiation_assistance',
        scenario_id: 'negotiation__unauthorized__0',
        participant_side: 'seller',
        viewport: { width: 768, height: 1024 },
        state: 'unauthorized_refusal',
        session_id: 'sess_pathology',
        turn_index: 0,
        pack: 'smoke-v3',
        fullPage: true,
      }),
    (err) => err.code === 'VISUAL_PAGE_HEIGHT_PATHOLOGY',
  );
});

test('default product screenshot uses viewport capture (fullPage false)', async () => {
  const page = createMockPlaywrightPage({
    capability: 'scarcity',
    documentHeight: 2000,
    viewport: { width: 1280, height: 720 },
  });
  const row = await captureProductScreenshot(page, {
    capability: 'scarcity',
    scenario_id: 'scarcity__exact__0',
    participant_side: 'buyer',
    viewport: { width: 1280, height: 720 },
    state: 'final',
    session_id: 'sess_viewport',
    turn_index: 0,
    pack: 'smoke-v3',
  });
  assert.equal(page.screenshotCalls[0].fullPage, false);
  assert.ok(row.bytes > 0);
  assert.equal(row.capture_mode, 'viewport');
});

test('terminal readiness fails when loading skeleton is active', () => {
  assert.throws(
    () =>
      assertTerminalPanelReady({
        capability: 'embeddings',
        panelTestId: 'intelligence-embedding-lineage-panel',
        loadingVisible: true,
        spinnerVisible: false,
        ariaBusy: false,
        terminalContentVisible: true,
        skeletonVisible: true,
      }),
    (err) => err.code === TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING,
  );
});

test('contact sheets use bounded thumbnails and resolve file-relative links', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-cs-'));
  const png = path.join(tmp, 'x.png');
  fs.copyFileSync(
    path.join(root, 'scripts/lib/fixtures/min-viewport-320x240.png'),
    png,
  );
  const rows = [
    {
      relative_path: path.relative(root, png),
      absolute_path: png,
      screenshot_id: 'ss_abc',
      state: 'final',
      capability: 'scarcity',
      viewport: 'desktop',
      viewport_width: 1280,
      viewport_height: 720,
      bytes: 1000,
      session_id: 'sess_1',
      turn_index: 0,
      image_width: 320,
      image_height: 240,
    },
  ];
  const sheetsDir = path.join(tmp, 'contact-sheets');
  generateContactSheets(rows, sheetsDir);
  const html = fs.readFileSync(path.join(sheetsDir, 'combined.html'), 'utf8');
  assert.match(html, /max-height:\s*480px/);
  assert.match(html, /object-fit:\s*contain/);
  assert.doesNotMatch(html, /height:\s*110000/);
  assert.match(html, /href=/);
  assert.match(html, /src="\.\.\/x\.png"/);
  assert.ok(fs.existsSync(path.join(sheetsDir, '../x.png')));
});

test('1x1 screenshots are rejected', async () => {
  const { assertCapturedImageBounds } = await import(
    '../scripts/lib/phase34-product-screenshot-geometry.mjs'
  );
  assert.throws(
    () =>
      assertCapturedImageBounds({
        width: 1,
        height: 1,
        bytes: 70,
        viewport_height: 720,
        capture_mode: 'viewport',
        state: 'final',
      }),
    (err) => err.code === 'VISUAL_SCREENSHOT_TOO_SMALL',
  );
});

test('capability identity rejects valuation journey showing scarcity', async () => {
  const { assertCapabilityCaptureIdentity } = await import(
    '../scripts/lib/phase34-product-capability-identity.mjs'
  );
  assert.throws(
    () =>
      assertCapabilityCaptureIdentity({
        expected_capability: 'valuation',
        mounted_component: 'intelligence-valuation-panel',
        endpoint: '/api/ai/intelligence/valuation',
        panel_title: 'Scarcity intelligence',
        rendered_capability: 'scarcity',
      }),
    (err) => err.code === 'CAPABILITY_IDENTITY_MISMATCH',
  );
});

test('valuation listing-edit is seller-eligible and offers inbox requires offer context', () => {
  const surfaces = CAPABILITY_SURFACE_REGISTRY.valuation.mounted_surfaces;
  const edit = surfaces.find((s) => s.route === '/listings/[id]/edit');
  assert.ok(edit);
  assert.deepEqual(edit.smoke_eligible_sides, ['seller']);
  const offers = surfaces.find((s) => s.route === '/offers/inbox');
  assert.equal(offers.requires_offer_context, true);
});

test('pipeline observation marks required components EXECUTED_AND_OBSERVED', () => {
  const obs = derivePipelineObservationFromResponse({
    capability: 'scarcity',
    responseJson: {
      pipeline_observation: {
        evidence_assembler: { status: 'EXECUTED_AND_OBSERVED', duration_us: 1200 },
        deterministic_engine: { status: 'EXECUTED_AND_OBSERVED', duration_us: 800 },
        schema_validator: { status: 'EXECUTED_AND_OBSERVED', duration_us: 100 },
        evidence_validator: { status: 'EXECUTED_AND_OBSERVED', duration_us: 100 },
        privacy_validator: { status: 'EXECUTED_AND_OBSERVED', duration_us: 100 },
        safety_validator: { status: 'EXECUTED_AND_OBSERVED', duration_us: 100 },
      },
    },
    requestStartedAt: '2026-07-18T12:00:00.000Z',
    requestFinishedAt: '2026-07-18T12:00:00.050Z',
  });
  const ledger = buildObservedInvocationLedger({
    session_id: 'sess_obs',
    turn_id: 'turn_obs',
    pins: { model_tier: 'rule-engine', model_identifier: 'rule-engine', pin_set_hash: 'abc' },
    pipelineObservation: obs,
  });
  assertRequiredComponentsObserved(ledger, 'scarcity');
  const model = ledger.find((r) => r.component === 'model');
  assert.equal(model.observation_status, INVOCATION_STATUS.NOT_INVOKED_BY_POLICY);
  assert.equal(
    ledger.filter((r) => r.observation_status === INVOCATION_STATUS.NOT_INSTRUMENTED).length,
    0,
  );
});

test('NOT_INSTRUMENTED cannot pass a required component', () => {
  const ledger = buildObservedInvocationLedger({
    session_id: 's',
    turn_id: 't',
    pins: { model_tier: 'rule-engine', model_identifier: 'rule-engine' },
    pipelineObservation: {},
  });
  assert.throws(
    () => assertRequiredComponentsObserved(ledger, 'scarcity'),
    (err) => err.code === 'CANARY_BLOCKING_TELEMETRY_GAP',
  );
});

test('canonical surfaces no longer leave required routes PRODUCT_SURFACE_MISSING', () => {
  const required = [
    ['valuation', '/offers/inbox'],
    ['negotiation_assistance', '/offers/inbox'],
    ['auction_intelligence', '/auctions'],
    ['market_analytics', '/profile/collection-stats'],
    ['semantic_search', '/market'],
  ];
  for (const [cap, route] of required) {
    const surfaces = CAPABILITY_SURFACE_REGISTRY[cap].mounted_surfaces;
    const hit = surfaces.find((s) => s.route === route || s.route.startsWith(route));
    assert.ok(hit, `${cap} missing registry entry for ${route}`);
    assert.notEqual(
      hit.status,
      'PRODUCT_SURFACE_MISSING',
      `${cap} ${route} still PRODUCT_SURFACE_MISSING`,
    );
  }
});

test('measurePageHeightGeometry returns ratio fields', async () => {
  const page = createMockPlaywrightPage({
    documentHeight: 2880,
    viewport: { width: 1280, height: 720 },
  });
  const geo = await measurePageHeightGeometry(page);
  assert.equal(geo.viewport_height, 720);
  assert.equal(geo.document_scroll_height, 2880);
  assert.equal(geo.height_ratio, 4);
});
