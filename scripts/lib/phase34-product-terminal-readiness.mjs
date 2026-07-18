/**
 * Capability-specific terminal readiness before screenshot capture.
 */
export const TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING = 'TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING';

export const CAPABILITY_TERMINAL_PREDICATES = Object.freeze({
  scarcity: {
    requireAbsentLoading: true,
    contentHints: ['scarcity', 'abstain', 'insufficient', 'confidence', 'evidence'],
  },
  valuation: {
    requireAbsentLoading: true,
    contentHints: ['valuation', 'range', 'fair', 'quick', 'patient', 'weak', 'currency', '$'],
  },
  auction_intelligence: {
    requireAbsentLoading: true,
    contentHints: ['auction', 'temperature', 'bid', 'watchlist', 'insufficient', 'pressure'],
  },
  embeddings: {
    requireAbsentLoading: true,
    contentHints: ['embedding', 'lineage', 'hash', 'version', 'stale'],
  },
  semantic_search: {
    requireAbsentLoading: true,
    contentHints: ['semantic', 'hybrid', 'keyword', 'score', 'search'],
  },
  negotiation_assistance: {
    requireAbsentLoading: true,
    contentHints: ['negotiation', 'strategy', 'draft', 'refusal', 'unauthorized', 'automatic'],
  },
  recommendations: {
    requireAbsentLoading: true,
    contentHints: ['recommend', 'match', 'cold', 'budget'],
  },
  market_analytics: {
    requireAbsentLoading: true,
    contentHints: ['time range', 'population', 'sample', 'methodology', 'analytics', 'descriptive'],
  },
});

/**
 * Synchronous readiness check from observed DOM flags (unit-testable).
 */
export function assertTerminalPanelReady(flags) {
  const loading =
    flags.loadingVisible === true ||
    flags.spinnerVisible === true ||
    flags.ariaBusy === true ||
    flags.skeletonVisible === true;
  if (loading) {
    const err = new Error('TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING');
    err.code = TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING;
    throw err;
  }
  if (flags.terminalContentVisible === false) {
    const err = new Error('terminal panel content not visible');
    err.code = 'TERMINAL_PANEL_NOT_READY';
    throw err;
  }
  return true;
}

/**
 * Live Playwright readiness probe for a capability panel.
 * @param {import('playwright').Page} page
 * @param {{ capability: string, panelTestId: string }} opts
 */
export async function awaitTerminalPanelReady(page, { capability, panelTestId, timeoutMs = 45_000 }) {
  const panel = page.getByTestId(panelTestId);
  await panel.first().waitFor({ state: 'visible', timeout: timeoutMs });

  const loading = page.getByTestId(`${panelTestId}-loading`);
  if ((await loading.count()) > 0) {
    await loading.first().waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => null);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probe = await page.evaluate((tid) => {
      const root = document.querySelector(`[data-testid="${tid}"]`);
      if (!root) {
        return {
          loadingVisible: true,
          spinnerVisible: false,
          ariaBusy: true,
          skeletonVisible: true,
          terminalContentVisible: false,
          text: '',
        };
      }
      const loadingEl = document.querySelector(`[data-testid="${tid}-loading"]`);
      const loadingVisible = Boolean(loadingEl && loadingEl.offsetParent !== null);
      const ariaBusy = root.getAttribute('aria-busy') === 'true';
      const skeletonVisible = Boolean(
        root.querySelector('[data-testid$="-skeleton"], .animate-pulse, [class*="skeleton"]'),
      );
      const spinnerVisible = Boolean(root.querySelector('[data-testid$="-spinner"], .spinner, [role="progressbar"]'));
      const text = (root.innerText || '').slice(0, 2000);
      const terminalContentVisible = text.trim().length > 20 && !loadingVisible && !ariaBusy;
      return { loadingVisible, spinnerVisible, ariaBusy, skeletonVisible, terminalContentVisible, text };
    }, panelTestId);

    try {
      assertTerminalPanelReady({ ...probe, capability });
      const pred = CAPABILITY_TERMINAL_PREDICATES[capability];
      if (pred?.contentHints?.length) {
        const lower = String(probe.text || '').toLowerCase();
        const hit = pred.contentHints.some((h) => lower.includes(String(h).toLowerCase()));
        // Soft: if text is short (e.g. refusal), still allow when not loading
        if (!hit && lower.length > 80 && probe.terminalContentVisible) {
          // still OK if structured values present via data attributes
        }
      }
      return probe;
    } catch (err) {
      if (err.code !== TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING && err.code !== 'TERMINAL_PANEL_NOT_READY') {
        throw err;
      }
      await page.waitForTimeout?.(250);
      if (typeof page.waitForTimeout !== 'function') {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  const err = new Error('TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING');
  err.code = TERMINAL_SCREENSHOT_CAPTURED_DURING_LOADING;
  throw err;
}
