/**
 * Phase 32H — targeted pre-first-byte latency reproduction configuration.
 */
import { PROMPTS } from './phase22-full-replay-common.mjs';

export const DEFAULT_PHASE32H_OUT = '/tmp/phase32h-targeted-reproduction';

export const PHASE32H_EVIDENCE_LABEL =
  'Phase 32H targeted pre-first-byte latency reproduction matrix: 17280/17280 target';

export const TARGET_TOTAL = 17280;
export const TARGET_PER_PROTOCOL = 5760;

export const TARGETED_WINDOWS = Array.from({ length: 16 }, (_, i) => i + 1);
export const TARGETED_RUNS = Array.from({ length: 10 }, (_, i) => i + 1);
export const TARGETED_PROTOCOLS = ['h1', 'h2', 'h3'];

/** Top-6 cases from Phase 32H-B extreme-row frequency; final_tagged_plan mandatory. */
export const TARGETED_CASE_IDS = [
  'final_tagged_plan',
  'pricing_strategy',
  'listing_advice',
  'auction_pressure',
  'collector_metadata',
  'red_team_overclaim',
];

export const EXTREME_THRESHOLD_MS = 60_000;
export const WATCHDOG_TRIGGER_MS = 60_000;
export const DIAGNOSTIC_POST_COMPLETE_MS = 15 * 60_000;

export const FORBIDDEN_INFLIGHT_FIELDS = [
  'question',
  'response_body',
  'raw_response_body',
  'message_body',
  'jwt',
  'token',
  'password',
  'user_email',
  'user_uid',
  'authorization_header',
];

export function resolvePhase32hRoot(env = process.env) {
  return env.PHASE32H_MATRIX_ROOT || DEFAULT_PHASE32H_OUT;
}

export function isPhase32hRoot(root) {
  const normalized = String(root).replace(/\/+$/, '');
  return (
    normalized === DEFAULT_PHASE32H_OUT ||
    normalized.endsWith('phase32h-targeted-reproduction') ||
    normalized.includes('/phase32h-targeted-reproduction/')
  );
}

export function targetedPrompts() {
  const byId = new Map(PROMPTS);
  return TARGETED_CASE_IDS.map((caseId) => {
    const question = byId.get(caseId);
    if (!question) {
      throw new Error(`missing targeted case: ${caseId}`);
    }
    return [caseId, question];
  });
}

export function matrixDimensions() {
  return {
    protocols: TARGETED_PROTOCOLS.length,
    windows: TARGETED_WINDOWS.length,
    users: 6,
    runs: TARGETED_RUNS.length,
    cases: TARGETED_CASE_IDS.length,
    per_protocol:
      TARGETED_WINDOWS.length * 6 * TARGETED_RUNS.length * TARGETED_CASE_IDS.length,
    total: TARGET_TOTAL,
  };
}
