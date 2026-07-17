/**
 * Minimal Playwright Page double that records real page.screenshot() semantics.
 * Writes PNG bytes to disk like Playwright would.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Minimal valid 1x1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function createMockPlaywrightPage(opts = {}) {
  const screenshotCalls = [];
  const consoleHandlers = [];
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
    innerText: async () => 'Scarcity: scarce\nConfidence: 0.8',
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
        // Prefer executing the function against a minimal DOM stub when possible.
        try {
          const src = Function.prototype.toString.call(fn);
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
          // new Function bodies from accessibility module
          if (src.includes('panelTestId') || src.includes('no_semantic_headings') || String(fn).includes('no_semantic_headings')) {
            return {
              issues: [],
              heading_count: 2,
              panel_present: true,
              document_title: 'Record Platform',
            };
          }
          // Try invoke with panelTestId arg
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
    async screenshot({ path: filePath }) {
      screenshotCalls.push({ path: filePath, at: new Date().toISOString() });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, TINY_PNG);
      return TINY_PNG;
    },
  };

  return page;
}
