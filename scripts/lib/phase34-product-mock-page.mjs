/**
 * Minimal Playwright Page double that records real page.screenshot() semantics.
 * Writes PNG bytes to disk like Playwright would.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_PNG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/min-viewport-320x240.png',
);

export function createMockPlaywrightPage(opts = {}) {
  const screenshotCalls = [];
  const consoleHandlers = [];
  const pngBytes = fs.readFileSync(FIXTURE_PNG);
  const body = {
    postData: JSON.stringify(
      opts.requestBody || {
        capability: opts.capability || 'scarcity',
        production_mutation_allowed: false,
        subject: { id: 'subj_1' },
      },
    ),
  };

  const response = {
    ok: () => true,
    status: () => 200,
    request: () => ({
      postDataJSON: () => JSON.parse(body.postData),
      postData: () => body.postData,
      headers: () => ({ 'x-request-id': 'mock-br-1' }),
      method: () => 'POST',
    }),
    json: async () => ({
      result: opts.rendered || {
        classification: 'scarce',
        scarcity_class: 'scarce',
        confidence: 0.8,
        evidence_count: 3,
        limitations: [],
        abstention: false,
        capability: opts.capability || 'scarcity',
      },
    }),
    url: () => opts.apiPath || '/api/ai/intelligence/scarcity',
  };

  const locator = {
    count: async () => 1,
    first: () => locator,
    waitFor: async () => {},
    click: async () => {},
    innerText: async () => {
      const cap = opts.capability || 'scarcity';
      const titles = {
        scarcity: 'Scarcity intelligence',
        valuation: 'Valuation intelligence',
        auction_intelligence: 'Auction intelligence',
        embeddings: 'Embedding lineage (diagnostic)',
        semantic_search: 'Semantic search',
        negotiation_assistance: 'Negotiation assistance',
        recommendations: 'Recommendations',
        market_analytics: 'Market analytics',
      };
      return `${titles[cap] || 'Intelligence'}\nconfidence evidence ready`;
    },
    getAttribute: async (name) => {
      if (name === 'data-capability') return opts.capability || 'scarcity';
      return null;
    },
    locator() {
      return locator;
    },
  };

  const page = {
    screenshotCalls,
    on(event, handler) {
      if (event === 'console') consoleHandlers.push(handler);
    },
    async goto() {},
    async viewportSize() {
      return opts.viewport || { width: 1280, height: 720 };
    },
    async keyboard() {},
    keyboard: {
      press: async () => {},
    },
    getByTestId() {
      return locator;
    },
    locator() {
      return locator;
    },
    waitForResponse: async () => response,
    async evaluate(fn, arg) {
      if (typeof fn === 'function') {
        try {
          const src = Function.prototype.toString.call(fn);
          if (src.includes('scrollHeight') && src.includes('documentElement')) {
            const h = opts.documentHeight || 2000;
            return {
              document_scroll_height: h,
              document_client_height: (opts.viewport || { height: 720 }).height || 720,
              body_scroll_height: h,
              largest_dom_element: 'DIV#mock',
              largest_element_height: h,
              scroll_container_candidates: [],
            };
          }
          if (src.includes('scrollWidth') || (fn.name === '' && String(fn).includes('scrollWidth'))) {
            return {
              horizontal_overflow: false,
              viewport_width: 1280,
              scroll_width: 1280,
              offenders: [],
              measurement_status: 'EXECUTED',
            };
          }
          if (src.includes('activeElement')) return true;
          if (src.includes('nextHopProtocol')) return 'h2';
          if (src.includes('aria-busy') || src.includes('skeleton')) {
            return {
              loadingVisible: false,
              spinnerVisible: false,
              ariaBusy: false,
              skeletonVisible: false,
              terminalContentVisible: true,
              text: 'Scarcity intelligence confidence evidence ready',
            };
          }
          if (src.includes('panelTestId') || src.includes('no_semantic_headings') || String(fn).includes('no_semantic_headings')) {
            return {
              issues: [],
              heading_count: 2,
              panel_present: true,
              document_title: 'Record Platform',
            };
          }
          const result = fn(arg);
          if (result && typeof result === 'object') return result;
        } catch {
          /* fall through */
        }
        return {
          issues: [],
          heading_count: 2,
          panel_present: true,
          document_title: 'Record Platform',
        };
      }
      return arg;
    },
    async screenshot(optsShot = {}) {
      const filePath = optsShot.path;
      screenshotCalls.push({
        path: filePath,
        fullPage: Boolean(optsShot.fullPage),
        at: new Date().toISOString(),
      });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, pngBytes);
      return pngBytes;
    },
  };

  const locatorWithShot = {
    ...locator,
    screenshot: async (optsShot = {}) => page.screenshot(optsShot),
  };
  page.getByTestId = () => locatorWithShot;
  page.locator = () => locatorWithShot;

  return page;
}
