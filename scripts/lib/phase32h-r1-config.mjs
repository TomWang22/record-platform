/**
 * Phase 32H-R1 — host-suspension A/B validation configuration.
 */
import { TARGETED_CASE_IDS, TARGETED_RUNS } from './phase32h-targeted-reproduction-config.mjs';

export const R1_BASELINE_ROOT = '/tmp/phase32h-r1-baseline';
export const R1_PROTECTED_ROOT = '/tmp/phase32h-r1-caffeinate';
export const R1_COMPARISON_ROOT = '/tmp/phase32h-r1-comparison';

export const R1_EVIDENCE_LABEL_BASELINE =
  'Phase 32H-R1 baseline synchronized-stall validation';
export const R1_EVIDENCE_LABEL_PROTECTED =
  'Phase 32H-R1 caffeinate synchronized-stall validation';

/** Eight windows from the Phase 32H extreme timeline (subset of 16-window soak). */
export const R1_WINDOWS = [1, 2, 3, 4, 5, 6, 7, 8];
export const R1_USERS = 6;
export const R1_RUNS = TARGETED_RUNS;
export const R1_CASE_IDS = TARGETED_CASE_IDS;
export const R1_PROTOCOLS = ['h1', 'h2', 'h3'];

export const R1_PER_PROTOCOL =
  R1_WINDOWS.length * R1_USERS * R1_RUNS.length * R1_CASE_IDS.length;
export const R1_TOTAL = R1_PER_PROTOCOL * R1_PROTOCOLS.length;

export const BLOCKED_E3_ROOT = '/tmp/phase32h-targeted-reproduction';

export function r1Dimensions() {
  return {
    protocols: R1_PROTOCOLS.length,
    windows: R1_WINDOWS.length,
    users: R1_USERS,
    runs: R1_RUNS.length,
    cases: R1_CASE_IDS.length,
    per_protocol: R1_PER_PROTOCOL,
    total: R1_TOTAL,
  };
}

export function evidenceLabelForArm(arm) {
  if (arm === 'baseline') return R1_EVIDENCE_LABEL_BASELINE;
  if (arm === 'protected' || arm === 'caffeinate') return R1_EVIDENCE_LABEL_PROTECTED;
  throw new Error(`unknown R1 arm: ${arm}`);
}

export function rootForArm(arm) {
  if (arm === 'baseline') return R1_BASELINE_ROOT;
  if (arm === 'protected' || arm === 'caffeinate') return R1_PROTECTED_ROOT;
  throw new Error(`unknown R1 arm: ${arm}`);
}
