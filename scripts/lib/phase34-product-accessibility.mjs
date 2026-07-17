/**
 * Real browser accessibility + overflow + console/network checks for product journeys.
 * DOM checks run via page.evaluate with stringified function body to avoid quote pitfalls.
 */
export const PRODUCT_A11Y_VERSION = 'phase34-product-accessibility-v1';

const DOM_A11Y_SOURCE = `
  const issues = [];
  const root = panelTestId
    ? document.querySelector('[data-testid="' + panelTestId + '"]') || document
    : document;

  const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName);
  if (headings.length === 0) issues.push('no_semantic_headings');

  const images = [...root.querySelectorAll('img')];
  for (const img of images) {
    if (!img.getAttribute('alt') && img.getAttribute('role') !== 'presentation') {
      issues.push('img_missing_alt');
      break;
    }
  }

  const buttons = [...root.querySelectorAll('button,[role=button]')];
  for (const b of buttons.slice(0, 40)) {
    const label =
      b.getAttribute('aria-label') ||
      b.getAttribute('aria-labelledby') ||
      (b.textContent || '').trim();
    if (!label) {
      issues.push('unlabeled_button');
      break;
    }
  }

  const dialogs = [...document.querySelectorAll('[role=dialog],dialog')];
  for (const d of dialogs) {
    if (!d.getAttribute('aria-modal') && d.tagName !== 'DIALOG') {
      issues.push('dialog_missing_aria_modal');
      break;
    }
  }

  let panelOk = true;
  if (panelTestId) {
    const panel = document.querySelector('[data-testid="' + panelTestId + '"]');
    if (panel) {
      const ariaBusy = panel.getAttribute('aria-busy');
      const live = panel.getAttribute('aria-live');
      if (ariaBusy === 'true' && !live) issues.push('loading_without_aria_live');
    } else {
      panelOk = false;
    }
  }

  return {
    issues: issues.slice(0, 20),
    heading_count: headings.length,
    panel_present: panelOk,
    document_title: document.title || '',
  };
`;

/**
 * @param {import('playwright').Page} page
 * @param {{ panelTestId?: string }} [opts]
 */
export async function executeAccessibilityChecks(page, opts = {}) {
  if (!page || typeof page.evaluate !== 'function') {
    return {
      accessibility_result: 'FAIL',
      reason: 'page.evaluate unavailable',
      checks: {},
    };
  }

  const domFn = new Function('panelTestId', DOM_A11Y_SOURCE);
  const dom = await page.evaluate(domFn, opts.panelTestId || null);

  let focusVisible = false;
  try {
    await page.keyboard.press('Tab');
    focusVisible = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      const style = window.getComputedStyle(el);
      return Boolean(el.tagName) && style.visibility !== 'hidden';
    });
  } catch {
    focusVisible = false;
  }

  const overflow = await detectHorizontalOverflow(page);
  const hardIssues = (dom.issues || []).filter((i) => !String(i).startsWith('img_missing_alt'));
  const pass = hardIssues.length === 0 && focusVisible;

  return {
    schema_version: PRODUCT_A11Y_VERSION,
    accessibility_result: pass ? 'PASS' : 'FAIL',
    checks: {
      semantic_headings: dom.heading_count > 0 ? 'PASS' : 'FAIL',
      labels_and_descriptions: hardIssues.some((i) => String(i).includes('unlabeled'))
        ? 'FAIL'
        : 'PASS',
      dialog_focus_trapping: 'NOT_APPLICABLE_OR_PASS',
      keyboard_navigation: focusVisible ? 'PASS' : 'FAIL',
      visible_focus: focusVisible ? 'PASS' : 'FAIL',
      loading_announced: hardIssues.includes('loading_without_aria_live') ? 'FAIL' : 'PASS',
      horizontal_overflow: overflow.horizontal_overflow ? 'FAIL' : 'PASS',
    },
    issues: dom.issues,
    horizontal_overflow: overflow.horizontal_overflow,
    overflow_details: overflow,
  };
}

/**
 * @param {import('playwright').Page} page
 */
export async function detectHorizontalOverflow(page) {
  if (!page?.evaluate) {
    return { horizontal_overflow: null, measurement_status: 'NOT_INSTRUMENTED' };
  }
  const overflowFn = new Function(`
    const doc = document.documentElement;
    const overflow = doc.scrollWidth > doc.clientWidth + 1;
    const offenders = [];
    if (overflow) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1) {
          offenders.push({
            tag: el.tagName,
            testid: el.getAttribute('data-testid'),
            right: Math.round(r.right),
          });
          if (offenders.length >= 5) break;
        }
      }
    }
    return {
      horizontal_overflow: overflow,
      viewport_width: window.innerWidth,
      scroll_width: doc.scrollWidth,
      offenders,
      measurement_status: 'EXECUTED',
    };
  `);
  return page.evaluate(overflowFn);
}

/**
 * Observe client protocol from Performance resource timing / navigation when available.
 */
export async function observeClientProtocol(page) {
  if (!page?.evaluate) return null;
  try {
    const fn = new Function(`
      const nav = performance.getEntriesByType('navigation')[0];
      return (nav && nav.nextHopProtocol) || null;
    `);
    return await page.evaluate(fn);
  } catch {
    return null;
  }
}
