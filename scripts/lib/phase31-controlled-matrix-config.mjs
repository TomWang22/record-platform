/**
 * Phase 31D-R2 — repaired staging long-soak matrix configuration.
 * Not merged into Phase 22 parity totals (57105/171315) or Phase 30/31M evidence.
 */
export const STAGING_TARGET = {
  name: 'controlled staging/non-prod',
  k8s_namespace: 'record-platform',
  k8s_deployment: 'python-ai-service',
  api_base: 'https://record-platform.test',
  database: 'python_ai@127.0.0.1:5440',
  kpi_environment: 'staging',
};

export const MATRIX_EVIDENCE_LABEL =
  'Phase 31D-R2 repaired staging long-soak matrix: 51840/51840 target';

export const MATRIX_TARGET = {
  total: 51840,
  perProtocol: 17280,
  windows: 32,
  users: 6,
  runs: 10,
  cases: 9,
};

export const DEFAULT_MATRIX_OUT = '/tmp/phase31d-r2-repaired-staging-long-soak';
export const DEFAULT_KPI_REPORT_OUT = '/tmp/phase31-kpi-report';
export const MATRIX_WORKFLOW = 'phase31d_r2_repaired_staging_long_soak';
export const ARTIFACT_PREFIX = 'phase31';

/** Env PHASE31_MATRIX_ROOT overrides default R2 soak output (never the blocked original soak). */
export function resolvePhase31MatrixRoot(env = process.env) {
  return env.PHASE31_MATRIX_ROOT || DEFAULT_MATRIX_OUT;
}
