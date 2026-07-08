/**
 * Phase 26C — read-only searchability instrumentation guard (no network required).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const CLOSEOUT_DOC = 'docs/ai-platform/PHASE_26C_SEARCHABILITY_VERIFICATION_PROBE_CLOSEOUT.md';

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
];

export class Phase26cSearchabilityGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26cSearchabilityGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26cSearchabilityGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function validatePhase26cSearchability(repoRoot) {
  const closeout = readFile(repoRoot, CLOSEOUT_DOC);
  const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_searchability_checks.py');
  const observabilityPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_observability.py');
  const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');

  if (!/Phase 26C:.*PASS/i.test(closeout)) {
    throw new Phase26cSearchabilityGuardError('closeout missing Phase 26C: PASS');
  }
  if (!/Phase 26D:.*NOT STARTED/i.test(closeout)) {
    throw new Phase26cSearchabilityGuardError('closeout must state Phase 26D NOT STARTED');
  }
  if (!/Schema SQL applied to local\/dev python_ai DB:.*YES/i.test(closeout)) {
    throw new Phase26cSearchabilityGuardError('closeout must confirm local/dev schema applied');
  }
  if (!/Searchability writes default enabled:.*NO/i.test(closeout)) {
    throw new Phase26cSearchabilityGuardError('closeout must state searchability writes disabled by default');
  }
  if (!/Runtime writes enabled by default:.*NO/i.test(closeout)) {
    throw new Phase26cSearchabilityGuardError('closeout must state runtime writes disabled by default');
  }

  if (!kpiPy.includes('build_redacted_searchability_check')) {
    throw new Phase26cSearchabilityGuardError('kpi_searchability_checks.py missing payload builder');
  }
  if (!kpiPy.includes('probe_query_hash')) {
    throw new Phase26cSearchabilityGuardError('kpi_searchability_checks.py missing probe_query_hash support');
  }
  if (!kpiPy.includes('hash_source_id')) {
    throw new Phase26cSearchabilityGuardError('kpi_searchability_checks.py missing source id hash support');
  }

  for (const forbidden of FORBIDDEN_COLUMNS) {
    if (!kpiPy.includes(forbidden)) {
      throw new Phase26cSearchabilityGuardError(`kpi_searchability_checks.py must reject forbidden field: ${forbidden}`);
    }
  }

  if (!observabilityPy.includes('write_kpi_searchability_check_sync')) {
    throw new Phase26cSearchabilityGuardError('kpi_observability searchability path not wired');
  }

  if (!/Phase 26C:.*PASS/i.test(active)) {
    throw new Phase26cSearchabilityGuardError('ACTIVE_CONTEXT missing Phase 26C PASS');
  }

  if (!closeout.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26cSearchabilityGuardError('closeout missing locked artifact SHA');
  }

  return {
    status: 'PASS',
    closeout_doc: CLOSEOUT_DOC,
    forbidden_fields_guarded: FORBIDDEN_COLUMNS.length,
  };
}
