/**
 * Phase 32H-R1 — host-suspension A/B validation configuration.
 */
import { TARGETED_CASE_IDS, TARGETED_RUNS } from './phase32h-targeted-reproduction-config.mjs';

export const R1_BASELINE_ROOT = '/tmp/phase32h-r1-baseline';
export const R1_PROTECTED_ROOT = '/tmp/phase32h-r1-caffeinate';
export const R1_COMPARISON_ROOT = '/tmp/phase32h-r1-comparison';
export const R1_CANARY_ROOT = '/tmp/phase32h-r1-baseline-r2-canary';
export const R1_BASELINE_R2_ROOT = '/tmp/phase32h-r1-baseline-r2';
export const R1_BASELINE_R3_ROOT = '/tmp/phase32h-r1-baseline-r3';
export const R1_BASELINE_R4_ROOT = '/tmp/phase32h-r1-baseline-r4';
export const R1_BASELINE_R5_ROOT = '/tmp/phase32h-r1-baseline-r5';

export const R1_FORBIDDEN_BASELINE_ROOTS = [
  '/tmp/phase32h-r1-baseline',
  '/tmp/phase32h-r1-baseline-r2',
  '/tmp/phase32h-r1-baseline-r2-canary',
  '/tmp/phase32h-r1-baseline-r2-canary-v2',
  '/tmp/phase32h-r1-baseline-r3',
  '/tmp/phase32h-r1-baseline-r4',
  '/tmp/phase32h-targeted-reproduction',
];

export const R1_EVIDENCE_LABEL_BASELINE =
  'Phase 32H-R1 baseline synchronized-stall validation';
export const R1_EVIDENCE_LABEL_PROTECTED =
  'Phase 32H-R1 caffeinate synchronized-stall validation';
export const R1_EVIDENCE_LABEL_CANARY =
  'Phase 32H-R1 baseline-r2 canary synchronized-stall validation';

/** Eight windows from the Phase 32H extreme timeline (subset of 16-window soak). */
export const R1_WINDOWS = [1, 2, 3, 4, 5, 6, 7, 8];
export const R1_USERS = 6;
export const R1_RUNS = TARGETED_RUNS;
export const R1_CASE_IDS = TARGETED_CASE_IDS;
export const R1_PROTOCOLS = ['h1', 'h2', 'h3'];

export const R1_PER_PROTOCOL =
  R1_WINDOWS.length * R1_USERS * R1_RUNS.length * R1_CASE_IDS.length;
export const R1_TOTAL = R1_PER_PROTOCOL * R1_PROTOCOLS.length;

/** Canary: one window, one run, five cases, six users => 30 triplet batches / 90 probes. */
export const R1_CANARY_WINDOWS = [1];
export const R1_CANARY_RUNS = [1];
export const R1_CANARY_CASE_IDS = R1_CASE_IDS.slice(0, 5);
export const R1_CANARY_PER_PROTOCOL =
  R1_CANARY_WINDOWS.length * R1_USERS * R1_CANARY_RUNS.length * R1_CANARY_CASE_IDS.length;
export const R1_CANARY_TOTAL = R1_CANARY_PER_PROTOCOL * R1_PROTOCOLS.length;
export const R1_CANARY_BATCHES = R1_CANARY_PER_PROTOCOL;

export const BLOCKED_E3_ROOT = '/tmp/phase32h-targeted-reproduction';

export function r1Dimensions({ canary = false } = {}) {
  if (canary) {
    return {
      protocols: R1_PROTOCOLS.length,
      windows: R1_CANARY_WINDOWS.length,
      users: R1_USERS,
      runs: R1_CANARY_RUNS.length,
      cases: R1_CANARY_CASE_IDS.length,
      per_protocol: R1_CANARY_PER_PROTOCOL,
      total: R1_CANARY_TOTAL,
      triplet_batches: R1_CANARY_BATCHES,
      mode: 'canary',
    };
  }
  return {
    protocols: R1_PROTOCOLS.length,
    windows: R1_WINDOWS.length,
    users: R1_USERS,
    runs: R1_RUNS.length,
    cases: R1_CASE_IDS.length,
    per_protocol: R1_PER_PROTOCOL,
    total: R1_TOTAL,
    mode: 'full',
  };
}

export function evidenceLabelForArm(arm, { canary = false } = {}) {
  if (canary) return R1_EVIDENCE_LABEL_CANARY;
  if (arm === 'baseline') return R1_EVIDENCE_LABEL_BASELINE;
  if (arm === 'protected' || arm === 'caffeinate') return R1_EVIDENCE_LABEL_PROTECTED;
  throw new Error(`unknown R1 arm: ${arm}`);
}

export function rootForArm(arm, { canary = false } = {}) {
  if (canary) return R1_CANARY_ROOT;
  if (arm === 'baseline') return R1_BASELINE_ROOT;
  if (arm === 'protected' || arm === 'caffeinate') return R1_PROTECTED_ROOT;
  throw new Error(`unknown R1 arm: ${arm}`);
}
