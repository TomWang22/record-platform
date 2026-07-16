/**
 * Phase 33F capability-gauntlet canary / target launcher configuration.
 */
import { CAPABILITIES, PROTOCOLS } from './phase33f-manifest.mjs';

export const REAL_CANARY_ROOT = '/tmp/phase33f-capability-gauntlet-canary-v1';
export const REAL_TARGET_ROOT = '/tmp/phase33f-capability-gauntlet-target-v1';
export const FROZEN_CANARY_V3_ROOT = '/tmp/phase33f-capability-gauntlet-canary-v3';
export const SMOKE_ROOT = '/tmp/phase33f-canary-launcher-smoke-v1';
export const TARGET_SMOKE_ROOT = '/tmp/phase33f-target-launcher-smoke-v1';
export const AUTH_SMOKE_ROOT = '/tmp/phase33f-canary-auth-smoke-v1';
export const EDGE_REPAIR_ROOT = '/tmp/phase33f-edge-preflight-repair';
export const PRELAUNCH_EVIDENCE_ROOT = '/tmp/phase33f-canary-prelaunch';

/** Separate from canary PHASE33F_OWNER_LAUNCH_APPROVED_SHA — never interchangeable. */
export const TARGET_APPROVAL_SHA_ENV = 'PHASE33F_TARGET_OWNER_LAUNCH_APPROVED_SHA';
export const TARGET_APPROVAL_ROOT_ENV = 'PHASE33F_TARGET_OWNER_LAUNCH_APPROVED_ROOT';

export const TARGET_MANIFEST_SHA_PIN =
  'd97194d7a72ff1324c2d281d857d84dee18b4ed837c880e2972b2f753ed14f3c';
export const TARGET_WORKLOAD_HASH_PIN =
  '4e4415b008f0347d0fccd02a114dc0a98621944b859ca4754aaa6f5ee9af86b1';

export const CANARY = Object.freeze({
  probes: 720,
  batches: 240,
  batchesPerCapability: 30,
  probesPerCapability: 90,
  perProtocol: 240,
  // phase33f-rate-v1: pace below api-gateway express-rate-limit 300/min IP bucket
  rate_policy_version: 'phase33f-rate-v1',
  inter_batch_interval_ms: 1000,
  triplet_start_spread_limit_ms: 100,
});

export const SMOKE = Object.freeze({
  probes: 72,
  batches: 24,
  batchesPerCapability: 3,
  probesPerCapability: 9,
  perProtocol: 24,
});

export const TARGET = Object.freeze({
  probes: 17280,
  batches: 5760,
  batchesPerCapability: 720,
  probesPerCapability: 2160,
  perProtocol: 5760,
  capabilities: 8,
  rate_policy_version: 'phase33f-rate-v1',
  inter_batch_interval_ms: 1000,
  triplet_start_spread_limit_ms: 100,
});

/** Live target-launcher smoke only — never the real 17,280 target. */
export const TARGET_SMOKE = Object.freeze({
  probes: 72,
  batches: 24,
  batchesPerCapability: 3,
  probesPerCapability: 9,
  perProtocol: 24,
  rate_policy_version: 'phase33f-rate-v1',
  inter_batch_interval_ms: 1000,
  triplet_start_spread_limit_ms: 100,
});

export { CAPABILITIES, PROTOCOLS };

export const LAUNCHER_SOURCE_GLOBS = Object.freeze([
  'scripts/phase33f-launch-capability-canary.mjs',
  'scripts/phase33f-launch-capability-target.mjs',
  'scripts/phase33f-target-launcher-smoke.mjs',
  'scripts/phase33f-runtime-status-readonly.mjs',
  'scripts/lib/phase33f-canary-config.mjs',
  'scripts/lib/phase33f-canary-manifest.mjs',
  'scripts/lib/phase33f-canary-preflight.mjs',
  'scripts/lib/phase33f-target-preflight.mjs',
  'scripts/lib/phase33f-capability-launch-core.mjs',
  'scripts/lib/phase33f-frozen-canary-v3.mjs',
  'scripts/lib/phase33f-auth-smoke.mjs',
  'scripts/lib/phase33f-quic-pcap-preflight.mjs',
  'scripts/lib/phase32h-process-identity.mjs',
  'scripts/lib/phase33f-capability-runner.mjs',
  'scripts/lib/phase33f-capability-probe.mjs',
  'scripts/lib/phase33f-capability-probe-worker.mjs',
  'scripts/lib/phase33f-terminal-verdict.mjs',
  'scripts/lib/phase33f-run-finalize.mjs',
  'scripts/lib/phase33f-rate-limit.mjs',
  'scripts/lib/phase33f-workload-hash.mjs',
  'scripts/lib/phase33f-runner-resource-telemetry.mjs',
  'scripts/lib/phase33f-manifest.mjs',
  'scripts/ai-platform/verify-phase33f-canary-manifest.mjs',
  'scripts/ai-platform/verify-phase33f-canary-launcher.mjs',
  'scripts/ai-platform/verify-phase33f-canary-preflight.mjs',
  'scripts/ai-platform/verify-phase33f-rate-capacity.mjs',
  'scripts/ai-platform/verify-phase33f-target-readiness.mjs',
  'scripts/ai-platform/verify-phase33f-target-manifest.mjs',
  'scripts/ai-platform/verify-phase33f-target-launcher.mjs',
  'scripts/ai-platform/verify-phase33f-target-preflight.mjs',
  'scripts/phase33f-target-telemetry-smoke.mjs',
  'tests/phase33f-canary-launcher.test.mjs',
  'tests/phase33f-blocked-freeze.test.mjs',
  'tests/phase33f-rate-limit-observability.test.mjs',
  'tests/phase33f-target-readiness.test.mjs',
  'tests/phase33f-target-launcher.test.mjs',
  'Makefile',
]);

export const EDGE_BASE_URL = 'https://record-platform.test';
export const EDGE_CA_CERT_REL = 'certs/dev-chain.pem';

export const CAPABILITY_ROUTE_PATHS = Object.freeze({
  // Gateway /api/ai → python-ai /ai/* (pathRewrite adds /ai). Direct /ai/* strips /ai and misses the FastAPI prefix.
  scarcity: '/api/ai/intelligence/scarcity',
  valuation: '/api/ai/intelligence/valuation',
  auction_intelligence: '/api/ai/intelligence/auction',
  negotiation_assistance: '/api/ai/intelligence/negotiation',
  recommendations: '/api/ai/intelligence/recommendations',
  market_analytics: '/api/ai/intelligence/market-analytics',
  embeddings: '/api/ai/intelligence/embeddings/metadata',
  semantic_search: '/api/ai/intelligence/semantic-search',
});

export function dimensionsForMode(mode) {
  switch (mode) {
    case 'canary':
      return CANARY;
    case 'smoke':
      return SMOKE;
    case 'target':
      return TARGET;
    default: {
      const _exhaustive = mode;
      throw new Error(`unknown phase33f mode: ${_exhaustive}`);
    }
  }
}

export function isRealGauntletRoot(outRoot) {
  return outRoot === REAL_CANARY_ROOT || outRoot === REAL_TARGET_ROOT;
}

export function isRealTargetRoot(outRoot) {
  return outRoot === REAL_TARGET_ROOT;
}
