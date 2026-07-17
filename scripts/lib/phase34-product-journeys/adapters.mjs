/**
 * Product journey adapter interface + route/panel registry.
 * Adapters are executable — fixture mode exercises the same capture→reconcile path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_ROUTE_PATHS } from '../phase33f-canary-config.mjs';
import {
  captureProductScreenshot,
  assertScreenshotsBeforePass,
  viewportLabel,
} from '../phase34-product-screenshots.mjs';
import {
  executeAccessibilityChecks,
  observeClientProtocol,
} from '../phase34-product-accessibility.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const PRODUCT_JOURNEY_ADAPTER_VERSION = 'phase34-product-journey-adapter-v1';

/** Actual Next.js routes + mounted panel testids per capability. */
export const CAPABILITY_SURFACE_REGISTRY = Object.freeze({
  scarcity: {
    routes: ['/records/[id]', '/listings/[id]', '/watchlist'],
    panels: ['intelligence-scarcity-panel'],
    components: [
      'webapp/components/ai/intelligence/scarcity-intelligence-panel.tsx',
    ],
    apiPath: CAPABILITY_ROUTE_PATHS.scarcity,
    clientFn: 'fetchScarcityIntelligence',
  },
  valuation: {
    routes: ['/records/[id]', '/sell', '/listings/[id]', '/listings/[id]/edit', '/offers'],
    panels: ['intelligence-valuation-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.valuation,
    clientFn: 'fetchValuationIntelligence',
  },
  auction_intelligence: {
    routes: ['/auctions/[id]', '/watchlist', '/seller/auctions'],
    panels: ['intelligence-auction-panel', 'intelligence-watchlist-temperature'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.auction_intelligence,
    clientFn: 'fetchAuctionIntelligence',
  },
  embeddings: {
    routes: ['/admin/embeddings', '/records/[id]'],
    panels: ['intelligence-embeddings-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.embeddings,
    clientFn: 'fetchEmbeddingMetadata',
  },
  semantic_search: {
    routes: ['/market', '/listings', '/collection'],
    panels: ['intelligence-search-chrome'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.semantic_search,
    clientFn: 'fetchSemanticSearchIntelligence',
  },
  negotiation_assistance: {
    routes: ['/messages', '/offers'],
    panels: ['intelligence-negotiation-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.negotiation_assistance,
    clientFn: 'fetchNegotiationAssistance',
  },
  recommendations: {
    routes: ['/dashboard', '/records/[id]', '/watchlist'],
    panels: ['intelligence-recommendations-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.recommendations,
    clientFn: 'fetchRecommendationsIntelligence',
  },
  market_analytics: {
    routes: ['/analytics', '/collection/stats', '/seller/analytics'],
    panels: ['intelligence-market-analytics-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.market_analytics,
    clientFn: 'fetchMarketAnalyticsIntelligence',
  },
});

export function assertCapabilitySurfacesMounted(capability) {
  const reg = CAPABILITY_SURFACE_REGISTRY[capability];
  if (!reg) {
    const err = new Error(`no surface registry for ${capability}`);
    err.code = 'PHASE34_PRODUCT_SURFACE_MISSING';
    throw err;
  }
  const missing = [];
  for (const rel of reg.components) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) missing.push(rel);
  }
  // Client module must export the fetch helper
  const clientPath = path.join(REPO_ROOT, 'webapp/lib/ai-intelligence-client.ts');
  const clientSrc = fs.readFileSync(clientPath, 'utf8');
  if (!clientSrc.includes(reg.clientFn)) {
    missing.push(`export ${reg.clientFn}`);
  }
  if (!clientSrc.includes(reg.apiPath)) {
    missing.push(`apiPath ${reg.apiPath}`);
  }
  return {
    capability,
    routes: reg.routes,
    panels: reg.panels,
    apiPath: reg.apiPath,
    mounted: missing.length === 0,
    missing,
  };
}

export function resolveConcreteRoute(template, subject) {
  return template
    .replace('[id]', subject.id || subject.record_id || 'fixture-subject')
    .replace('*', subject.id || '');
}

/**
 * Build a sanitized canonical intelligence request body from captured browser JSON.
 * Strips cookies/tokens/PII fields.
 */
export function sanitizeCanonicalBody(rawBody, capability) {
  const body = rawBody && typeof rawBody === 'object' ? { ...rawBody } : {};
  for (const k of [
    'cookie',
    'authorization',
    'token',
    'jwt',
    'access_token',
    'refresh_token',
    'password',
    'email',
    'phone',
    'raw_message',
    'messages',
    'private_evidence',
  ]) {
    delete body[k];
  }
  body.capability = capability;
  body.production_mutation_allowed = false;
  if (capability === 'negotiation_assistance') {
    body.automatic_send_allowed = false;
  }
  return body;
}

/**
 * Base adapter — subclasses override buildRequestSeed / extractRendered / reconcileFields.
 */
export class BaseProductJourneyAdapter {
  /** @param {string} capability */
  constructor(capability) {
    this.capability = capability;
    this.registry = CAPABILITY_SURFACE_REGISTRY[capability];
    if (!this.registry) throw new Error(`unknown capability ${capability}`);
  }

  async prepare(context) {
    const surface = assertCapabilitySurfacesMounted(this.capability);
    if (!surface.mounted) {
      const err = new Error(`surface not mounted: ${surface.missing.join(',')}`);
      err.code = 'PHASE34_PRODUCT_SURFACE_NOT_MOUNTED';
      throw err;
    }
    const subject = context.subject || {
      id: `subj_${context.session_id?.slice(-8) || 'fixture'}`,
      record_id: `rec_${context.scenario_id || 'x'}`,
    };
    const routeTemplate = this.pickRoute(context);
    const route = resolveConcreteRoute(routeTemplate, subject);
    const requestSeed = this.buildRequestSeed(context, subject);
    return {
      capability: this.capability,
      route,
      routeTemplate,
      panelTestId: this.registry.panels[0],
      apiPath: this.registry.apiPath,
      subject,
      requestSeed,
      scenario_id: context.scenario_id,
      participant_side: context.participant_side,
      authorization_state: context.authorization_state,
      evidence_strength: context.evidence_strength,
      session_id: context.session_id || null,
      turn_id: context.turn_id || null,
      journey_id: context.journey_id || null,
      turn_index: context.turn_index ?? 0,
      screenshot_pack: context.screenshot_pack || 'gauntlet',
      screenshot_out_override: context.screenshot_out_override || null,
    };
  }

  pickRoute(context) {
    const routes = this.registry.routes;
    if (context.scenario_class?.includes('watchlist')) {
      const w = routes.find((r) => r.includes('watchlist'));
      if (w) return w;
    }
    if (context.scenario_class?.includes('edit') || context.scenario_class?.includes('listing_edit')) {
      const e = routes.find((r) => r.includes('edit'));
      if (e) return e;
    }
    if (context.participant_side === 'seller') {
      const s = routes.find((r) => r.includes('sell') || r.includes('seller') || r.includes('listings'));
      if (s) return s;
    }
    return routes[0];
  }

  buildRequestSeed(context, subject) {
    return {
      capability: this.capability,
      subject: { id: subject.id, record_id: subject.record_id },
      scenario_class: context.scenario_class,
      evidence_strength: context.evidence_strength,
      participant_side: context.participant_side,
      authorization_state: context.authorization_state,
      production_mutation_allowed: false,
      schema_version: 'phase34-intelligence-v1',
    };
  }

  /**
   * Execute browser journey. Prefer live Playwright page; else fixtureDriver.
   * @param {import('playwright').Page | null} page
   * @param {object} prepared
   * @param {{ fixtureDriver?: Function }} [opts]
   */
  async executeBrowserJourney(page, prepared, opts = {}) {
    if (opts.fixtureDriver) {
      return opts.fixtureDriver(prepared, this);
    }
    if (!page) {
      const err = new Error('Playwright page required for live journey (or provide fixtureDriver)');
      err.code = 'PHASE34_PRODUCT_BROWSER_REQUIRED';
      throw err;
    }
    return this.executeLivePlaywright(page, prepared);
  }

  async executeLivePlaywright(page, prepared) {
    const consoleErrors = [];
    const failedRequests = [];
    const captures = [];
    const screenshots = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()}`);
    });

    const apiPath = prepared.apiPath;
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes(apiPath) && res.request().method() === 'POST',
      { timeout: 60_000 },
    );

    const actionStart = Date.now();
    await page.goto(prepared.route, { waitUntil: 'domcontentloaded' });

    const shotBase = {
      capability: this.capability,
      scenario_id: prepared.scenario_id,
      participant_side: prepared.participant_side,
      viewport: await page.viewportSize(),
      session_id: prepared.session_id,
      turn_id: prepared.turn_id,
      journey_id: prepared.journey_id,
      turn_index: prepared.turn_index,
      browser_route: prepared.route,
      pack: prepared.screenshot_pack || 'gauntlet',
      authClass: 'authenticated',
    };

    screenshots.push(await captureProductScreenshot(page, { ...shotBase, state: 'before_action' }));

    const panel = page.getByTestId(prepared.panelTestId);
    if ((await panel.count()) === 0) {
      const link = page.locator(`a[href*="${prepared.route.split('/')[1]}"]`).first();
      if (await link.count()) await link.click();
    }

    screenshots.push(await captureProductScreenshot(page, { ...shotBase, state: 'loading' }));
    await panel.first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => null);

    const response = await responsePromise;
    const request = response.request();
    let postData = null;
    try {
      postData = request.postDataJSON();
    } catch {
      try {
        postData = JSON.parse(request.postData() || '{}');
      } catch {
        postData = {};
      }
    }
    const responseJson = await response.json().catch(() => null);
    const actionEnd = Date.now();

    captures.push({
      browser_request_id: request.headers()['x-request-id'] || `br_${actionStart}`,
      route: prepared.route,
      method: 'POST',
      endpoint: apiPath,
      body: postData,
      status: response.status(),
      started_at: new Date(actionStart).toISOString(),
      finished_at: new Date(actionEnd).toISOString(),
    });

    const rendered = await this.extractRendered(page, prepared, responseJson);
    const a11y = await executeAccessibilityChecks(page, { panelTestId: prepared.panelTestId });
    const clientProtocol = await observeClientProtocol(page);
    const finalState = this.classifyVisualState(prepared, responseJson, rendered);
    screenshots.push(
      await captureProductScreenshot(page, {
        ...shotBase,
        state: finalState,
        browser_console_error_count: consoleErrors.length,
        failed_request_count: failedRequests.length,
        accessibility_status: a11y.accessibility_result,
        horizontal_overflow: a11y.horizontal_overflow,
      }),
    );

    for (const [testid, state] of [
      ['intelligence-evidence-expand', 'evidence_expanded'],
      ['intelligence-limitations-expand', 'limitations_expanded'],
    ]) {
      const btn = page.getByTestId(testid);
      if ((await btn.count()) > 0) {
        await btn.first().click().catch(() => null);
        screenshots.push(
          await captureProductScreenshot(page, {
            ...shotBase,
            state,
            accessibility_status: a11y.accessibility_result,
            horizontal_overflow: a11y.horizontal_overflow,
          }),
        );
      }
    }

    assertScreenshotsBeforePass(screenshots);

    return {
      journey_outcome:
        response.ok() && consoleErrors.length === 0 && a11y.accessibility_result !== 'FAIL'
          ? 'PASS'
          : 'FAIL',
      browser_route: prepared.route,
      viewport: await page.viewportSize(),
      viewport_class: viewportLabel(await page.viewportSize()),
      authenticated_participant_role: prepared.participant_side,
      action_sequence: [
        'goto',
        'screenshot_before_action',
        'screenshot_loading',
        'wait_panel',
        'capture_intelligence_post',
        'accessibility_checks',
        'screenshot_final',
      ],
      network_captures: captures,
      panel_loading_state: 'ready',
      panel_ready_state: 'ready',
      rendered,
      api_response: responseJson,
      console_errors: consoleErrors,
      failed_requests: failedRequests,
      accessibility_result: a11y.accessibility_result,
      accessibility: a11y,
      horizontal_overflow: a11y.horizontal_overflow,
      client_protocol_observed: clientProtocol,
      automatic_send_allowed: false,
      production_mutation: false,
      screenshots,
      screenshot_manifest_entry_ids: screenshots.map((s) => s.screenshot_id),
      timings: {
        browser_action_to_request_us: null,
        browser_action_to_panel_ready_us: (actionEnd - actionStart) * 1000,
        measurement_status: 'PARTIAL',
      },
    };
  }

  classifyVisualState(prepared, responseJson, rendered) {
    const structured = rendered?.structured || {};
    if (prepared.authorization_state === 'unauthorized') return 'unauthorized_refusal';
    if (structured.abstention || structured.classification === 'abstain') return 'abstention';
    if (prepared.evidence_strength === 'weak') return 'weak_data';
    if (prepared.evidence_strength === 'stale') return 'stale_data';
    if (Number(responseJson?.http_status || 200) === 429) return 'rate_limit';
    if (Number(responseJson?.http_status || 200) >= 500) return 'service_failure';
    return 'success';
  }

  async captureCanonicalRequest(browserResult) {
    const cap = browserResult.network_captures?.[0];
    if (!cap?.body) {
      const err = new Error('no browser intelligence request captured');
      err.code = 'PHASE34_PRODUCT_NO_BROWSER_REQUEST';
      throw err;
    }
    const sanitized = sanitizeCanonicalBody(cap.body, this.capability);
    return {
      method: 'POST',
      endpoint: cap.endpoint || this.registry.apiPath,
      body: sanitized,
      browser_request_id: cap.browser_request_id,
      route: cap.route,
      client_component: this.registry.clientFn,
      started_at: cap.started_at,
      finished_at: cap.finished_at,
      http_result: cap.status,
    };
  }

  async extractRendered(page, prepared, apiResponse) {
    // Default: read data attributes / text from panel when present
    const panel = page.getByTestId(prepared.panelTestId);
    let text = '';
    if (await panel.count()) {
      text = (await panel.first().innerText().catch(() => '')) || '';
    }
    return this.normalizeRendered(text, apiResponse);
  }

  normalizeRendered(text, apiResponse) {
    const result = apiResponse?.result || apiResponse?.envelope || apiResponse || {};
    return {
      raw_text_hash_input: text.slice(0, 2000),
      structured: result,
    };
  }

  async reconcileRenderedResult(browserResult, acceptedResult) {
    return this.reconcileFields(browserResult.rendered?.structured || {}, acceptedResult);
  }

  reconcileFields(rendered, accepted) {
    const mismatches = [];
    const acceptedBody = accepted?.accepted_body || accepted?.body || accepted || {};
    const acceptedResult = acceptedBody.result || acceptedBody.envelope || acceptedBody;
    for (const field of this.materialFields()) {
      const rv = dig(rendered, field);
      const av = dig(acceptedResult, field);
      if (!materiallyEqual(rv, av)) {
        mismatches.push({ field, rendered: rv ?? null, accepted: av ?? null });
      }
    }
    if (this.capability === 'negotiation_assistance') {
      if (rendered.automatic_send_allowed === true || acceptedResult.automatic_send_allowed === true) {
        mismatches.push({ field: 'automatic_send_allowed', rendered: true, accepted: false });
      }
    }
    return {
      status: mismatches.length === 0 ? 'PASS' : 'FAIL',
      mismatches,
      capability: this.capability,
    };
  }

  materialFields() {
    return ['capability', 'status'];
  }

  async cleanup() {
    /* no-op by default */
  }
}

function dig(obj, dotted) {
  if (obj == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, dotted)) return obj[dotted];
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function materiallyEqual(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

export class ScarcityJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('scarcity');
  }
  buildRequestSeed(context, subject) {
    return {
      ...super.buildRequestSeed(context, subject),
      claim_rarity_from_zero_results: false,
      pressing_mode: context.scenario_class?.includes('exact') ? 'exact' : 'release',
    };
  }
  materialFields() {
    return [
      'classification',
      'scarcity_class',
      'confidence',
      'evidence_count',
      'limitations',
      'abstention',
      'exact_pressing',
      'pressing_level',
    ];
  }
}

export class ValuationJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('valuation');
  }
  materialFields() {
    return [
      'quick_range',
      'fair_range',
      'patient_range',
      'currency',
      'sold_count',
      'asking_count',
      'condition_adjustment',
      'weak_data',
    ];
  }
}

export class AuctionJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('auction_intelligence');
  }
  materialFields() {
    return [
      'market_temperature',
      'bid_velocity',
      'late_bid_pressure',
      'ending_time_clustering',
      'warnings',
      'limitations',
    ];
  }
}

export class EmbeddingsJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('embeddings');
  }
  materialFields() {
    return ['version', 'content_hash', 'lineage', 'owner_scope', 'stale', 'deleted', 'reembed_required'];
  }
}

export class SemanticSearchJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('semantic_search');
  }
  buildRequestSeed(context, subject) {
    const mode = context.scenario_class?.includes('hybrid')
      ? 'hybrid'
      : context.scenario_class?.includes('semantic')
        ? 'semantic'
        : 'keyword';
    return {
      ...super.buildRequestSeed(context, subject),
      retrieval_mode_requested: mode,
      query: context.scenario_class || 'test query',
    };
  }
  materialFields() {
    return [
      'requested_mode',
      'executed_mode',
      'retrieval_mode_requested',
      'retrieval_mode_executed',
      'result_ids',
      'pressing_identity',
      'fallback_state',
    ];
  }
}

export class NegotiationJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('negotiation_assistance');
  }
  buildRequestSeed(context, subject) {
    return {
      ...super.buildRequestSeed(context, subject),
      automatic_send_allowed: false,
      unauthorized_thread: context.authorization_state === 'unauthorized',
    };
  }
  materialFields() {
    return [
      'authorized',
      'refusal_reason',
      'engine_invoked',
      'strategy',
      'suggested_range',
      'draft',
      'automatic_send_allowed',
    ];
  }
}

export class RecommendationsJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('recommendations');
  }
  materialFields() {
    return ['item_ids', 'reason_codes', 'budget', 'negative_preferences', 'availability', 'diversity'];
  }
}

export class MarketAnalyticsJourneyAdapter extends BaseProductJourneyAdapter {
  constructor() {
    super('market_analytics');
  }
  materialFields() {
    return [
      'time_range',
      'population',
      'sample_size',
      'currency',
      'aggregation',
      'methodology',
      'warnings',
    ];
  }
}

const ADAPTERS = {
  scarcity: () => new ScarcityJourneyAdapter(),
  valuation: () => new ValuationJourneyAdapter(),
  auction_intelligence: () => new AuctionJourneyAdapter(),
  embeddings: () => new EmbeddingsJourneyAdapter(),
  semantic_search: () => new SemanticSearchJourneyAdapter(),
  negotiation_assistance: () => new NegotiationJourneyAdapter(),
  recommendations: () => new RecommendationsJourneyAdapter(),
  market_analytics: () => new MarketAnalyticsJourneyAdapter(),
};

export function getJourneyAdapter(capability) {
  const factory = ADAPTERS[capability];
  if (!factory) {
    const err = new Error(`no journey adapter for ${capability}`);
    err.code = 'PHASE34_PRODUCT_ADAPTER_MISSING';
    throw err;
  }
  return factory();
}

export function listJourneyAdapters() {
  return Object.keys(ADAPTERS).map((capability) => getJourneyAdapter(capability));
}

/**
 * Deterministic fixture driver — simulates browser capture of the adapter request seed.
 * Used while v3 owns the live edge; same canonical body feeds H1/H2/H3.
 */
export function createFixtureBrowserDriver(overrides = {}) {
  return async function fixtureDriver(prepared, adapter) {
    const body = sanitizeCanonicalBody(
      { ...prepared.requestSeed, ...(overrides.body || {}) },
      adapter.capability,
    );
    const acceptedStructured = overrides.rendered || {
      ...synthesizeAccepted(adapter.capability, body),
    };
    return {
      journey_outcome: overrides.journey_outcome || 'PASS',
      browser_route: prepared.route,
      viewport: { width: 1280, height: 720 },
      authenticated_participant_role: prepared.participant_side,
      action_sequence: ['fixture_goto', 'fixture_panel_ready', 'fixture_capture'],
      network_captures: [
        {
          browser_request_id: overrides.browser_request_id || `fixture_br_${Date.now()}`,
          route: prepared.route,
          method: 'POST',
          endpoint: prepared.apiPath,
          body,
          status: 200,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        },
      ],
      panel_loading_state: 'ready',
      panel_ready_state: 'ready',
      rendered: { structured: acceptedStructured },
      api_response: { result: acceptedStructured },
      console_errors: [],
      failed_requests: [],
      accessibility_result: 'NOT_EXECUTED',
      accessibility_note: 'FIXTURE_PATH — live executeAccessibilityChecks required for acceptance',
      horizontal_overflow: null,
      client_protocol_observed: null,
      automatic_send_allowed: false,
      production_mutation: false,
      screenshots: [],
      screenshot_manifest_entry_ids: [],
      visual_evidence_class: 'FIXTURE_NO_SCREENSHOT',
      timings: {
        browser_action_to_request_us: 12_000,
        browser_action_to_panel_ready_us: 85_000,
        measurement_status: 'FIXTURE',
      },
    };
  };
}

function synthesizeAccepted(capability, body) {
  switch (capability) {
    case 'scarcity':
      return {
        classification: body.evidence_strength === 'weak' ? 'abstain' : 'scarce',
        scarcity_class: 'scarce',
        confidence: 0.7,
        evidence_count: body.evidence_strength === 'weak' ? 0 : 3,
        limitations: ['fixture'],
        abstention: body.evidence_strength === 'weak',
        exact_pressing: body.pressing_mode === 'exact',
        pressing_level: body.pressing_mode || 'release',
        capability: 'scarcity',
      };
    case 'valuation':
      return {
        quick_range: [10, 20],
        fair_range: [20, 40],
        patient_range: [40, 60],
        currency: 'USD',
        sold_count: 5,
        asking_count: 8,
        condition_adjustment: 0,
        weak_data: false,
        capability: 'valuation',
      };
    case 'auction_intelligence':
      return {
        market_temperature: 'warm',
        bid_velocity: 1.2,
        late_bid_pressure: false,
        ending_time_clustering: false,
        warnings: [],
        limitations: [],
        capability: 'auction_intelligence',
      };
    case 'embeddings':
      return {
        version: 'emb-v1',
        content_hash: 'abc',
        lineage: 'ok',
        owner_scope: 'self',
        stale: false,
        deleted: false,
        reembed_required: false,
        capability: 'embeddings',
      };
    case 'semantic_search':
      return {
        requested_mode: body.retrieval_mode_requested || 'keyword',
        executed_mode: body.retrieval_mode_requested || 'keyword',
        retrieval_mode_requested: body.retrieval_mode_requested || 'keyword',
        retrieval_mode_executed: body.retrieval_mode_requested || 'keyword',
        result_ids: ['r1', 'r2'],
        pressing_identity: 'exact',
        fallback_state: 'none',
        capability: 'semantic_search',
      };
    case 'negotiation_assistance':
      return {
        authorized: !body.unauthorized_thread,
        refusal_reason: body.unauthorized_thread ? 'unauthorized_thread' : null,
        engine_invoked: !body.unauthorized_thread,
        strategy: body.unauthorized_thread ? null : 'patient',
        suggested_range: body.unauthorized_thread ? null : [10, 15],
        draft: body.unauthorized_thread ? null : 'draft text',
        automatic_send_allowed: false,
        capability: 'negotiation_assistance',
      };
    case 'recommendations':
      return {
        item_ids: ['i1', 'i2', 'i3'],
        reason_codes: ['collection_gap'],
        budget: null,
        negative_preferences: [],
        availability: true,
        diversity: 0.8,
        capability: 'recommendations',
      };
    case 'market_analytics':
      return {
        time_range: '12m',
        population: 'watchlist',
        sample_size: 42,
        currency: 'USD',
        aggregation: 'median',
        methodology: 'fixture',
        warnings: [],
        capability: 'market_analytics',
      };
    default:
      return { capability };
  }
}
