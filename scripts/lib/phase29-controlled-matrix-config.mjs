/**
 * Phase 29E — controlled production-enablement matrix configuration.
 * Separate evidence label from Phase 22 full parity and Phase 28 production-readiness matrix.
 */
export const MATRIX_EVIDENCE_LABEL =
  'Phase 29 controlled observability production-enablement matrix: 25920/25920 target';

export const MATRIX_TARGET = {
  total: 25920,
  perProtocol: 8640,
  windows: 16,
  users: 6,
  runs: 10,
  cases: 9,
};

export const DEFAULT_MATRIX_OUT = '/tmp/phase29-controlled-observability-matrix';
export const DEFAULT_KPI_REPORT_OUT = '/tmp/phase29-kpi-report';
export const MATRIX_WORKFLOW = 'phase29_controlled_matrix';
export const ARTIFACT_PREFIX = 'phase29';
