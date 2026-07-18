/**
 * Hard-fail when a journey captures the wrong capability panel/endpoint.
 */

const ENDPOINT_FRAGMENTS = Object.freeze({
  scarcity: ['/intelligence/scarcity'],
  valuation: ['/intelligence/valuation'],
  auction_intelligence: ['/intelligence/auction'],
  embeddings: ['/intelligence/embedding', '/embeddings'],
  semantic_search: ['/intelligence/search', '/semantic'],
  negotiation_assistance: ['/intelligence/negotiation'],
  recommendations: ['/intelligence/recommend'],
  market_analytics: ['/intelligence/market', '/analytics'],
});

const TITLE_FRAGMENTS = Object.freeze({
  scarcity: ['scarcity'],
  valuation: ['valuation'],
  auction_intelligence: ['auction', 'watchlist temperature', 'seller auction'],
  embeddings: ['embedding'],
  semantic_search: ['search'],
  negotiation_assistance: ['negotiation'],
  recommendations: ['recommendation'],
  market_analytics: ['market analytics', 'analytics'],
});

/**
 * @param {object} input
 */
export function assertCapabilityCaptureIdentity(input) {
  const expected = String(input.expected_capability || '');
  const mounted = String(input.mounted_component || '');
  const endpoint = String(input.endpoint || '');
  const rendered = String(input.rendered_capability || input.panel_data_capability || '');
  const title = String(input.panel_title || '');
  const schemaHint = input.response_schema_hint || null;

  const failures = [];
  if (!expected) failures.push('expected_capability missing');
  if (!mounted) failures.push('mounted_component missing');
  if (expected && mounted && !mounted.toLowerCase().includes(expected.split('_')[0])) {
    // allow panel ids like intelligence-watchlist-temperature-panel for auction_intelligence
    const okMount =
      mounted.includes(expected.replace(/_/g, '-')) ||
      (expected === 'auction_intelligence' &&
        (mounted.includes('auction') || mounted.includes('watchlist') || mounted.includes('seller-auction'))) ||
      (expected === 'semantic_search' && mounted.includes('search')) ||
      (expected === 'embeddings' && mounted.includes('embedding')) ||
      (expected === 'negotiation_assistance' && mounted.includes('negotiation')) ||
      (expected === 'market_analytics' && mounted.includes('analytics'));
    if (!okMount) failures.push(`mounted_component ${mounted} does not match ${expected}`);
  }

  const frags = ENDPOINT_FRAGMENTS[expected] || [];
  if (frags.length && endpoint && !frags.some((f) => endpoint.includes(f))) {
    failures.push(`endpoint ${endpoint} does not match ${expected}`);
  }

  if (rendered && rendered !== expected) {
    failures.push(`rendered_capability ${rendered} !== expected ${expected}`);
  }

  const titleFrags = TITLE_FRAGMENTS[expected] || [];
  if (title && titleFrags.length) {
    const lower = title.toLowerCase();
    if (!titleFrags.some((f) => lower.includes(f))) {
      failures.push(`panel_title "${title}" does not match ${expected}`);
    }
    // Hard fail the known defect class: valuation journey showing scarcity chrome.
    if (expected === 'valuation' && /scarcity/i.test(title)) {
      failures.push('valuation journey rendered scarcity panel title');
    }
    if (expected === 'scarcity' && /valuation/i.test(title) && !/scarcity/i.test(title)) {
      failures.push('scarcity journey rendered valuation panel title');
    }
  }

  if (schemaHint && expected === 'valuation') {
    const keys = schemaHint && typeof schemaHint === 'object' ? Object.keys(schemaHint) : [];
    const valuationish = keys.some((k) =>
      /valuation|quick_sale|fair_market|patient_sale|sold_comparable/i.test(k),
    );
    const scarcityish =
      keys.some((k) => /scarcity_class|scarcity/i.test(k)) &&
      !keys.some((k) => /valuation|quick_sale|fair_market/i.test(k));
    if (scarcityish && !valuationish) {
      failures.push('valuation response schema looks like scarcity');
    }
  }

  if (failures.length) {
    const err = new Error(`CAPABILITY_IDENTITY_MISMATCH: ${failures.join('; ')}`);
    err.code = 'CAPABILITY_IDENTITY_MISMATCH';
    err.identity = {
      expected_capability: expected,
      mounted_component: mounted,
      endpoint,
      response_schema: schemaHint,
      rendered_capability: rendered || null,
      panel_title: title || null,
      failures,
    };
    throw err;
  }

  return {
    expected_capability: expected,
    mounted_component: mounted,
    endpoint,
    response_schema: schemaHint,
    rendered_capability: rendered || expected,
    panel_title: title || null,
    status: 'PASS',
  };
}
