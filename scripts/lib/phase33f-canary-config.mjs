/**
 * Phase 33F capability-gauntlet canary launcher configuration.
 */
import { CAPABILITIES, PROTOCOLS } from './phase33f-manifest.mjs';

export const REAL_CANARY_ROOT = '/tmp/phase33f-capability-gauntlet-canary-v1';
export const REAL_TARGET_ROOT = '/tmp/phase33f-capability-gauntlet-target-v1';
export const SMOKE_ROOT = '/tmp/phase33f-canary-launcher-smoke-v1';
export const AUTH_SMOKE_ROOT = '/tmp/phase33f-canary-auth-smoke-v1';
export const EDGE_REPAIR_ROOT = '/tmp/phase33f-edge-preflight-repair';
export const PRELAUNCH_EVIDENCE_ROOT = '/tmp/phase33f-canary-prelaunch';

export const CANARY = Object.freeze({
  probes: 720,
  batches: 240,
  batchesPerCapability: 30,
  probesPerCapability: 90,
  perProtocol: 240,
});

export const SMOKE = Object.freeze({
  probes: 72,
  batches: 24,
  batchesPerCapability: 3,
  probesPerCapability: 9,
  perProtocol: 24,
});

export { CAPABILITIES, PROTOCOLS };

export const LAUNCHER_SOURCE_GLOBS = Object.freeze([
  'scripts/phase33f-launch-capability-canary.mjs',
  'scripts/phase33f-runtime-status-readonly.mjs',
  'scripts/lib/phase33f-canary-config.mjs',
  'scripts/lib/phase33f-canary-manifest.mjs',
  'scripts/lib/phase33f-canary-preflight.mjs',
  'scripts/lib/phase33f-auth-smoke.mjs',
  'scripts/lib/phase33f-quic-pcap-preflight.mjs',
  'scripts/lib/phase32h-process-identity.mjs',
  'scripts/lib/phase33f-capability-runner.mjs',
  'scripts/lib/phase33f-capability-probe.mjs',
  'scripts/lib/phase33f-capability-probe-worker.mjs',
  'scripts/lib/phase33f-terminal-verdict.mjs',
  'scripts/lib/phase33f-run-finalize.mjs',
  'scripts/lib/phase33f-manifest.mjs',
  'scripts/ai-platform/verify-phase33f-canary-manifest.mjs',
  'scripts/ai-platform/verify-phase33f-canary-launcher.mjs',
  'scripts/ai-platform/verify-phase33f-canary-preflight.mjs',
  'tests/phase33f-canary-launcher.test.mjs',
  'tests/phase33f-blocked-freeze.test.mjs',
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
    default: {
      const _exhaustive = mode;
      throw new Error(`unknown phase33f mode: ${_exhaustive}`);
    }
  }
}

export function isRealGauntletRoot(outRoot) {
  return outRoot === REAL_CANARY_ROOT || outRoot === REAL_TARGET_ROOT;
}
