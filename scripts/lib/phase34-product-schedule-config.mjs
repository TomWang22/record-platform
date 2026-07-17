/**
 * Phase 34 product gauntlet — canonical scheduling contract (single source of truth).
 *
 * MAX_SPLIT_RUN = 16 is safe because the full schedule uses a 5-slot repeating
 * pattern (dev,dev,dev,validation,holdout) under capability round-robin, so the
 * theoretical contiguous split run is ≪ 16. The limit is an invariant ceiling,
 * not a target density.
 */
export const PRODUCT_SCHEDULE_CONFIG_VERSION = 'phase34-product-schedule-config-v1';

/** Round-robin ⇒ contiguous capability run must be exactly 1. */
export const MAX_CAPABILITY_RUN = 1;

/**
 * Maximum contiguous rows sharing the same dataset split.
 * Documented once — do not redeclare elsewhere.
 */
export const MAX_SPLIT_RUN = 16;

/** Maximum contiguous rows sharing the same participant role. */
export const MAX_PARTICIPANT_SIDE_RUN = 8;

/** Maximum contiguous rows sharing the same authorization class (7+1 pattern ⇒ ≤7). */
export const MAX_AUTHORIZATION_RUN = 8;

/** Alias kept for older imports — must equal MAX_PARTICIPANT_SIDE_RUN. */
export const MAX_SIDE_RUN = MAX_PARTICIPANT_SIDE_RUN;

/**
 * Dataset splits for the product gauntlet (no separate blinded bucket in schedule).
 * Blinded selection is a prompt-config stage, not a schedule split.
 */
export const DATASET_SPLITS = Object.freeze(['development', 'validation', 'holdout']);

export const FULL_SPLIT_COUNTS = Object.freeze({
  development: 12_000,
  validation: 4_000,
  holdout: 4_000,
});

/** Canary: same 3:1:1 ratio → 144 / 48 / 48. */
export const CANARY_SPLIT_COUNTS = Object.freeze({
  development: 144,
  validation: 48,
  holdout: 48,
});

/** Repeating interleave pattern yielding 3:1:1 counts. */
export const SPLIT_INTERLEAVE_PATTERN = Object.freeze([
  'development',
  'development',
  'development',
  'validation',
  'holdout',
]);

export const PRODUCT_SCALE = Object.freeze({
  full: {
    logicalSessions: 20_000,
    perCapability: 2_500,
    minMultiTurnSessions: 2_000,
    minHumanReviews: 800,
    minProtocolProbesSingleTurn: 60_000,
    splitCounts: FULL_SPLIT_COUNTS,
  },
  canary: {
    logicalSessions: 240,
    perCapability: 30,
    minMultiTurnSessions: 24,
    minPrivacyAdversarial: 24,
    minWeakData: 24,
    minExactPressingAmbiguity: 24,
    minProtocolProbes: 720,
    splitCounts: CANARY_SPLIT_COUNTS,
  },
});

export const DEFAULT_SCHEDULE_SEED = Object.freeze({
  canary: 'phase34-product-canary-v1',
  full: 'phase34-product-gauntlet-v1',
});
