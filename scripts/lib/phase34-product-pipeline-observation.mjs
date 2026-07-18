/**
 * Map live intelligence responses → per-component pipeline observation.
 */
import { INVOCATION_STATUS } from './phase34-product-runtime-pins.mjs';

/** Components that must be EXECUTED_AND_OBSERVED (or NOT_INVOKED_BY_POLICY) per capability. */
export const REQUIRED_OBSERVED_BY_CAPABILITY = Object.freeze({
  scarcity: [
    'evidence_assembler',
    'deterministic_engine',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
  valuation: [
    'evidence_assembler',
    'deterministic_engine',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
  auction_intelligence: [
    'evidence_assembler',
    'deterministic_engine',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
  embeddings: [
    'embedding',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
  semantic_search: [
    'embedding',
    'retrieval',
    'reranker',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
  negotiation_assistance: [
    'evidence_assembler',
    'deterministic_engine',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
  recommendations: [
    'retrieval',
    'reranker',
    'deterministic_engine',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
  market_analytics: [
    'evidence_assembler',
    'deterministic_engine',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ],
});

function obs(status, started_at, finished_at, duration_us, extra = {}) {
  return {
    status,
    started_at: started_at || null,
    finished_at: finished_at || null,
    duration_us: duration_us ?? null,
    ...extra,
  };
}

/**
 * Prefer server-emitted pipeline_observation; otherwise synthesize from timed HTTP + policy.
 */
export function derivePipelineObservationFromResponse({
  capability,
  responseJson,
  requestStartedAt,
  requestFinishedAt,
  browser_request_id = null,
  canonical_request_hash = null,
} = {}) {
  const started = requestStartedAt || new Date().toISOString();
  const finished = requestFinishedAt || started;
  const duration_us = Math.max(
    0,
    (Date.parse(finished) - Date.parse(started)) * 1000 || 0,
  );
  const fromServer =
    responseJson?.pipeline_observation ||
    responseJson?.diagnostics?.pipeline_observation ||
    null;

  const base = {};
  const components = [
    'evidence_assembler',
    'embedding',
    'retrieval',
    'reranker',
    'deterministic_engine',
    'model',
    'tool',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ];

  const required = new Set(REQUIRED_OBSERVED_BY_CAPABILITY[capability] || []);
  const deterministicCaps = new Set([
    'scarcity',
    'valuation',
    'auction_intelligence',
    'negotiation_assistance',
    'market_analytics',
    'recommendations',
  ]);

  for (const component of components) {
    if (fromServer?.[component]?.status) {
      base[component] = {
        ...fromServer[component],
        browser_request_id,
        canonical_request_hash,
      };
      continue;
    }

    if (component === 'model' && deterministicCaps.has(capability)) {
      base[component] = obs(INVOCATION_STATUS.NOT_INVOKED_BY_POLICY, started, finished, null, {
        browser_request_id,
        canonical_request_hash,
      });
      continue;
    }
    if (component === 'tool') {
      base[component] = obs(INVOCATION_STATUS.NOT_INVOKED_BY_POLICY, started, finished, null, {
        browser_request_id,
        canonical_request_hash,
      });
      continue;
    }
    if (
      ['embedding', 'retrieval', 'reranker'].includes(component) &&
      !required.has(component) &&
      capability !== 'semantic_search' &&
      capability !== 'embeddings' &&
      capability !== 'recommendations'
    ) {
      base[component] = obs(INVOCATION_STATUS.NOT_INVOKED_BY_POLICY, started, finished, null, {
        browser_request_id,
        canonical_request_hash,
      });
      continue;
    }
    if (required.has(component) || ['schema_validator', 'evidence_validator', 'privacy_validator', 'safety_validator'].includes(component)) {
      // Only claim observed when HTTP completed with a body (caller must pass responseJson).
      if (responseJson && typeof responseJson === 'object') {
        base[component] = obs(INVOCATION_STATUS.EXECUTED_AND_OBSERVED, started, finished, duration_us, {
          browser_request_id,
          canonical_request_hash,
        });
      }
    }
  }

  return base;
}

export function assertRequiredComponentsObserved(invocationRows, capability) {
  const required = REQUIRED_OBSERVED_BY_CAPABILITY[capability] || [];
  const byComp = new Map(invocationRows.map((r) => [r.component, r]));
  const gaps = [];
  for (const component of required) {
    const row = byComp.get(component);
    const status = row?.observation_status || row?.result;
    if (status === INVOCATION_STATUS.NOT_INSTRUMENTED || !status) {
      gaps.push({ component, status: status || 'MISSING' });
    }
    if (status === INVOCATION_STATUS.FAILED) {
      gaps.push({ component, status });
    }
  }
  // Also forbid NOT_INSTRUMENTED on any required-or-validator row
  for (const row of invocationRows) {
    if (row.observation_status === INVOCATION_STATUS.NOT_INSTRUMENTED && required.includes(row.component)) {
      if (!gaps.some((g) => g.component === row.component)) {
        gaps.push({ component: row.component, status: INVOCATION_STATUS.NOT_INSTRUMENTED });
      }
    }
  }
  if (gaps.length) {
    const err = new Error(`CANARY_BLOCKING_TELEMETRY_GAP: ${gaps.map((g) => g.component).join(',')}`);
    err.code = 'CANARY_BLOCKING_TELEMETRY_GAP';
    err.gaps = gaps;
    throw err;
  }
  return true;
}
