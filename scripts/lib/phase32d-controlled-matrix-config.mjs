/**
 * Phase 32D — controlled timing attribution micro-soak configuration.
 */
export const MATRIX_EVIDENCE_LABEL =
  'Phase 32D timing attribution micro-soak: 3888/3888 target';

export const MATRIX_TARGET = {
  total: 3888,
  perProtocol: 1296,
  windows: 8,
  users: 6,
  runs: 3,
  cases: 9,
};

export const DEFAULT_MATRIX_OUT = '/tmp/phase32d-timing-attribution-micro-soak';
export const MATRIX_JSONL = 'phase31-matrix.jsonl';
export const OUTLIER_THRESHOLD_MS = 1_000_000;

export function resolvePhase32dMatrixRoot(env = process.env) {
  return env.PHASE32D_MATRIX_ROOT || DEFAULT_MATRIX_OUT;
}
