/**
 * Phase 34 live inference gauntlet dimensions (logical sessions × H1/H2/H3).
 * Distinct from Phase 33F target root — never uses
 * /tmp/phase33f-capability-gauntlet-target-v1.
 */
export const PHASE34_LIVE_GAUNTLET_ROOT = '/tmp/phase34-live-inference-gauntlet-v1';
export const PHASE34_LIVE_CANARY_ROOT = '/tmp/phase34-live-inference-canary-v1';
export const PHASE33F_TARGET_ROOT_FORBIDDEN = '/tmp/phase33f-capability-gauntlet-target-v1';

/** 20,000 unique logical sessions; 2,500 per capability; ×3 protocols = 60,000 probes. */
export const PHASE34_LIVE_GAUNTLET = Object.freeze({
  probes: 60000,
  batches: 20000,
  batchesPerCapability: 2500,
  probesPerCapability: 7500,
  perProtocol: 20000,
  capabilities: 8,
  rate_policy_version: 'phase33f-rate-v1',
  inter_batch_interval_ms: 1000,
  triplet_start_spread_limit_ms: 100,
  MODEL_WEIGHT_TRAINING: 'NO',
  OPTIMIZATION: 'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
  production_default: 'keyword',
  PERCENT: 0,
  ALLOW_PROD_PERCENT: 0,
});
