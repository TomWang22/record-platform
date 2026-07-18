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
    routes: ['/listings/[id]', '/records/[id]'],
    mounted_surfaces: [
      { route: '/listings/[id]', panel: 'intelligence-scarcity-panel', status: 'MOUNTED' },
      { route: '/records/[id]', panel: 'intelligence-scarcity-panel', status: 'MOUNTED' },
      { route: '/watchlist', panel: 'intelligence-scarcity-panel', status: 'PRODUCT_SURFACE_MISSING' },
    ],
    panels: ['intelligence-scarcity-panel'],
    components: [
      'webapp/components/ai/intelligence/scarcity-intelligence-panel.tsx',
    ],
    apiPath: CAPABILITY_ROUTE_PATHS.scarcity,
    clientFn: 'fetchScarcityIntelligence',
    /** Auto-fetches on mount when record subject is present. */
    trigger: 'auto',
  },
  valuation: {
    routes: ['/listings/[id]', '/records/[id]', '/sell', '/listings/[id]/edit'],
    mounted_surfaces: [
      { route: '/listings/[id]', panel: 'intelligence-valuation-panel', status: 'MOUNTED' },
      { route: '/records/[id]', panel: 'intelligence-valuation-panel', status: 'MOUNTED' },
      { route: '/sell', panel: 'intelligence-valuation-panel', status: 'MOUNTED' },
      { route: '/listings/[id]/edit', panel: 'intelligence-valuation-panel', status: 'MOUNTED' },
    ],
    panels: ['intelligence-valuation-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.valuation,
    clientFn: 'fetchValuationIntelligence',
    trigger: 'auto',
  },
  auction_intelligence: {
    routes: ['/listings/[id]', '/watchlist'],
    mounted_surfaces: [
      { route: '/listings/[id]', panel: 'intelligence-auction-panel', status: 'MOUNTED' },
      {
        route: '/watchlist',
        panel: 'intelligence-watchlist-temperature-panel',
        status: 'MOUNTED',
        runTestId: 'intelligence-watchlist-temperature-run',
      },
    ],
    panels: ['intelligence-auction-panel', 'intelligence-watchlist-temperature-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.auction_intelligence,
    clientFn: 'fetchAuctionIntelligence',
    trigger: 'click',
    runTestId: 'intelligence-auction-run',
  },
  embeddings: {
    routes: ['/insights'],
    mounted_surfaces: [
      { route: '/insights', panel: 'intelligence-embedding-lineage-panel', status: 'MOUNTED' },
    ],
    panels: ['intelligence-embedding-lineage-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.embeddings,
    clientFn: 'fetchEmbeddingMetadata',
    trigger: 'click',
    runButtonName: /inspect metadata/i,
  },
  semantic_search: {
    routes: ['/listings', '/sell'],
    mounted_surfaces: [
      { route: '/listings', panel: 'intelligence-search-chrome', status: 'MOUNTED' },
      { route: '/sell', panel: 'intelligence-search-chrome', status: 'MOUNTED' },
      { route: '/market', panel: 'intelligence-search-chrome', status: 'PRODUCT_SURFACE_MISSING' },
    ],
    panels: ['intelligence-search-chrome'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.semantic_search,
    clientFn: 'fetchSemanticSearchIntelligence',
    trigger: 'semantic_search',
    runTestId: 'intelligence-search-run',
  },
  negotiation_assistance: {
    routes: ['/messages'],
    mounted_surfaces: [
      { route: '/messages', panel: 'intelligence-negotiation-panel', status: 'MOUNTED' },
      { route: '/offers/inbox', panel: 'intelligence-negotiation-panel', status: 'PRODUCT_SURFACE_MISSING' },
    ],
    panels: ['intelligence-negotiation-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.negotiation_assistance,
    clientFn: 'fetchNegotiationAssistance',
    trigger: 'click',
    runTestId: 'intelligence-negotiation-run',
  },
  recommendations: {
    routes: ['/dashboard', '/records/[id]'],
    mounted_surfaces: [
      { route: '/dashboard', panel: 'intelligence-recommendations-panel', status: 'MOUNTED' },
      { route: '/records/[id]', panel: 'intelligence-recommendations-panel', status: 'MOUNTED' },
      { route: '/watchlist', panel: 'intelligence-recommendations-panel', status: 'PRODUCT_SURFACE_MISSING' },
    ],
    panels: ['intelligence-recommendations-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.recommendations,
    clientFn: 'fetchRecommendationsIntelligence',
    trigger: 'click',
    runButtonName: /get recommendations/i,
  },
  market_analytics: {
    routes: ['/insights'],
    mounted_surfaces: [
      { route: '/insights', panel: 'intelligence-market-analytics-panel', status: 'MOUNTED' },
      {
        route: '/profile/collection-stats',
        panel: 'intelligence-market-analytics-panel',
        status: 'PRODUCT_SURFACE_MISSING',
      },
    ],
    panels: ['intelligence-market-analytics-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.market_analytics,
    clientFn: 'fetchMarketAnalyticsIntelligence',
    trigger: 'click',
    runButtonName: /run descriptive report/i,
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
  const listingId = subject.listing_id || subject.id;
  const recordId = subject.record_id || subject.id;
  const idForPath = template.includes('/listings/')
    ? listingId
    : template.includes('/records/')
      ? recordId
      : subject.id || recordId || listingId || 'fixture-subject';
  return template.replace('[id]', idForPath).replace('*', idForPath || '');
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
    const panelTestId = this.resolvePanelTestId(context);
    const selectedSurface = context.selected_surface || null;
    return {
      capability: this.capability,
      route,
      routeTemplate,
      selected_surface: selectedSurface,
      panelTestId,
      apiPath: this.registry.apiPath,
      runTestId: selectedSurface?.runTestId || this.registry.runTestId || null,
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
    const surfaces = (this.registry.mounted_surfaces || []).filter((s) => s.status === 'MOUNTED');
    const mountedRoutes = surfaces.length
      ? surfaces.map((s) => s.route)
      : this.registry.routes || [];
    if (this.capability === 'negotiation_assistance' && context.subject?.thread_id) {
      return `/messages?thread=${encodeURIComponent(context.subject.thread_id)}`;
    }
    const idx = Number(context.surface_route_index ?? context.smoke_index ?? 0);
    const template = mountedRoutes[Math.abs(idx) % Math.max(mountedRoutes.length, 1)] || mountedRoutes[0];
    // Stash selected surface for panel override (e.g. watchlist temperature).
    const surface = surfaces[Math.abs(idx) % Math.max(surfaces.length, 1)] || null;
    context.selected_surface = surface;
    return template;
  }

  resolvePanelTestId(context) {
    if (context.selected_surface?.panel) return context.selected_surface.panel;
    return this.registry.panels?.[0] || `intelligence-${this.capability}-panel`;
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

  async triggerLiveAction(page, prepared) {
    const trigger = this.registry.trigger || 'auto';
    if (trigger === 'auto') return;

    if (this.capability === 'negotiation_assistance') {
      const threadId = prepared.subject?.thread_id;
      if (threadId) {
        await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.getByTestId(prepared.panelTestId).first().waitFor({ state: 'visible', timeout: 60_000 });
      } else {
        const thread = page.locator('[data-testid*="thread"], button:has-text("Inquiry"), a[href*="thread="]').first();
        if (await thread.count()) await thread.click().catch(() => null);
      }
    }

    if (trigger === 'semantic_search') {
      // Desktop filter input is display:none below lg; filling it with force does not
      // update the shared React query state. Always target a visible marketplace input.
      const desktop = page.locator('input[placeholder*="Search artist" i]');
      const mobile = page.locator('input[placeholder*="Search marketplace" i]');
      const useDesktop =
        (await desktop.count()) > 0 && (await desktop.first().isVisible().catch(() => false));
      const searchInput = useDesktop ? desktop.first() : mobile.first();
      await searchInput.waitFor({ state: 'visible', timeout: 15_000 });
      await searchInput.fill(prepared.requestSeed?.query || 'Miles Davis Kind of Blue', {
        timeout: 15_000,
      });
      await page.getByTestId('intelligence-search-mode-semantic').check({ force: true });
      await page.getByTestId(this.registry.runTestId).click();
      return;
    }

    if (this.registry.runTestId || prepared.runTestId) {
      await page.getByTestId(prepared.runTestId || this.registry.runTestId).click();
      return;
    }
    if (this.registry.runButtonName) {
      const btn = page.getByRole('button', { name: this.registry.runButtonName });
      await btn.waitFor({ state: 'visible', timeout: 30_000 });
      // Recommendations disables until principalId hydrates from the session token.
      const nameSource =
        this.registry.runButtonName instanceof RegExp
          ? this.registry.runButtonName.source
          : String(this.registry.runButtonName);
      let enabled = false;
      for (let attempt = 0; attempt < 2 && !enabled; attempt += 1) {
        enabled = await page
          .waitForFunction(
            (src) => {
              const re = new RegExp(src, 'i');
              const buttons = [...document.querySelectorAll('button')];
              const match = buttons.find((b) => re.test((b.textContent || '').trim()));
              return Boolean(match && !match.disabled);
            },
            nameSource,
            { timeout: 20_000 },
          )
          .then(() => true)
          .catch(() => false);
        if (!enabled && attempt === 0) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
          await page.getByTestId(prepared.panelTestId).first().waitFor({ state: 'visible', timeout: 60_000 });
          await btn.waitFor({ state: 'visible', timeout: 30_000 });
        }
      }
      await btn.click({ timeout: 30_000, force: true });
    }
  }

  async executeLivePlaywright(page, prepared) {
    const consoleErrors = [];
    const failedRequests = [];
    const captures = [];
    const screenshots = [];
    const expectedFailPatterns = [
      /favicon\.ico/i,
      /\/api\/auth\/refresh/i,
      /\/api\/cart(\?|$)/i,
      /\/api\/notifications(\?|$)/i,
      /\/api\/records(\?|$)/i,
      /\/offers\/(sent|inbox)/i,
      /\/_next\//i,
      /\?_rsc=/i,
    ];
    const expectedConsolePatterns = [
      /Download the React DevTools/i,
      /favicon/i,
      /\/api\/cart/i,
      /\/api\/notifications/i,
      /\/api\/records/i,
      /\/offers\//i,
      /Failed to load resource:.*\b(400|401|403|404|500|502|503)\b/i,
      /net::ERR_ABORTED/i,
      /AbortError/i,
    ];
    const onConsole = (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    const onRequestFailed = (req) => {
      const url = req.url();
      if (expectedFailPatterns.some((re) => re.test(url))) return;
      const failure = req.failure()?.errorText || '';
      // Remount/navigation aborts in-flight fetches; do not treat as hard failures.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled|canceled/i.test(failure)) return;
      failedRequests.push(`${req.method()} ${url}${failure ? ` (${failure})` : ''}`);
    };
    page.on('console', onConsole);
    page.on('requestfailed', onRequestFailed);
    const detachListeners = () => {
      page.off?.('console', onConsole);
      page.off?.('requestfailed', onRequestFailed);
      try {
        page.removeListener?.('console', onConsole);
        page.removeListener?.('requestfailed', onRequestFailed);
      } catch {
        /* ignore */
      }
    };

    const apiPath = prepared.apiPath;
    // Attach waiter before navigation/trigger; swallow late rejection if we abort early.
    let responseSettled = false;
    const responsePromise = page
      .waitForResponse(
        (res) => res.url().includes(apiPath) && res.request().method() === 'POST',
        { timeout: 120_000 },
      )
      .then((res) => {
        responseSettled = true;
        return res;
      })
      .catch((err) => {
        responseSettled = true;
        throw err;
      });

    const actionStart = Date.now();
    try {
      // Every turn must produce a fresh browser intelligence POST. Auto-trigger
      // panels only fetch on mount, so later turns remount via a turn-scoped URL
      // rather than skipping navigation on an already-loaded route.
      const routeBase = String(prepared.route || '/');
      const turnNav =
        Number(prepared.turn_index) > 0
          ? `${routeBase}${routeBase.includes('?') ? '&' : '?'}phase34_turn=${prepared.turn_index}`
          : routeBase;
      await page.goto(turnNav, { waitUntil: 'domcontentloaded', timeout: 60_000 });

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
        expected_locator: `[data-testid="${prepared.panelTestId}"]`,
        browser_name: 'chromium',
      };

      const panel = page.getByTestId(prepared.panelTestId);
      await panel.first().waitFor({ state: 'visible', timeout: 60_000 });
      screenshots.push(
        await captureProductScreenshot(page, {
          ...shotBase,
          state: 'before_action',
          capture_phase: 'before_action',
          response_available_at_capture: false,
          expected_locator_visible: true,
          terminal_state: null,
        }),
      );

      const loadingLocator = page.getByTestId(`${prepared.panelTestId}-loading`);
      await this.triggerLiveAction(page, prepared);

      if ((await loadingLocator.count()) > 0) {
        screenshots.push(
          await captureProductScreenshot(page, {
            ...shotBase,
            state: 'loading',
            capture_phase: 'loading',
            response_available_at_capture: false,
            expected_locator_visible: true,
            terminal_state: null,
          }),
        );
      }

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

      await page
        .getByTestId(`${prepared.panelTestId}-loading`)
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => null);

      const rendered = await this.extractRendered(page, prepared, responseJson);
      const a11y = await executeAccessibilityChecks(page, { panelTestId: prepared.panelTestId });
      const clientProtocol = await observeClientProtocol(page);
      const finalState = this.classifyVisualState(prepared, responseJson, rendered);
      const terminalShotState = finalState === 'success' ? 'final' : finalState;
      screenshots.push(
        await captureProductScreenshot(page, {
          ...shotBase,
          state: terminalShotState,
          capture_phase: 'terminal',
          terminal_state: finalState === 'success' ? 'final_success' : finalState,
          response_available_at_capture: true,
          expected_locator_visible: true,
          browser_console_error_count: consoleErrors.length,
          failed_request_count: failedRequests.length,
          accessibility_status: a11y.accessibility_result,
          horizontal_overflow: a11y.horizontal_overflow,
        }),
      );

      for (const suffix of ['evidence', 'limitations']) {
        const details = page.getByTestId(`${prepared.panelTestId}-${suffix}`);
        if ((await details.count()) > 0) {
          const first = details.first();
          if (typeof first.locator === 'function') {
            await first.locator('summary').click().catch(() => null);
          } else if (typeof first.click === 'function') {
            await first.click().catch(() => null);
          }
          // Re-run a11y on expanded terminal-adjacent state for turn-specific evidence
          const expandA11y = await executeAccessibilityChecks(page, {
            panelTestId: prepared.panelTestId,
          });
          screenshots.push(
            await captureProductScreenshot(page, {
              ...shotBase,
              state: suffix === 'evidence' ? 'evidence_expanded' : 'limitations_expanded',
              capture_phase: 'expanded',
              terminal_state: null,
              response_available_at_capture: true,
              expected_locator_visible: true,
              accessibility_status: expandA11y.accessibility_result,
              horizontal_overflow: expandA11y.horizontal_overflow,
            }),
          );
        }
      }

      assertScreenshotsBeforePass(screenshots);

      const unexpectedConsole = consoleErrors.filter(
        (t) => !expectedConsolePatterns.some((re) => re.test(t)),
      );

      // A successful captured intelligence response wins over aborted sibling requests
      // (React remount / turn navigation). Only fail when no OK response was observed.
      const intelligenceFailed =
        !response.ok() && failedRequests.some((r) => /\/api\/ai\//i.test(r));

      return {
        journey_outcome:
          response.ok() &&
          unexpectedConsole.length === 0 &&
          !intelligenceFailed &&
          a11y.accessibility_result === 'PASS' &&
          a11y.horizontal_overflow === false
            ? 'PASS'
            : 'FAIL',
        journey_fail_reasons: [
          !response.ok() ? `http_${response.status()}` : null,
          unexpectedConsole.length ? `console:${unexpectedConsole[0]?.slice?.(0, 120)}` : null,
          intelligenceFailed ? 'intelligence_request_failed' : null,
          a11y.accessibility_result !== 'PASS' ? `a11y:${a11y.accessibility_result}` : null,
          a11y.horizontal_overflow ? 'horizontal_overflow' : null,
        ].filter(Boolean),
        browser_route: prepared.route,
        viewport: await page.viewportSize(),
        viewport_class: viewportLabel(await page.viewportSize()),
        authenticated_participant_role: prepared.participant_side,
        action_sequence: [
          'goto',
          'wait_panel',
          'screenshot_before_action',
          'trigger_action',
          'screenshot_loading_if_observed',
          'capture_intelligence_post',
          'accessibility_checks',
          'screenshot_final',
        ],
        network_captures: captures,
        panel_loading_state: 'ready',
        panel_ready_state: 'ready',
        rendered,
        api_response: responseJson,
        console_errors: unexpectedConsole,
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
    } catch (err) {
      if (!responseSettled) {
        // Prevent unhandled rejection when navigation/trigger fails before the POST.
        responsePromise.catch(() => null);
      }
      throw err;
    } finally {
      detachListeners();
    }
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
