/**
 * Phase 26E — read-only usefulness observation instrumentation guard (no network required).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const CLOSEOUT_DOC = 'docs/ai-platform/PHASE_26E_USEFULNESS_OBSERVATION_EXPORT_CLOSEOUT.md';

export const FORBIDDEN_COLUMNS = [
  'response_body',
  'raw_response_body',
  'message_body',
  'raw_message_body',
  'jwt',
  'token',
  'password',
  'proxy_max_bid',
  'private_message',
  'authorization_header',
  'question',
  'prompt',
  'answer',
  'summary',
  'response',
  'cookie',
  'raw_user_email',
];

export const LIVE_PATTERNS = [
  /\bcurl\b/i,
  /\bkubectl\b/i,
  /live eval/i,
  /57105\s*\/\s*57105.*replay/i,
];

export class Phase26eUsefulnessObservationGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26eUsefulnessObservationGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26eUsefulnessObservationGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function validatePhase26eUsefulnessObservation(repoRoot) {
  const closeout = readFile(repoRoot, CLOSEOUT_DOC);
  const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_usefulness_observations.py');
  const observabilityPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_observability.py');
  const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');
  const pyTests = readFile(repoRoot, 'services/python-ai-service/tests/test_phase26e_kpi_usefulness.py');
  const nodeTests = readFile(repoRoot, 'tests/phase26e-usefulness-observation-kpi-readonly.test.mjs');

  if (!/Phase 26E:.*PASS/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout missing Phase 26E: PASS');
  }
  if (!/Phase 26F:.*NOT STARTED/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must state Phase 26F NOT STARTED');
  }
  if (!/Live eval:.*NOT RUN/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must state Live eval NOT RUN');
  }
  if (!/Runtime\/env\/default\/allowlist changes:.*NONE/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must state runtime/env/default/allowlist changes NONE');
  }
  if (!/Usefulness writes default enabled:.*NO/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must state usefulness writes disabled by default');
  }
  if (!/Runtime writes enabled by default:.*NO/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must state runtime writes disabled by default');
  }
  if (!/Raw\/private fields stored:.*NO/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must state raw/private fields not stored');
  }
  if (!/H1\/H2\/H3 usefulness labels tested:.*YES/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must confirm H1/H2/H3 usefulness labels tested');
  }
  if (!/No model accuracy claim without ground truth:.*YES/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must deny model accuracy claims without ground truth');
  }
  if (!/Bench logs committed:.*NO/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must state bench logs not committed');
  }
  if (/model accuracy/i.test(closeout) && !/not model accuracy/i.test(closeout)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout must not claim model accuracy without ground truth');
  }

  if (!kpiPy.includes('build_usefulness_observation_payload')) {
    throw new Phase26eUsefulnessObservationGuardError('kpi_usefulness_observations.py missing payload builder');
  }
  if (!kpiPy.includes('emit_usefulness_observation_safe')) {
    throw new Phase26eUsefulnessObservationGuardError('kpi_usefulness_observations.py missing safe emit helper');
  }
  if (!kpiPy.includes('KNOWN_EVIDENCE_LABELS')) {
    throw new Phase26eUsefulnessObservationGuardError('kpi_usefulness_observations.py missing evidence label validation');
  }

  for (const forbidden of FORBIDDEN_COLUMNS) {
    if (!kpiPy.includes(forbidden)) {
      throw new Phase26eUsefulnessObservationGuardError(`kpi_usefulness_observations.py must reject forbidden field: ${forbidden}`);
    }
  }

  if (!observabilityPy.includes('write_kpi_usefulness_observation_sync')) {
    throw new Phase26eUsefulnessObservationGuardError('kpi_observability usefulness path not wired');
  }

  if (!/Phase 26E:.*PASS/i.test(active)) {
    throw new Phase26eUsefulnessObservationGuardError('ACTIVE_CONTEXT missing Phase 26E PASS');
  }
  if (!/Phase 26F:.*NOT STARTED/i.test(active)) {
    throw new Phase26eUsefulnessObservationGuardError('ACTIVE_CONTEXT must state Phase 26F NOT STARTED');
  }

  for (const pattern of LIVE_PATTERNS) {
    if (pattern.test(pyTests) || pattern.test(nodeTests)) {
      throw new Phase26eUsefulnessObservationGuardError('usefulness tests/guards must not include live RAG/curl/kubectl patterns');
    }
  }

  if (!closeout.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26eUsefulnessObservationGuardError('closeout missing locked artifact SHA');
  }

  const bannedEvidence = [
    /57105\s*\/\s*57105.*smoke/i,
    /171315\s*\/\s*171315.*smoke/i,
    /unlabeled cumulative/i,
  ];
  for (const pattern of bannedEvidence) {
    if (pattern.test(closeout)) {
      throw new Phase26eUsefulnessObservationGuardError('closeout must not relabel matrix evidence as smoke');
    }
  }

  return {
    status: 'PASS',
    closeout_doc: CLOSEOUT_DOC,
    forbidden_fields_guarded: FORBIDDEN_COLUMNS.length,
  };
}
