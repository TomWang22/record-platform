/**
 * Phase 25E — read-only design doc / contract guard (no network, no DB).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const PHASE_25_DOCS = [
  'docs/ai-platform/PHASE_25A_OBSERVABILITY_INSTRUMENTATION_ARCHITECTURE_DESIGN.md',
  'docs/ai-platform/PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md',
  'docs/ai-platform/PHASE_25C_KPI_EXTRACTOR_AND_DASHBOARD_CONTRACT_DESIGN.md',
  'docs/ai-platform/PHASE_25D_OBSERVABILITY_IMPLEMENTATION_ROLLOUT_PLAN.md',
  'docs/ai-platform/PHASE_25E_OBSERVABILITY_GUARDRAILS_AND_TEST_DESIGN.md',
  'docs/ai-platform/PHASE_25F_OBSERVABILITY_INSTRUMENTATION_DESIGN_CLOSEOUT.md',
];

export const REQUIRED_TABLES = [
  'ai.ai_kpi_ingestion_events',
  'ai.ai_kpi_searchability_checks',
  'ai.ai_kpi_query_observations',
  'ai.ai_kpi_usefulness_observations',
];

export const REQUIRED_JSON_OUTPUTS = [
  'phase25_ingestion_kpis.json',
  'phase25_searchability_kpis.json',
  'phase25_query_latency_kpis.json',
  'phase25_usefulness_kpis.json',
  'phase25_operational_health_kpis.json',
  'phase25_combined_ai_platform_kpi_report.json',
];

export const REQUIRED_PHASE_26_PHASES = [
  'Phase 26A',
  'Phase 26B',
  'Phase 26C',
  'Phase 26D',
  'Phase 26E',
  'Phase 26F',
  'Phase 26G',
];

export const EVIDENCE_LABELS = [
  'H1 baseline: 57105/57105',
  'H2 replay: 57105/57105',
  'H3 replay: 57105/57105',
  '171315',
  'Phase 22C: 7200/7200 sample only',
  'Phase 22B: 15/15 smoke only',
];

export const PRIVACY_RULES = [
  'No raw response bodies',
  'No JWTs',
  'No passwords',
  'No raw message bodies',
  'No proxy max bids',
];

export const REQUIRED_SCHEMA_FIELDS = [
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

export class Phase25DesignGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase25DesignGuardError';
  }
}

export function readDoc(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase25DesignGuardError(`missing required doc: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function assertDocsExist(repoRoot) {
  for (const doc of PHASE_25_DOCS) {
    readDoc(repoRoot, doc);
  }
  return PHASE_25_DOCS;
}

export function assertDocContains(repoRoot, docPath, needles, label) {
  const text = readDoc(repoRoot, docPath);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) {
    throw new Phase25DesignGuardError(`${label}: ${docPath} missing ${missing.join(', ')}`);
  }
}

export function validatePhase25Design(repoRoot) {
  assertDocsExist(repoRoot);

  const allText = PHASE_25_DOCS.map((doc) => readDoc(repoRoot, doc)).join('\n');

  for (const table of REQUIRED_TABLES) {
    if (!allText.includes(table)) {
      throw new Phase25DesignGuardError(`missing proposed table reference: ${table}`);
    }
  }

  for (const output of REQUIRED_JSON_OUTPUTS) {
    if (!allText.includes(output)) {
      throw new Phase25DesignGuardError(`missing JSON contract output: ${output}`);
    }
  }

  const rollout = readDoc(repoRoot, 'docs/ai-platform/PHASE_25D_OBSERVABILITY_IMPLEMENTATION_ROLLOUT_PLAN.md');
  for (const phase of REQUIRED_PHASE_26_PHASES) {
    if (!rollout.includes(phase)) {
      throw new Phase25DesignGuardError(`rollout plan missing ${phase}`);
    }
  }

  const closeout = readDoc(repoRoot, 'docs/ai-platform/PHASE_25F_OBSERVABILITY_INSTRUMENTATION_DESIGN_CLOSEOUT.md');
  if (!/Phase 25:.*CLOSED PASS/i.test(closeout)) {
    throw new Phase25DesignGuardError('closeout missing Phase 25: CLOSED PASS');
  }
  if (closeout.includes('DB schema changes applied: YES') || closeout.includes('Migrations applied: YES')) {
    throw new Phase25DesignGuardError('closeout must not claim schema/migrations applied');
  }

  const schema = readDoc(repoRoot, 'docs/ai-platform/PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md');
  for (const field of REQUIRED_SCHEMA_FIELDS) {
    if (!schema.includes(field)) {
      throw new Phase25DesignGuardError(`schema proposal missing field: ${field}`);
    }
  }

  for (const rule of PRIVACY_RULES) {
    if (!allText.includes(rule)) {
      throw new Phase25DesignGuardError(`privacy rule not documented: ${rule}`);
    }
  }

  const active = readDoc(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');
  if (active.includes('Current handoff HEAD:')) {
    throw new Phase25DesignGuardError('ACTIVE_CONTEXT contains banned Current handoff HEAD label');
  }
  if (!/Phase 25:.*CLOSED PASS/i.test(active)) {
    throw new Phase25DesignGuardError('ACTIVE_CONTEXT missing Phase 25 CLOSED PASS');
  }

  if (/\b171315 cumulative\b/i.test(allText) || /\b171315 unlabeled\b/i.test(allText)) {
    throw new Phase25DesignGuardError('docs contain banned unlabeled 171315 wording');
  }

  const guardScript = path.join(repoRoot, 'scripts/phase25-observability-design-guard-readonly.mjs');
  const guardSource = fs.readFileSync(guardScript, 'utf8');
  const forbidden = [/\bcurlRequest\b/, /\bragQuery\b/, /\bkubectl\b/, /spawnSync\(\s*['"]curl['"]/];
  for (const pattern of forbidden) {
    if (pattern.test(guardSource)) {
      throw new Phase25DesignGuardError(`guard script contains forbidden live-operation pattern: ${pattern}`);
    }
  }

  return {
    status: 'PASS',
    docs_checked: PHASE_25_DOCS.length,
    tables: REQUIRED_TABLES.length,
    json_outputs: REQUIRED_JSON_OUTPUTS.length,
    phase_26_phases: REQUIRED_PHASE_26_PHASES.length,
  };
}
