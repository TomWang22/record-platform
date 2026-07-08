/**
 * Phase 26B — read-only ingestion instrumentation guard (no network, no DB apply).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const CLOSEOUT_DOC = 'docs/ai-platform/PHASE_26B_INGESTION_INSTRUMENTATION_CLOSEOUT.md';

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

export class Phase26bIngestionGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26bIngestionGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26bIngestionGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function validatePhase26bIngestion(repoRoot) {
  const closeout = readFile(repoRoot, CLOSEOUT_DOC);
  const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_ingestion_events.py');
  const observabilityPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_observability.py');
  const configPy = readFile(repoRoot, 'services/python-ai-service/app/ai/config.py');
  const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');

  if (!/Phase 26B:.*PASS/i.test(closeout)) {
    throw new Phase26bIngestionGuardError('closeout missing Phase 26B: PASS');
  }
  if (!/Phase 26C:.*NOT STARTED/i.test(closeout)) {
    throw new Phase26bIngestionGuardError('closeout must state Phase 26C NOT STARTED');
  }
  if (/Migrations applied to live DB:\s*YES/i.test(closeout)) {
    throw new Phase26bIngestionGuardError('closeout must not claim live DB migrations applied');
  }
  if (!/Runtime writes enabled by default:.*NO/i.test(closeout)) {
    throw new Phase26bIngestionGuardError('closeout must state runtime writes disabled by default');
  }
  if (!/Raw\/private fields stored:.*NO/i.test(closeout)) {
    throw new Phase26bIngestionGuardError('closeout must state no raw/private fields stored');
  }

  if (!kpiPy.includes('build_redacted_ingestion_event')) {
    throw new Phase26bIngestionGuardError('kpi_ingestion_events.py missing payload builder');
  }
  if (!kpiPy.includes('FORBIDDEN_PAYLOAD_KEYS')) {
    throw new Phase26bIngestionGuardError('kpi_ingestion_events.py missing forbidden key guard');
  }
  if (!kpiPy.includes('hash_source_id')) {
    throw new Phase26bIngestionGuardError('kpi_ingestion_events.py missing source id hashing');
  }

  for (const forbidden of FORBIDDEN_COLUMNS) {
    if (!kpiPy.includes(forbidden)) {
      throw new Phase26bIngestionGuardError(`kpi_ingestion_events.py must document/reject forbidden field: ${forbidden}`);
    }
  }

  if (!observabilityPy.includes('write_kpi_ingestion_event_sync')) {
    throw new Phase26bIngestionGuardError('kpi_observability ingestion path not wired');
  }

  if (!configPy.includes('AI_KPI_OBSERVABILITY_MASTER_DISABLE", "1"')) {
    throw new Phase26bIngestionGuardError('master disable must default to 1');
  }

  if (!/Phase 26B:.*PASS/i.test(active)) {
    throw new Phase26bIngestionGuardError('ACTIVE_CONTEXT missing Phase 26B PASS');
  }

  if (!closeout.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26bIngestionGuardError('closeout missing locked artifact SHA');
  }

  return {
    status: 'PASS',
    closeout_doc: CLOSEOUT_DOC,
    forbidden_fields_guarded: FORBIDDEN_COLUMNS.length,
  };
}
