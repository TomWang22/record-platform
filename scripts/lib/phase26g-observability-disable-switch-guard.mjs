/**
 * Phase 26G — observability disable-switch drill and implementation closeout guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const CLOSEOUT_DOC = 'docs/ai-platform/PHASE_26G_OBSERVABILITY_DISABLE_SWITCH_AND_CLOSEOUT.md';

export const KPI_CHANNELS = ['ingestion', 'searchability', 'query', 'usefulness'];

export const KPI_FLAG_DEFAULTS = [
  { name: 'AI_KPI_OBSERVABILITY_ENABLED', default: '0' },
  { name: 'AI_KPI_INGESTION_EVENTS_ENABLED', default: '0' },
  { name: 'AI_KPI_SEARCHABILITY_CHECKS_ENABLED', default: '0' },
  { name: 'AI_KPI_QUERY_OBSERVATIONS_ENABLED', default: '0' },
  { name: 'AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED', default: '0' },
  { name: 'AI_KPI_OBSERVABILITY_MASTER_DISABLE', default: '1' },
];

export const NOOP_WRITE_FUNCTIONS = [
  'noop_write_kpi_ingestion_event',
  'noop_write_kpi_searchability_check',
  'noop_write_kpi_query_observation',
  'noop_write_kpi_usefulness_observation',
];

export const BANNED_SCRIPT_PATTERNS = [
  { pattern: /\bcurl\b/i, label: 'curl' },
  { pattern: /\bkubectl\b/i, label: 'kubectl' },
  { pattern: /\/api\/ai\/rag\/query/i, label: '/api/ai/rag/query' },
  { pattern: /\bINSERT\s+INTO\b/i, label: 'INSERT INTO' },
  { pattern: /\bauth\/login\b/i, label: 'auth/login' },
  { pattern: /57105\s*replay/i, label: '57105 replay' },
  { pattern: /live eval/i, label: 'live eval' },
];

export class Phase26gObservabilityDisableSwitchGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26gObservabilityDisableSwitchGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26gObservabilityDisableSwitchGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function assertNoBannedPatternsInPhase26gScripts(repoRoot) {
  const files = [
    'scripts/phase26g-observability-disable-switch-guard-readonly.mjs',
    'tests/phase26g-observability-disable-switch-guard.test.mjs',
  ];
  for (const relativePath of files) {
    const content = readFile(repoRoot, relativePath);
    for (const { pattern, label } of BANNED_SCRIPT_PATTERNS) {
      if (pattern.test(content)) {
        throw new Phase26gObservabilityDisableSwitchGuardError(
          `Phase 26G script ${relativePath} must not include banned pattern: ${label}`,
        );
      }
    }
  }
}

export function runDisableSwitchPythonDrill(repoRoot) {
  const result = spawnSync(
    'python',
    [
      '-m',
      'unittest',
      'tests.test_phase26a_kpi_observability',
      'tests.test_phase26b_kpi_ingestion.Phase26bKpiIngestionTests.test_default_flags_return_none_without_db_call',
      'tests.test_phase26c_kpi_searchability.Phase26cKpiSearchabilityTests.test_default_flags_return_none_without_db_call',
      'tests.test_phase26d_kpi_query_observations.Phase26dKpiQueryObservationTests.test_default_flags_block_query_writes',
      'tests.test_phase26e_kpi_usefulness.Phase26eKpiUsefulnessTests.test_default_off_safe_emitter_does_not_insert',
    ],
    {
      cwd: path.join(repoRoot, 'services/python-ai-service'),
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'python disable-switch drill failed').trim();
    throw new Phase26gObservabilityDisableSwitchGuardError(`disable-switch python drill failed: ${detail}`);
  }
  return { status: 'PASS', tests_run: 5 };
}

export function validatePhase26gObservabilityDisableSwitch(repoRoot, { runPythonDrill = true } = {}) {
  const closeout = readFile(repoRoot, CLOSEOUT_DOC);
  const configPy = readFile(repoRoot, 'services/python-ai-service/app/ai/config.py');
  const observabilityPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_observability.py');
  const reportLib = readFile(repoRoot, 'scripts/lib/phase26f-combined-kpi-report-readonly.mjs');
  const reportCli = readFile(repoRoot, 'scripts/phase26f-combined-kpi-report-readonly.mjs');
  const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');

  if (!/Phase 26:\s*CLOSED PASS/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state Phase 26: CLOSED PASS');
  }
  if (!/Phase 26G:.*PASS/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout missing Phase 26G: PASS');
  }
  if (!/Live eval:.*NOT RUN/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state Live eval NOT RUN');
  }
  if (!/Runtime\/env\/default\/allowlist changes:.*NONE/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state runtime/env/default/allowlist changes NONE');
  }
  if (!/DB writes during 26G:.*NO/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state DB writes during 26G NO');
  }
  if (!/Migrations applied during 26G:.*NO/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state migrations applied during 26G NO');
  }
  if (!/KPI write paths default enabled:.*NO/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state KPI write paths default disabled');
  }
  if (!/Runtime writes enabled by default:.*NO/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state runtime writes disabled by default');
  }
  if (!/Disable switch verified:.*PASS/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state disable switch verified PASS');
  }
  if (!/Report output committed:.*NO/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state report output not committed');
  }
  if (!/Raw\/private fields in reports:.*NO/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state raw/private fields absent from reports');
  }
  if (!/Bench logs committed:.*NO/i.test(closeout)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout must state bench logs not committed');
  }

  for (const flag of KPI_FLAG_DEFAULTS) {
    const expected = `${flag.name}", "${flag.default}"`;
    if (!configPy.includes(expected)) {
      throw new Phase26gObservabilityDisableSwitchGuardError(`config.py missing default-off flag: ${flag.name}=${flag.default}`);
    }
  }

  if (!observabilityPy.includes('def kpi_writes_allowed')) {
    throw new Phase26gObservabilityDisableSwitchGuardError('kpi_observability missing kpi_writes_allowed');
  }
  if (!observabilityPy.includes('AI_KPI_OBSERVABILITY_MASTER_DISABLE')) {
    throw new Phase26gObservabilityDisableSwitchGuardError('kpi_observability must honor master disable');
  }
  if (!observabilityPy.includes('AI_KPI_OBSERVABILITY_ENABLED')) {
    throw new Phase26gObservabilityDisableSwitchGuardError('kpi_observability must honor global observability flag');
  }
  for (const channel of KPI_CHANNELS) {
    if (!observabilityPy.includes(`"${channel}"`)) {
      throw new Phase26gObservabilityDisableSwitchGuardError(`kpi_observability missing channel: ${channel}`);
    }
  }
  for (const fn of NOOP_WRITE_FUNCTIONS) {
    if (!observabilityPy.includes(fn)) {
      throw new Phase26gObservabilityDisableSwitchGuardError(`kpi_observability missing ${fn}`);
    }
    const fnBlock = observabilityPy.slice(observabilityPy.indexOf(`def ${fn}`));
    const nextDef = fnBlock.indexOf('\ndef ', 4);
    const body = nextDef >= 0 ? fnBlock.slice(0, nextDef) : fnBlock;
    if (!body.includes('kpi_writes_allowed') || !body.includes('return None')) {
      throw new Phase26gObservabilityDisableSwitchGuardError(`${fn} must gate on kpi_writes_allowed and return None when disabled`);
    }
  }

  if (!reportLib.includes('assertWritableOutputDir')) {
    throw new Phase26gObservabilityDisableSwitchGuardError('combined report must restrict output to temp paths');
  }
  if (!reportLib.includes('assertArtifactRedacted')) {
    throw new Phase26gObservabilityDisableSwitchGuardError('combined report must enforce redaction');
  }
  if (/INSERT INTO ai\.ai_kpi_/i.test(reportCli)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('combined report CLI must remain SELECT-only for KPI tables');
  }

  if (!/Phase 26:\s*CLOSED PASS/i.test(active)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('ACTIVE_CONTEXT must state Phase 26 CLOSED PASS');
  }
  if (!/Phase 26G:.*PASS/i.test(active)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('ACTIVE_CONTEXT missing Phase 26G PASS');
  }

  if (!closeout.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26gObservabilityDisableSwitchGuardError('closeout missing locked artifact SHA');
  }

  assertNoBannedPatternsInPhase26gScripts(repoRoot);

  let pythonDrill = { status: 'SKIPPED' };
  if (runPythonDrill) {
    pythonDrill = runDisableSwitchPythonDrill(repoRoot);
  }

  return {
    status: 'PASS',
    closeout_doc: CLOSEOUT_DOC,
    channels_checked: KPI_CHANNELS.length,
    disable_switch_python_drill: pythonDrill,
  };
}
