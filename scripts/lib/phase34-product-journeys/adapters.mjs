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
import { awaitTerminalPanelReady } from '../phase34-product-terminal-readiness.mjs';
import { derivePipelineObservationFromResponse } from '../phase34-product-pipeline-observation.mjs';
import { assertCapabilityCaptureIdentity } from '../phase34-product-capability-identity.mjs';
import {
  assertIntelligenceRequestInitiated,
  assertOwnerProofHandlerReached,
  EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST,
  OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER,
} from '../phase34-product-request-initiation.mjs';
import { DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE } from '../phase34-product-screenshot-distinctness.mjs';
import { assertNoRuntimeForceFloorsInBody } from '../phase34-owner-proof-product-contracts.mjs';

/** A disclosure's aria-expanded attribute did not flip after clicking its summary. */
export const DISCLOSURE_DID_NOT_EXPAND = 'DISCLOSURE_DID_NOT_EXPAND';

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
    /** Owner-proof: visible intent + Analyze click initiates the POST. */
    trigger: 'click',
    runTestId: 'intelligence-scarcity-run',
    intentTestId: 'intelligence-scarcity-intent',
  },
  valuation: {
    routes: ['/listings/[id]', '/records/[id]', '/sell', '/listings/[id]/edit', '/offers/inbox'],
    mounted_surfaces: [
      { route: '/listings/[id]', panel: 'intelligence-valuation-panel', status: 'MOUNTED' },
      { route: '/records/[id]', panel: 'intelligence-valuation-panel', status: 'MOUNTED' },
      {
        route: '/sell',
        panel: 'intelligence-valuation-panel',
        status: 'MOUNTED',
        requires_collection_selection: true,
      },
      {
        route: '/listings/[id]/edit',
        panel: 'intelligence-valuation-panel',
        status: 'MOUNTED',
        // Edit mounts for the listing owner — seller smoke only.
        smoke_eligible_sides: ['seller'],
      },
      {
        route: '/offers/inbox',
        panel: 'intelligence-valuation-panel',
        status: 'MOUNTED',
        requires_offer_context: true,
      },
    ],
    panels: ['intelligence-valuation-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.valuation,
    clientFn: 'fetchValuationIntelligence',
    /** Owner-proof: visible intent + Analyze click initiates the POST. */
    trigger: 'click',
    runTestId: 'intelligence-valuation-run',
    intentTestId: 'intelligence-valuation-intent',
  },
  auction_intelligence: {
    routes: ['/listings/[id]', '/watchlist', '/auctions'],
    mounted_surfaces: [
      { route: '/listings/[id]', panel: 'intelligence-auction-panel', status: 'MOUNTED' },
      {
        route: '/watchlist',
        panel: 'intelligence-watchlist-temperature-panel',
        status: 'MOUNTED',
        runTestId: 'intelligence-watchlist-temperature-run',
        apiPath: '/api/ai/intelligence/auction/watchlist-temperature',
      },
      {
        route: '/auctions',
        panel: 'intelligence-seller-auction-dashboard',
        status: 'MOUNTED',
        runTestId: 'intelligence-seller-auction-dashboard-run',
        apiPath: '/api/ai/intelligence/auction/watchlist-temperature',
      },
    ],
    panels: [
      'intelligence-auction-panel',
      'intelligence-watchlist-temperature-panel',
      'intelligence-seller-auction-dashboard',
    ],
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
    runTestId: 'intelligence-embedding-lineage-run',
  },
  semantic_search: {
    routes: ['/listings', '/sell', '/market'],
    mounted_surfaces: [
      { route: '/listings', panel: 'intelligence-search-chrome', status: 'MOUNTED' },
      { route: '/sell', panel: 'intelligence-search-chrome', status: 'MOUNTED' },
      { route: '/market', panel: 'intelligence-search-chrome', status: 'MOUNTED' },
    ],
    panels: ['intelligence-search-chrome'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.semantic_search,
    clientFn: 'fetchSemanticSearchIntelligence',
    trigger: 'semantic_search',
    runTestId: 'intelligence-search-run',
  },
  negotiation_assistance: {
    routes: ['/messages', '/offers/inbox'],
    mounted_surfaces: [
      { route: '/messages', panel: 'intelligence-negotiation-panel', status: 'MOUNTED' },
      { route: '/offers/inbox', panel: 'intelligence-negotiation-panel', status: 'MOUNTED' },
    ],
    panels: ['intelligence-negotiation-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.negotiation_assistance,
    clientFn: 'fetchNegotiationAssistance',
    trigger: 'click',
    runTestId: 'intelligence-negotiation-run',
  },
  recommendations: {
    routes: ['/dashboard', '/records/[id]', '/watchlist'],
    mounted_surfaces: [
      { route: '/dashboard', panel: 'intelligence-recommendations-panel', status: 'MOUNTED' },
      {
        route: '/records/[id]',
        panel: 'intelligence-recommendations-panel',
        status: 'MOUNTED',
        // Record detail is owner-scoped; seller journeys use dashboard/watchlist.
        smoke_eligible_sides: ['buyer'],
      },
      { route: '/watchlist', panel: 'intelligence-recommendations-panel', status: 'MOUNTED' },
    ],
    panels: ['intelligence-recommendations-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.recommendations,
    clientFn: 'fetchRecommendationsIntelligence',
    /** Explicit click — panel does not auto-fetch on mount. */
    trigger: 'click',
    runTestId: 'intelligence-recommendations-run',
    runButtonName: /get recommendations/i,
  },
  market_analytics: {
    routes: ['/insights', '/profile/collection-stats'],
    mounted_surfaces: [
      { route: '/insights', panel: 'intelligence-market-analytics-panel', status: 'MOUNTED' },
      {
        route: '/profile/collection-stats',
        panel: 'intelligence-market-analytics-panel',
        status: 'MOUNTED',
      },
    ],
    panels: ['intelligence-market-analytics-panel'],
    components: ['webapp/lib/ai-intelligence-client.ts'],
    apiPath: CAPABILITY_ROUTE_PATHS.market_analytics,
    clientFn: 'fetchMarketAnalyticsIntelligence',
    trigger: 'click',
    runButtonName: /run descriptive report/i,
    runTestId: 'intelligence-market-analytics-run',
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
      apiPath: selectedSurface?.apiPath || this.registry.apiPath,
      runTestId: selectedSurface?.runTestId || this.registry.runTestId || null,
      intentTestId: selectedSurface?.intentTestId || this.registry.intentTestId || null,
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
    let surfaces = (this.registry.mounted_surfaces || []).filter(
      (s) => s.status === 'MOUNTED' && s.smoke_eligible !== false,
    );
    const side = context.participant_side;
    surfaces = surfaces.filter((s) => {
      if (Array.isArray(s.smoke_eligible_sides) && s.smoke_eligible_sides.length) {
        if (!s.smoke_eligible_sides.includes(side)) return false;
      }
      // Do not schedule offer-context valuation until an offer subject exists;
      // empty inbox renders a non-fetching placeholder and waitForResponse times out.
      if (s.requires_offer_context) {
        const hasOffer =
          Boolean(context.subject?.offer_id) ||
          Boolean(context.subject?.has_offers) ||
          Boolean(context.live_subjects?.offer_id);
        if (!hasOffer) return false;
      }
      return true;
    });
    // Seller has an empty private collection in the contract fixture — /records/[id]
    // requires ownership and will not mount intelligence panels for the buyer record id.
    if (context.participant_side === 'seller') {
      surfaces = surfaces.filter((s) => !String(s.route).includes('/records/'));
    }
    // /sell valuation panel needs a selected owned record; skip for seller-empty collection.
    if (context.participant_side === 'seller' && this.capability === 'valuation') {
      surfaces = surfaces.filter((s) => s.route !== '/sell');
    }
    const mountedRoutes = surfaces.length
      ? surfaces.map((s) => s.route)
      : (this.registry.routes || []).filter((r) => {
          if (context.participant_side === 'seller' && String(r).includes('/records/')) return false;
          return true;
        });
    if (this.capability === 'negotiation_assistance' && context.subject?.thread_id) {
      return `/messages?thread=${encodeURIComponent(context.subject.thread_id)}`;
    }
    // Owner-proof scenarios declare a canonical route — prefer it when mounted.
    const preferred = context.owner_proof_canonical_route || context.canonical_route || null;
    if (preferred) {
      const preferredSurface = surfaces.find((s) => s.route === preferred);
      if (preferredSurface) {
        context.selected_surface = preferredSurface;
        return preferred;
      }
      if ((this.registry.routes || []).includes(preferred)) {
        context.selected_surface =
          surfaces.find((s) => s.route === preferred) || surfaces[0] || null;
        return preferred;
      }
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
      user_intent: context.user_intent || null,
      owner_proof_prompt: context.user_intent || null,
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

  /**
   * Surfaces that mount the panel only after an in-page selection (e.g. /sell).
   * Must run after goto and before waiting on panelTestId.
   */
  async prepareLiveSurface(page, prepared) {
    const template = prepared.routeTemplate || '';
    const needsSelection =
      prepared.selected_surface?.requires_collection_selection ||
      (this.capability === 'valuation' && (template === '/sell' || prepared.route === '/sell'));
    if (needsSelection) {
      const byTestId = page.getByTestId('sell-collection-record');
      if ((await byTestId.count()) > 0) {
        await byTestId.first().waitFor({ state: 'visible', timeout: 45_000 });
        await byTestId.first().click();
        return;
      }
      // Pre-testid images: collection rows render as "Artist — Title (format)".
      const row = page.locator('ul button').filter({ hasText: /\s—\s/ }).first();
      await row.waitFor({ state: 'visible', timeout: 45_000 });
      await row.click();
      return;
    }

    if (
      this.capability === 'valuation' &&
      (template === '/listings/[id]/edit' || String(prepared.route || '').includes('/edit'))
    ) {
      await page
        .getByTestId('listing-edit-ready')
        .waitFor({ state: 'visible', timeout: 60_000 })
        .catch(() => null);
      // Real valuation panel must be present — never the empty-offer placeholder.
      const panel = page.getByTestId('intelligence-valuation-panel');
      await panel.first().waitFor({ state: 'visible', timeout: 60_000 });
      const missing = page.getByTestId('intelligence-valuation-panel-missing');
      if ((await missing.count()) > 0 && (await missing.first().isVisible().catch(() => false))) {
        const err = new Error('listing-edit valuation panel missing — UI never initiates valuation POST');
        err.code = 'VALUATION_REQUEST_NOT_INITIATED';
        throw err;
      }
      return;
    }

    if (this.capability === 'valuation' && String(prepared.route || '').startsWith('/offers')) {
      const missing = page.getByTestId('intelligence-valuation-panel-missing');
      if ((await missing.count()) > 0 && (await missing.first().isVisible().catch(() => false))) {
        const err = new Error('offers inbox has no offer context — valuation POST will not fire');
        err.code = 'VALUATION_REQUEST_NOT_INITIATED';
        throw err;
      }
      await page.getByTestId('intelligence-valuation-panel').first().waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      return;
    }

    if (this.capability === 'negotiation_assistance') {
      const panel = page.getByTestId(prepared.panelTestId);
      await page
        .getByTestId('messages-ready')
        .waitFor({ state: 'attached', timeout: 45_000 })
        .catch(() => null);
      const visible = async () =>
        (await panel.count()) > 0 && (await panel.first().isVisible().catch(() => false));
      if (!(await visible())) {
        const threadId = prepared.subject?.thread_id;
        const byId = threadId
          ? page.locator(`[data-testid="messages-inbox-item"][data-thread-id="${threadId}"]`)
          : null;
        if (byId && (await byId.count()) > 0) {
          await byId.first().click();
        } else if ((await page.getByTestId('messages-inbox-item').count()) > 0) {
          await page.getByTestId('messages-inbox-item').first().click();
        } else if (threadId) {
          await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          });
        }
      }
      await panel.first().waitFor({ state: 'visible', timeout: 90_000 });
    }
  }

  async triggerLiveAction(page, prepared) {
    const trigger = this.registry.trigger || 'auto';
    if (trigger === 'auto') return;

    if (this.capability === 'negotiation_assistance') {
      // Thread selection happens in prepareLiveSurface / initial goto; do not re-navigate
      // here (double goto races inbox hydration on tablet).
      await page
        .getByTestId(prepared.panelTestId)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      const turnPrompt =
        prepared.requestSeed?.user_intent ||
        prepared.requestSeed?.owner_proof_prompt ||
        null;
      if (turnPrompt) {
        const intent = page.getByTestId('intelligence-negotiation-user-intent').first();
        if ((await intent.count()) > 0) {
          await intent.fill(String(turnPrompt), { timeout: 15_000 });
        }
      }
    }

    if (trigger === 'semantic_search') {
      // Listings browse: desktop "Search artist…" / mobile "Search marketplace…".
      // Sell surface: parent-owned "Artist / release" feeds SearchIntelligenceChrome.query.
      // Owner-proof also exposes a visible intent textarea on the chrome itself.
      const queryText =
        prepared.requestSeed?.user_intent ||
        prepared.requestSeed?.owner_proof_prompt ||
        prepared.requestSeed?.query ||
        'Find first US mono pressings similar to this record under $80.';
      const searchPanel = page.getByTestId(prepared.panelTestId).first();
      const ownerIntent = searchPanel
        .locator(
          '[data-testid="intelligence-semantic-search-intent"], [data-testid="intelligence-owner-proof-intent"], [data-owner-proof-intent="1"]',
        )
        .first();
      if ((await ownerIntent.count()) > 0 && (await ownerIntent.isVisible().catch(() => false))) {
        await ownerIntent.fill(String(queryText), { timeout: 15_000 });
      }
      const candidates = [
        page.getByTestId('sell-comparable-query'),
        page.locator('input[placeholder*="Search artist" i]'),
        page.locator('input[placeholder*="Search marketplace" i]'),
        page.locator('input[placeholder*="Artist / release" i]'),
      ];
      let searchInput = null;
      for (const loc of candidates) {
        if ((await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))) {
          searchInput = loc.first();
          break;
        }
      }
      if (!searchInput) {
        searchInput = page
          .locator(
            '[data-testid="sell-comparable-query"], input[placeholder*="Search artist" i], input[placeholder*="Search marketplace" i], input[placeholder*="Artist / release" i]',
          )
          .first();
      }
      if ((await searchInput.count()) > 0) {
        await searchInput.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
        if (await searchInput.isVisible().catch(() => false)) {
          await searchInput.fill(String(queryText), { timeout: 15_000 });
        }
      }
      await page.getByTestId('intelligence-search-mode-semantic').check({ force: true });
      await page.getByTestId(this.registry.runTestId).click();
      return;
    }

    if (this.registry.runTestId || prepared.runTestId) {
      const intentText =
        prepared.requestSeed?.user_intent ||
        prepared.requestSeed?.owner_proof_prompt ||
        null;
      // Scope to the mounted capability panel — listing pages co-mount valuation + scarcity.
      const panel = page.getByTestId(prepared.panelTestId).first();
      await panel.waitFor({ state: 'visible', timeout: 45_000 });
      if (intentText) {
        const intentTestId =
          prepared.intentTestId ||
          this.registry.intentTestId ||
          'intelligence-owner-proof-intent';
        const intent = panel
          .locator(
            `[data-testid="${intentTestId}"], [data-testid="intelligence-owner-proof-intent"], [data-owner-proof-intent="1"]`,
          )
          .first();
        if ((await intent.count()) > 0 && (await intent.isVisible().catch(() => false))) {
          await intent.fill(String(intentText), { timeout: 15_000 });
        }
      }
      const testId = prepared.runTestId || this.registry.runTestId;
      const btn = panel.getByTestId(testId).first();
      await btn.waitFor({ state: 'visible', timeout: 45_000 });
      await btn.scrollIntoViewIfNeeded?.().catch(() => null);
      // Click-triggered panels (recommendations, analytics, auction) must be enabled
      // before we claim the initiating action exists.
      const enabled = await page
        .waitForFunction(
          ({ panelId, id }) => {
            const root = document.querySelector(`[data-testid="${panelId}"]`);
            const el = root?.querySelector(`[data-testid="${id}"]`) || null;
            return Boolean(el && !el.disabled && el.getClientRects().length > 0);
          },
          { panelId: prepared.panelTestId, id: testId },
          { timeout: 45_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!enabled) {
        const err = new Error(
          `${EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST}: ` +
            `run control ${testId} never became enabled on ${prepared.route} panel=${prepared.panelTestId}`,
        );
        err.code = EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST;
        err.meta = {
          route: prepared.route,
          component: prepared.panelTestId,
          participant_side: prepared.participant_side,
          viewport: await page.viewportSize(),
          action: `click[data-testid=${testId}]`,
          expected_endpoint: prepared.apiPath,
        };
        throw err;
      }
      await page.evaluate(() => {
        const w = window;
        w.__OWNER_PROOF_HANDLER_REACHED__ = null;
      });
      const clickTimestamp = Date.now();
      await btn.click({ timeout: 30_000 });
      await new Promise((r) => setTimeout(r, 50));
      const handlerProbe = await page
        .evaluate(() => window.__OWNER_PROOF_HANDLER_REACHED__ || null)
        .catch(() => null);
      prepared._owner_proof_click_diag = {
        click_timestamp: clickTimestamp,
        button_enabled: true,
        hydration_ready: true,
        handler_reached: Boolean(handlerProbe?.at),
        handler_capability: handlerProbe?.capability || null,
        run_test_id: testId,
        panel_test_id: prepared.panelTestId,
      };
      // OwnerProofIntentControl stamps the probe; other run controls (negotiation) do not.
      const ownerProofControlCount = await panel.locator('[data-owner-proof-action="1"]').count();
      if (ownerProofControlCount > 0 && !handlerProbe?.at) {
        assertOwnerProofHandlerReached({
          route: prepared.route,
          component: prepared.panelTestId,
          capability: this.capability,
          action: `click[data-testid=${testId}]`,
          expected_endpoint: prepared.apiPath,
          handler_reached: false,
          handler_capability: null,
          click_timestamp: clickTimestamp,
          hydration_ready: true,
          button_enabled: true,
          request_candidates: [],
        });
      }
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
      // Negotiation is an exception: remounting wipes React turnHistory / prior_turns,
      // so stay on the loaded messages surface and re-trigger with the next intent.
      const routeBase = String(prepared.route || '/');
      const turnIndex = Number(prepared.turn_index) || 0;
      const skipRemount =
        this.capability === 'negotiation_assistance' &&
        turnIndex > 0 &&
        /\/messages/i.test(page.url());
      if (!skipRemount) {
        const turnNav =
          turnIndex > 0
            ? `${routeBase}${routeBase.includes('?') ? '&' : '?'}phase34_turn=${turnIndex}`
            : routeBase;
        await page.goto(turnNav, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      }
      await this.prepareLiveSurface(page, prepared);

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
      const panelWaitMs = this.capability === 'negotiation_assistance' ? 90_000 : 60_000;
      await panel.first().waitFor({ state: 'visible', timeout: panelWaitMs });
      screenshots.push(
        await captureProductScreenshot(page, {
          ...shotBase,
          state: 'before_action',
          capture_phase: 'before_action',
          response_available_at_capture: false,
          expected_locator_visible: true,
          terminal_state: null,
          fullPage: false,
          capture_mode: 'viewport',
        }),
      );

      const loadingLocator = page.getByTestId(`${prepared.panelTestId}-loading`);
      let initiatingAction = 'auto_mount_fetch';
      if ((this.registry.trigger || 'auto') !== 'auto') {
        initiatingAction =
          prepared.runTestId || this.registry.runTestId
            ? `click[data-testid=${prepared.runTestId || this.registry.runTestId}]`
            : this.registry.runButtonName
              ? `click[role=button name=${this.registry.runButtonName}]`
              : `trigger:${this.registry.trigger}`;
      }
      try {
        await this.triggerLiveAction(page, prepared);
      } catch (err) {
        if (
          err?.code === EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST ||
          err?.code === OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER
        ) {
          throw err;
        }
        const wrap = new Error(
          `${EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST}: ${err?.message || err}`,
        );
        wrap.code = EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST;
        wrap.meta = {
          route: prepared.route,
          component: prepared.panelTestId,
          participant_side: prepared.participant_side,
          viewport: await page.viewportSize(),
          action: initiatingAction,
          expected_endpoint: apiPath,
        };
        wrap.cause = err;
        throw wrap;
      }

      if ((await loadingLocator.count()) > 0) {
        screenshots.push(
          await captureProductScreenshot(page, {
            ...shotBase,
            state: 'loading',
            capture_phase: 'loading',
            response_available_at_capture: false,
            expected_locator_visible: true,
            terminal_state: null,
            fullPage: false,
            capture_mode: 'viewport',
          }),
        );
      }

      let response;
      try {
        response = await responsePromise;
      } catch (err) {
        const requestCandidates = await page
          .evaluate(() => {
            const perf = performance.getEntriesByType?.('resource') || [];
            return perf
              .filter((e) => String(e.name || '').includes('/api/ai/'))
              .slice(-20)
              .map((e) => e.name);
          })
          .catch(() => []);
        const diag = prepared._owner_proof_click_diag || {};
        const wrap = new Error(
          `${EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST}: ` +
            `no POST ${apiPath} after ${initiatingAction} on ${prepared.route} ` +
            `handler_reached=${diag.handler_reached} handler_capability=${diag.handler_capability} ` +
            `candidates=${JSON.stringify(requestCandidates)} (${err?.message || err})`,
        );
        wrap.code = EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST;
        wrap.meta = {
          route: prepared.route,
          component: prepared.panelTestId,
          participant_side: prepared.participant_side,
          viewport: await page.viewportSize(),
          action: initiatingAction,
          expected_endpoint: apiPath,
          ...diag,
          request_candidates: requestCandidates,
        };
        wrap.cause = err;
        throw wrap;
      }
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
      assertIntelligenceRequestInitiated({
        route: prepared.route,
        component: prepared.panelTestId,
        participant_side: prepared.participant_side,
        viewport: await page.viewportSize(),
        action: initiatingAction,
        expected_endpoint: apiPath,
        mounted: true,
        visible: true,
        browser_request_observed: true,
        request_body_captured: postData != null && typeof postData === 'object',
        response_observed: true,
      });
      const responseJson = await response.json().catch(() => null);
      const actionEnd = Date.now();
      let capturedEndpoint = apiPath;
      try {
        capturedEndpoint = new URL(response.url()).pathname || apiPath;
      } catch {
        const raw = String(response.url() || '');
        const idx = raw.indexOf('/api/');
        if (idx >= 0) capturedEndpoint = raw.slice(idx).split('?')[0] || apiPath;
      }

      captures.push({
        browser_request_id: request.headers()['x-request-id'] || `br_${actionStart}`,
        route: prepared.route,
        method: 'POST',
        endpoint: capturedEndpoint,
        body: postData,
        status: response.status(),
        started_at: new Date(actionStart).toISOString(),
        finished_at: new Date(actionEnd).toISOString(),
        initiating_action: initiatingAction,
      });

      await page
        .getByTestId(`${prepared.panelTestId}-loading`)
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => null);

      await awaitTerminalPanelReady(page, {
        capability: this.capability,
        panelTestId: prepared.panelTestId,
      });

      const rendered = await this.extractRendered(page, prepared, responseJson);
      const panelEl = page.getByTestId(prepared.panelTestId).first();
      const panelDataCapability =
        (await panelEl.getAttribute('data-capability').catch(() => null)) || null;
      const panelTitle =
        (await panelEl.locator('h3').first().innerText().catch(() => '')) ||
        (await panelEl.innerText().catch(() => ''));
      const capabilityIdentity = assertCapabilityCaptureIdentity({
        expected_capability: this.capability,
        mounted_component: prepared.panelTestId,
        endpoint: capturedEndpoint,
        response_schema_hint: responseJson?.result || responseJson,
        rendered_capability: panelDataCapability,
        panel_data_capability: panelDataCapability,
        panel_title: panelTitle,
      });

      const a11y = await executeAccessibilityChecks(page, { panelTestId: prepared.panelTestId });
      const clientProtocol = await observeClientProtocol(page);
      const finalState = this.classifyVisualState(prepared, responseJson, rendered);
      const terminalShotState = finalState === 'success' ? 'final' : finalState;
      // Always locator-capture the expected capability panel so sibling panels
      // (e.g. scarcity on listing detail) cannot become the valuation evidence.
      const panelLocator = page.getByTestId(prepared.panelTestId).first();
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
          fullPage: false,
          capture_mode: 'locator',
          locator: panelLocator,
          capability_identity: capabilityIdentity,
        }),
      );

      const pipelineObservation = derivePipelineObservationFromResponse({
        capability: this.capability,
        responseJson,
        requestStartedAt: new Date(actionStart).toISOString(),
        requestFinishedAt: new Date(actionEnd).toISOString(),
        browser_request_id: captures[0]?.browser_request_id || null,
      });

      const disclosureSuffixes = ['evidence', 'limitations'];
      const screenshotStateRecords = [];
      let previousDisclosureSha256 = null;
      let previousDisclosureSuffix = null;
      let previousDisclosureDomHash = null;

      const readDisclosureState = async (testId) =>
        page.evaluate((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!el) return null;
          const content = document.querySelector(`[data-testid="${id}-content"]`) || el.querySelector(':scope > ul');
          const style = content ? window.getComputedStyle(content) : null;
          const contentVisible = Boolean(
            content &&
              style &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              !content.hasAttribute('hidden'),
          );
          // Stable DOM fingerprint of the active panel subtree for state distinctness.
          const panel = el.closest('[data-testid]')?.parentElement || el.parentElement || el;
          const text = (panel.textContent || '').replace(/\s+/g, ' ').trim();
          const openAttr = el.hasAttribute('open') ? '1' : '0';
          const aria = el.getAttribute('aria-expanded');
          const fingerprint = `${id}|aria=${aria}|open=${openAttr}|visible=${contentVisible}|${text}`;
          let h = 0;
          for (let i = 0; i < fingerprint.length; i += 1) {
            h = (Math.imul(31, h) + fingerprint.charCodeAt(i)) | 0;
          }
          return {
            aria_expanded: aria,
            open: el instanceof HTMLDetailsElement ? el.open : openAttr === '1',
            content_visible: contentVisible,
            dom_hash: `dom_${(h >>> 0).toString(16)}`,
          };
        }, testId);

      for (const suffix of disclosureSuffixes) {
        // Scope to the active panel's own subtree so a sibling panel's
        // identically-named testid can never be captured instead.
        const details = panelLocator.locator(`[data-testid="${prepared.panelTestId}-${suffix}"]`);
        if ((await details.count()) === 0) continue;
        const first = details.first();
        const controlTestId = `${prepared.panelTestId}-${suffix}`;

        // Collapse any other disclosure that is already open before opening
        // this one, so an evidence screenshot can never be captured while
        // limitations is also expanded (and vice versa).
        for (const otherSuffix of disclosureSuffixes) {
          if (otherSuffix === suffix) continue;
          const otherTestId = `${prepared.panelTestId}-${otherSuffix}`;
          const other = panelLocator.locator(`[data-testid="${otherTestId}"]`).first();
          if ((await other.count()) === 0) continue;
          const otherState = await readDisclosureState(otherTestId);
          if (otherState && (otherState.aria_expanded === 'true' || otherState.open || otherState.content_visible)) {
            await other.locator('> summary').first().click().catch(() => null);
            await page
              .waitForFunction(
                (id) => {
                  const el = document.querySelector(`[data-testid="${id}"]`);
                  if (!el) return true;
                  const aria = el.getAttribute('aria-expanded');
                  const open = el instanceof HTMLDetailsElement ? el.open : el.hasAttribute('open');
                  return aria === 'false' || (!open && aria !== 'true');
                },
                otherTestId,
                { timeout: 5_000 },
              )
              .catch(() => null);
          }
        }

        const preState = (await readDisclosureState(controlTestId)) || {
          aria_expanded: null,
          open: false,
          content_visible: false,
          dom_hash: null,
        };
        const ariaBefore = preState.aria_expanded;
        const preDomHash = preState.dom_hash;

        // If the disclosure is already expanded (e.g. prior turn left it open),
        // do not click — the summary toggles closed and the harness would fail.
        const alreadyOpen =
          ariaBefore === 'true' ||
          (preState.open === true && ariaBefore !== 'false') ||
          preState.content_visible === true;

        if (!alreadyOpen) {
          await first.locator('> summary').first().click();
          // Wait for aria-expanded to actually flip rather than assuming the click landed.
          await page
            .waitForFunction(
              ({ testId, before }) => {
                const el = document.querySelector(`[data-testid="${testId}"]`);
                if (!el) return false;
                const aria = el.getAttribute('aria-expanded');
                if (aria != null && aria !== before) return aria === 'true';
                // Fallback for older builds that only expose native details.open.
                return el instanceof HTMLDetailsElement && el.open === true;
              },
              { testId: controlTestId, before: ariaBefore },
              { timeout: 5_000 },
            )
            .catch(() => null);
        }

        const postState = (await readDisclosureState(controlTestId)) || {
          aria_expanded: null,
          open: false,
          content_visible: false,
          dom_hash: null,
        };
        const ariaAfter = postState.aria_expanded;
        const contentVisible = postState.content_visible;
        const expandedOk =
          (ariaAfter === 'true' || (ariaAfter == null && postState.open === true)) && contentVisible;

        if (!expandedOk) {
          const err = new Error(
            `${DISCLOSURE_DID_NOT_EXPAND}: ${controlTestId} aria-expanded stayed ` +
              `"${ariaAfter}" (before="${ariaBefore}"), content_visible=${contentVisible}`,
          );
          err.code = DISCLOSURE_DID_NOT_EXPAND;
          throw err;
        }

        // Re-run a11y on expanded terminal-adjacent state for turn-specific evidence
        const expandA11y = await executeAccessibilityChecks(page, {
          panelTestId: prepared.panelTestId,
        });
        const requestedState = suffix === 'evidence' ? 'evidence_expanded' : 'limitations_expanded';
        const shotRow = await captureProductScreenshot(page, {
          ...shotBase,
          state: requestedState,
          capture_phase: 'expanded',
          terminal_state: null,
          response_available_at_capture: true,
          expected_locator_visible: true,
          accessibility_status: expandA11y.accessibility_result,
          horizontal_overflow: expandA11y.horizontal_overflow,
          fullPage: false,
          capture_mode: 'locator',
          locator: panelLocator,
        });

        if (previousDisclosureSha256 && shotRow.sha256 === previousDisclosureSha256) {
          const err = new Error(
            `${DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE}: ${previousDisclosureSuffix}_expanded ` +
              `and ${suffix}_expanded produced identical screenshots for ${prepared.panelTestId}`,
          );
          err.code = DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE;
          throw err;
        }
        if (previousDisclosureDomHash && postState.dom_hash === previousDisclosureDomHash) {
          const err = new Error(
            `${DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE}: ${previousDisclosureSuffix}_expanded ` +
              `and ${suffix}_expanded produced identical DOM hashes for ${prepared.panelTestId}`,
          );
          err.code = DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE;
          throw err;
        }
        previousDisclosureSha256 = shotRow.sha256;
        previousDisclosureSuffix = suffix;
        previousDisclosureDomHash = postState.dom_hash;

        const screenshotStateRecord = {
          requested_state: requestedState,
          control_test_id: controlTestId,
          pre_aria_expanded: ariaBefore,
          post_aria_expanded: ariaAfter,
          visible_section_test_id: `${controlTestId}-content`,
          pre_dom_hash: preDomHash,
          post_dom_hash: postState.dom_hash,
          screenshot_sha256: shotRow.sha256,
          measurement_status: ariaAfter === 'true' ? 'ARIA_EXPANDED_CONFIRMED' : 'NATIVE_OPEN_FALLBACK',
          content_visible: contentVisible,
        };
        shotRow.screenshot_state_record = screenshotStateRecord;
        screenshotStateRecords.push(screenshotStateRecord);
        screenshots.push(shotRow);
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
        screenshot_state_records: screenshotStateRecords,
        pipelineObservation,
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

  async captureCanonicalRequest(browserResult, prepared = null) {
    const cap = browserResult.network_captures?.[0];
    if (!cap?.body) {
      const err = new Error('no browser intelligence request captured');
      err.code = 'PHASE34_PRODUCT_NO_BROWSER_REQUEST';
      throw err;
    }
    const sanitized = sanitizeCanonicalBody(cap.body, this.capability);
    assertNoRuntimeForceFloorsInBody(sanitized, {
      screenshotPack: prepared?.screenshot_pack,
    });
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
    const id = String(context.scenario_id || '');
    const mode = id.includes('hybrid')
      ? 'hybrid'
      : id.includes('semantic') || id.includes('search-success')
        ? 'semantic'
        : context.scenario_class?.includes('hybrid')
          ? 'hybrid'
          : 'keyword';
    const query =
      context.user_intent ||
      (mode === 'keyword' ? 'Miles Davis' : 'Find first US mono pressings similar to this record under $80.');
    return {
      ...super.buildRequestSeed(context, subject),
      retrieval_mode_requested: mode,
      query,
      user_intent: query,
      owner_proof_prompt: query,
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
    const FOUR_TURN = [
      'They offered $35 for my $41 listing. What should I do?',
      'The sleeve has a seam split, and shipping will cost me $6.',
      'I would accept $37, but I do not want to sound desperate.',
      'Draft the reply.',
    ];
    const turnIndex = Number(context.turn_index || 0);
    const multi =
      context.multi_turn_class === 'multi_4_12' ||
      context.scenario_id === 'negotiation-four-turn-live';
    const user_intent = multi
      ? FOUR_TURN[turnIndex % FOUR_TURN.length]
      : context.user_intent || FOUR_TURN[0];
    return {
      ...super.buildRequestSeed(context, subject),
      automatic_send_allowed: false,
      unauthorized_thread: context.authorization_state === 'unauthorized',
      user_intent,
      owner_proof_prompt: user_intent,
      owner_proof_scenario_id: context.scenario_id || null,
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
      'user_intent',
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
