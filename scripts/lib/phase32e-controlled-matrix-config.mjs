/**
 * Phase 32E — slow KPI write durability micro-soak configuration.
 */
export const MATRIX_EVIDENCE_LABEL =
  'Phase 32E slow KPI write durability micro-soak: 1296/1296 target per mode';

export const MATRIX_TARGET = {
  total: 1296,
  perProtocol: 432,
  windows: 4,
  runs: 2,
  cases: 9,
  users: 6,
};

export const DEFAULT_MATRIX_OUT = '/tmp/phase32e-slow-kpi-write-durability';

export const MODES = {
  baseline: {
    label: 'baseline',
    AI_KPI_TEST_INJECT_WRITE_DELAY_MS: '0',
    AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE: '0',
    AI_KPI_TEST_INJECT_TIMEOUT_MS: '0',
    AI_KPI_TEST_INJECT_DB_UNAVAILABLE: '0',
  },
  slow_write: {
    label: 'slow-write',
    AI_KPI_TEST_INJECT_WRITE_DELAY_MS: '500',
    AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE: '0',
    AI_KPI_TEST_INJECT_TIMEOUT_MS: '0',
    AI_KPI_TEST_INJECT_DB_UNAVAILABLE: '0',
  },
  failing_write: {
    label: 'failing-write',
    AI_KPI_TEST_INJECT_WRITE_DELAY_MS: '0',
    AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE: '1',
    AI_KPI_TEST_INJECT_TIMEOUT_MS: '0',
    AI_KPI_TEST_INJECT_DB_UNAVAILABLE: '0',
  },
};

export function resolvePhase32eMatrixRoot(env = process.env) {
  return env.PHASE32E_MATRIX_ROOT || DEFAULT_MATRIX_OUT;
}

export function kpiInjectionEnv(mode) {
  const spec = MODES[mode];
  if (!spec) throw new Error(`unknown phase32e mode: ${mode}`);
  return {
    AI_KPI_TEST_INJECT_WRITE_DELAY_MS: spec.AI_KPI_TEST_INJECT_WRITE_DELAY_MS,
    AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE: spec.AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE,
    AI_KPI_TEST_INJECT_TIMEOUT_MS: spec.AI_KPI_TEST_INJECT_TIMEOUT_MS,
    AI_KPI_TEST_INJECT_DB_UNAVAILABLE: spec.AI_KPI_TEST_INJECT_DB_UNAVAILABLE,
  };
}
