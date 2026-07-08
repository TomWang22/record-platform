/**
 * Phase 26A — read-only schema / no-op guard validator (no network, no DB apply).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const MIGRATION_SQL = 'infra/db/48-ai-kpi-observability.sql';

export const KPI_TABLES = [
  'ai.ai_kpi_ingestion_events',
  'ai.ai_kpi_searchability_checks',
  'ai.ai_kpi_query_observations',
  'ai.ai_kpi_usefulness_observations',
];

export const REQUIRED_FIELDS = [
  'source_type',
  'source_id_hash',
  'ingestion_run_id',
  'data_arrived_at',
  'normalized_at',
  'embedding_started_at',
  'embedding_completed_at',
  'index_upserted_at',
  'searchable_verified_at',
  'arrival_to_searchable_ms',
  'records_received',
  'records_indexed',
  'protocol',
  'gate_reason',
  'rag_total_ms',
  'response_pass',
  'fallback_count',
];

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

export const KPI_FLAG_DEFAULTS = [
  { name: 'AI_KPI_OBSERVABILITY_ENABLED', default: '0' },
  { name: 'AI_KPI_INGESTION_EVENTS_ENABLED', default: '0' },
  { name: 'AI_KPI_SEARCHABILITY_CHECKS_ENABLED', default: '0' },
  { name: 'AI_KPI_QUERY_OBSERVATIONS_ENABLED', default: '0' },
  { name: 'AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED', default: '0' },
  { name: 'AI_KPI_OBSERVABILITY_MASTER_DISABLE', default: '1' },
];

export const EVIDENCE_LABELS = [
  'H1 baseline: 57105/57105',
  'H2 replay: 57105/57105',
  'H3 replay: 57105/57105',
  '171315',
  'Phase 22C: 7200/7200 sample only',
  'Phase 22B: 15/15 smoke only',
];

export class Phase26aSchemaGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26aSchemaGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26aSchemaGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function validatePhase26aSchema(repoRoot) {
  const migration = readFile(repoRoot, MIGRATION_SQL);
  const closeout = readFile(repoRoot, 'docs/ai-platform/PHASE_26A_OBSERVABILITY_SCHEMA_AND_NOOP_INSTRUMENTATION.md');
  const configPy = readFile(repoRoot, 'services/python-ai-service/app/ai/config.py');
  const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_observability.py');

  for (const table of KPI_TABLES) {
    const tableName = table.split('.')[1];
    if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
      throw new Phase26aSchemaGuardError(`migration missing table: ${table}`);
    }
    if (migration.toLowerCase().includes(tableName.toLowerCase()) === false) {
      throw new Phase26aSchemaGuardError(`migration missing reference to ${tableName}`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!migration.includes(field)) {
      throw new Phase26aSchemaGuardError(`migration missing required field: ${field}`);
    }
  }

  for (const forbidden of FORBIDDEN_COLUMNS) {
    const pattern = new RegExp(`\\b${forbidden}\\b`, 'i');
    if (pattern.test(migration)) {
      throw new Phase26aSchemaGuardError(`migration contains forbidden column: ${forbidden}`);
    }
  }

  for (const flag of KPI_FLAG_DEFAULTS) {
    const expected = `os.getenv("${flag.name}", "${flag.default}")`;
    if (!configPy.includes(expected)) {
      throw new Phase26aSchemaGuardError(`config.py missing default-off flag: ${flag.name}=${flag.default}`);
    }
  }

  if (!kpiPy.includes('def kpi_writes_allowed')) {
    throw new Phase26aSchemaGuardError('kpi_observability.py missing kpi_writes_allowed guard');
  }
  for (const fn of [
    'noop_write_kpi_ingestion_event',
    'noop_write_kpi_searchability_check',
    'noop_write_kpi_query_observation',
    'noop_write_kpi_usefulness_observation',
  ]) {
    if (!kpiPy.includes(fn)) {
      throw new Phase26aSchemaGuardError(`kpi_observability.py missing ${fn}`);
    }
  }

  if (!/Phase 26A:.*PASS/i.test(closeout)) {
    throw new Phase26aSchemaGuardError('closeout missing Phase 26A: PASS');
  }
  if (/Migrations applied to live DB:\s*YES/i.test(closeout)) {
    throw new Phase26aSchemaGuardError('closeout must not claim live DB migrations applied');
  }
  if (!/Runtime writes enabled:.*NO/i.test(closeout)) {
    throw new Phase26aSchemaGuardError('closeout must state runtime writes disabled');
  }
  if (!/Phase 26B:.*NOT STARTED/i.test(closeout)) {
    throw new Phase26aSchemaGuardError('closeout must state Phase 26B NOT STARTED');
  }

  const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');
  if (!/Phase 26A:.*PASS/i.test(active)) {
    throw new Phase26aSchemaGuardError('ACTIVE_CONTEXT missing Phase 26A PASS');
  }
  if (active.includes('Current handoff HEAD:')) {
    throw new Phase26aSchemaGuardError('ACTIVE_CONTEXT contains banned Current handoff HEAD label');
  }

  for (const label of EVIDENCE_LABELS) {
    if (!closeout.includes(label) && !active.includes(label.replace(': ', ' ')) && !active.includes(label)) {
      throw new Phase26aSchemaGuardError(`evidence label not preserved: ${label}`);
    }
  }

  if (!closeout.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26aSchemaGuardError('closeout missing locked artifact SHA');
  }

  return {
    status: 'PASS',
    migration_sql: MIGRATION_SQL,
    tables: KPI_TABLES.length,
    required_fields: REQUIRED_FIELDS.length,
    forbidden_columns_absent: FORBIDDEN_COLUMNS.length,
    flags_default_off: KPI_FLAG_DEFAULTS.length,
  };
}
