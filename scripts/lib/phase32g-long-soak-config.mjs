/**
 * Phase 32G — timing-attributed repaired long-soak configuration.
 * Not merged into Phase 31D-R2, 22/28/29/30/31 evidence totals.
 */
export const DEFAULT_PHASE32G_MATRIX_OUT = '/tmp/phase32g-timing-attributed-repaired-long-soak';

export const PHASE32G_EVIDENCE_LABEL =
  'Phase 32G timing-attributed repaired long-soak matrix: 51840/51840 target';

export const TARGET_TOTAL = 51840;
export const TARGET_PER_PROTOCOL = 17280;

export const MATRIX_TARGET = {
  total: TARGET_TOTAL,
  perProtocol: TARGET_PER_PROTOCOL,
  windows: 32,
  users: 6,
  runs: 10,
  cases: 9,
};

export const DEFAULT_STALL_ANALYSIS_OUT = '/tmp/phase32g-stall-attribution-analysis';

export const RCA_OUTLIER_THRESHOLD_MS = 300_000;
export const RCA_NOT_REPRODUCED_THRESHOLD_MS = 60_000;
export const RCA_ATTRIBUTION_SHARE = 0.8;

export function resolvePhase32gMatrixRoot(env = process.env) {
  return env.PHASE32G_MATRIX_ROOT || DEFAULT_PHASE32G_MATRIX_OUT;
}

export function isPhase32gRoot(rootOrEnv, maybeRoot) {
  const root =
    typeof rootOrEnv === 'string'
      ? rootOrEnv
      : resolvePhase32gMatrixRoot(rootOrEnv);
  const normalized = String(root).replace(/\/+$/, '');
  return (
    normalized === DEFAULT_PHASE32G_MATRIX_OUT ||
    normalized.endsWith('phase32g-timing-attributed-repaired-long-soak')
  );
}

export function resolveMatrixEvidenceLabel(env = process.env, outDir = null) {
  const root = outDir || env.PHASE32G_MATRIX_ROOT || env.PHASE31_MATRIX_ROOT || '';
  if (isPhase32gRoot(root)) return PHASE32G_EVIDENCE_LABEL;
  return null;
}
