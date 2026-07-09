/**
 * Phase 30F — controlled staging KPI enablement matrix configuration.
 * Separate evidence label from Phase 22, 28, and 29 matrices.
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
  'Phase 30 controlled staging KPI enablement matrix: 25920/25920 target';

export const MATRIX_TARGET = {
  total: 25920,
  perProtocol: 8640,
  windows: 16,
  users: 6,
  runs: 10,
  cases: 9,
};

export const DEFAULT_MATRIX_OUT = '/tmp/phase30-controlled-staging-matrix';
export const DEFAULT_KPI_REPORT_OUT = '/tmp/phase30-kpi-report';
export const MATRIX_WORKFLOW = 'phase30_staging_matrix';
export const ARTIFACT_PREFIX = 'phase30';
