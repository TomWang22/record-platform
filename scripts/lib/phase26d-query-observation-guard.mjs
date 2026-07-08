/**
 * Phase 26D — read-only query observation instrumentation guard (no network required).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const CLOSEOUT_DOC = 'docs/ai-platform/PHASE_26D_QUERY_OBSERVATION_INSTRUMENTATION_CLOSEOUT.md';

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
  'cookie',
  'raw_user_email',
];

export class Phase26dQueryObservationGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26dQueryObservationGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26dQueryObservationGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function validatePhase26dQueryObservation(repoRoot) {
  const closeout = readFile(repoRoot, CLOSEOUT_DOC);
  const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_query_observations.py');
  const observabilityPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_observability.py');
  const routesPy = readFile(repoRoot, 'services/python-ai-service/app/ai/routes.py');
  const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');

  if (!/Phase 26D:.*PASS/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout missing Phase 26D: PASS');
  }
  if (!/Phase 26E:.*NOT STARTED/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must state Phase 26E NOT STARTED');
  }
  if (!/Live eval:.*NOT RUN/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must state Live eval NOT RUN');
  }
  if (!/Runtime\/env\/default\/allowlist changes:.*NONE/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must state runtime/env/default/allowlist changes NONE');
  }
  if (!/Query observation writes default enabled:.*NO/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must state query observation writes disabled by default');
  }
  if (!/Runtime writes enabled by default:.*NO/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must state runtime writes disabled by default');
  }
  if (!/Raw\/private fields stored:.*NO/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must state raw/private fields not stored');
  }
  if (!/H1\/H2\/H3 protocol capture tested:.*YES/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must confirm H1/H2/H3 protocol capture tested');
  }
  if (!/Bench logs committed:.*NO/i.test(closeout)) {
    throw new Phase26dQueryObservationGuardError('closeout must state bench logs not committed');
  }

  if (!kpiPy.includes('build_redacted_query_observation')) {
    throw new Phase26dQueryObservationGuardError('kpi_query_observations.py missing payload builder');
  }
  if (!kpiPy.includes('normalize_http_protocol')) {
    throw new Phase26dQueryObservationGuardError('kpi_query_observations.py missing protocol normalization');
  }
  if (!kpiPy.includes('emit_rag_query_observation_safe')) {
    throw new Phase26dQueryObservationGuardError('kpi_query_observations.py missing safe RAG emit helper');
  }

  for (const forbidden of FORBIDDEN_COLUMNS) {
    if (!kpiPy.includes(forbidden)) {
      throw new Phase26dQueryObservationGuardError(`kpi_query_observations.py must reject forbidden field: ${forbidden}`);
    }
  }

  if (!observabilityPy.includes('write_kpi_query_observation_sync')) {
    throw new Phase26dQueryObservationGuardError('kpi_observability query path not wired');
  }
  if (!routesPy.includes('emit_rag_query_observation_safe')) {
    throw new Phase26dQueryObservationGuardError('RAG query route must emit default-off observations');
  }

  if (!/Phase 26D:.*PASS/i.test(active)) {
    throw new Phase26dQueryObservationGuardError('ACTIVE_CONTEXT missing Phase 26D PASS');
  }

  if (!closeout.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26dQueryObservationGuardError('closeout missing locked artifact SHA');
  }

  const bannedEvidence = [
    /57105\s*\/\s*57105.*smoke/i,
    /171315\s*\/\s*171315.*smoke/i,
    /unlabeled cumulative/i,
  ];
  for (const pattern of bannedEvidence) {
    if (pattern.test(closeout)) {
      throw new Phase26dQueryObservationGuardError('closeout must not relabel matrix evidence as smoke');
    }
  }

  return {
    status: 'PASS',
    closeout_doc: CLOSEOUT_DOC,
    forbidden_fields_guarded: FORBIDDEN_COLUMNS.length,
  };
}
