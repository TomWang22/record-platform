/**
 * Phase 26F — combined read-only AI Platform KPI report generation (no writes, no live eval).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXPECTED_ARTIFACT_SHA,
  LOCKED_PRODUCTION_POSTURE,
  extractUsefulnessFromDocs,
  extractLatencyFromDocs,
  buildOperationalHealth,
  assertReportIsRedacted,
} from './phase24b-ai-kpi-readonly.mjs';
import { summarizeIngestionKpiHonest } from './phase26b-ingestion-kpi-readonly.mjs';
import { summarizeSearchabilityKpiHonest } from './phase26c-searchability-kpi-readonly.mjs';
import { summarizeQueryLatencyKpiHonest } from './phase26d-query-observation-kpi-readonly.mjs';
import { summarizeUsefulnessKpiHonest } from './phase26e-usefulness-observation-kpi-readonly.mjs';

export { EXPECTED_ARTIFACT_SHA };

export const REPORT_SOURCE = 'phase26f-readonly-report';
export const REPORT_ENVIRONMENT = 'readonly';

export const EVIDENCE_LABELS = {
  h1_baseline: '57105/57105 HTTP/1.1',
  h2_replay: '57105/57105 HTTP/2 PASS',
  h3_replay: '57105/57105 HTTP/3 PASS',
  labeled_sum_only: '171315/171315',
  phase_22c: '7200/7200 sample only',
  phase_22b: '15/15 smoke only',
};

const PROTOCOL_EVIDENCE_LABELS = {
  'HTTP/1.1': 'H1 baseline 57105/57105',
  'HTTP/2': 'H2 replay 57105/57105',
  'HTTP/3': 'H3 replay 57105/57105',
};

const FORBIDDEN_FIELD_NAMES = [
  'response_body',
  'raw_response_body',
  'answer',
  'summary',
  'question',
  'prompt',
  'message_body',
  'raw_message_body',
  'jwt',
  'token',
  'password',
  'authorization',
  'authorization_header',
  'cookie',
  'proxy_max_bid',
  'private_message',
];

const FORBIDDEN_OUTPUT_PATTERNS = [
  /\beyJ[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/,
  /\bpg_dump\b/i,
  /\bINSERT INTO\b/i,
  /\bUPDATE\s+ai\./i,
  /\bDELETE FROM\b/i,
];

export class Phase26fReportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26fReportError';
  }
}

export function buildReportEnvelope({
  gitSha,
  status,
  metrics,
  gaps = [],
  source = REPORT_SOURCE,
  environment = REPORT_ENVIRONMENT,
}) {
  return {
    generated_at: new Date().toISOString(),
    git_sha: gitSha,
    artifact_sha: EXPECTED_ARTIFACT_SHA,
    environment,
    source,
    status,
    metrics,
    gaps,
    redaction_status: 'PASS',
  };
}

export function containsForbiddenReportContent(text) {
  if (FORBIDDEN_OUTPUT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  try {
    const parsed = JSON.parse(text);
    return containsForbiddenFields(parsed);
  } catch {
    return false;
  }
}

export function containsForbiddenFields(value, pathPrefix = '') {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item, index) => containsForbiddenFields(item, `${pathPrefix}[${index}]`));
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.includes(key)) {
      return true;
    }
    if (typeof child === 'object' && child !== null && containsForbiddenFields(child, `${pathPrefix}.${key}`)) {
      return true;
    }
  }
  return false;
}

export function assertArtifactRedacted(artifact) {
  const serialized = JSON.stringify(artifact);
  if (containsForbiddenReportContent(serialized)) {
    throw new Phase26fReportError('artifact contains forbidden raw/private content');
  }
  assertReportIsRedacted(artifact);
  return true;
}

export function assertWritableOutputDir(outDir) {
  const resolved = path.resolve(outDir);
  const tmpRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tmpRoot) && !resolved.startsWith('/tmp')) {
    throw new Phase26fReportError(`report output must be under /tmp or ${tmpRoot}`);
  }
}

export function buildEvidenceLabelsSection() {
  return {
    h1_baseline: `H1 baseline: ${EVIDENCE_LABELS.h1_baseline}`,
    h2_replay: `H2 replay: ${EVIDENCE_LABELS.h2_replay}`,
    h3_replay: `H3 replay: ${EVIDENCE_LABELS.h3_replay}`,
    combined_labeled_full_protocol_evidence: `Combined labeled full-protocol evidence: ${EVIDENCE_LABELS.labeled_sum_only}`,
    phase_22c: `Phase 22C: ${EVIDENCE_LABELS.phase_22c}`,
    phase_22b: `Phase 22B: ${EVIDENCE_LABELS.phase_22b}`,
    notes: [
      '171315/171315 is labeled H1+H2+H3 only',
      'Phase 22C 7200/7200 is sample only',
      'Phase 22B 15/15 is smoke only',
    ],
  };
}

function ingestionGaps(summary) {
  if (summary.status === 'PASS') return [];
  if (summary.status === 'PARTIAL') return ['ingestion KPI partially populated or run-level fallback only'];
  return ['no ai_kpi_ingestion_events rows and no run-level ingestion fallback'];
}

function searchabilityGaps(summary) {
  if (summary.status === 'PASS') return [];
  if (summary.status === 'PARTIAL') return ['searchability checks partially populated'];
  return ['no ai_kpi_searchability_checks rows'];
}

function queryLatencyGaps(summary) {
  const gaps = [];
  if (summary.status !== 'PASS') {
    gaps.push('query observation rows absent or partial');
  }
  if (summary.h1_full_matrix_committed_docs?.status === 'GAP') {
    gaps.push('H1 full-matrix p50/p95/max not in committed docs');
  }
  return gaps;
}

function usefulnessGaps(summary) {
  if (summary.status === 'PASS') return [];
  if (summary.status === 'PARTIAL') return ['usefulness observations partially populated by protocol/label'];
  return ['no ai_kpi_usefulness_observations rows'];
}

export function buildIngestionKpiReport({ gitSha, eventRows = [], runLevelFallback = null }) {
  const summary = summarizeIngestionKpiHonest(eventRows, runLevelFallback);
  const bySourceType = summary.by_source_type || {};
  const metrics = {
    by_source_type: bySourceType,
    run_level: {
      completed_runs: summary.run_counts?.completed ?? 0,
      failed_runs: summary.run_counts?.failed ?? 0,
      running_runs: summary.run_counts?.running ?? 0,
    },
    kpi_events_available: summary.kpi_events_available ?? false,
    source: summary.source,
  };
  return buildReportEnvelope({
    gitSha,
    status: summary.status,
    metrics,
    gaps: ingestionGaps(summary),
    source: summary.source || 'ai_kpi_ingestion_events',
  });
}

export function buildSearchabilityKpiReport({ gitSha, checkRows = [], runLevelFallback = null }) {
  const summary = summarizeSearchabilityKpiHonest(checkRows, runLevelFallback);
  const metrics = {
    arrival_to_searchable_ms: summary.arrival_to_searchable_ms || {
      p50: null,
      p95: null,
      max: null,
      sample_count: 0,
    },
    kpi_searchability_checks_available: summary.kpi_searchability_checks_available ?? false,
    source: summary.source,
  };
  return buildReportEnvelope({
    gitSha,
    status: summary.status,
    metrics,
    gaps: searchabilityGaps(summary),
    source: summary.source || 'ai_kpi_searchability_checks',
  });
}

export function buildQueryLatencyKpiReport({ gitSha, observationRows = [], repoRoot = null }) {
  const summary = summarizeQueryLatencyKpiHonest(observationRows);
  const byProtocol = {};
  for (const protocol of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const bucket = summary.by_protocol?.[protocol] || {
      p50_ms: null,
      p95_ms: null,
      max_ms: null,
      sample_count: 0,
    };
    byProtocol[protocol] = {
      ...bucket,
      evidence_label: PROTOCOL_EVIDENCE_LABELS[protocol],
      note:
        protocol === 'HTTP/1.1' && summary.h1_full_matrix_committed_docs?.status === 'GAP'
          ? 'GAP in committed docs; observation rows do not backfill H1 matrix evidence'
          : undefined,
    };
  }
  const metrics = {
    by_protocol: byProtocol,
    by_gate_reason: summary.by_gate_reason || {},
    by_workflow: summary.by_workflow || {},
    fallback_count: summary.fallback_count ?? 0,
    canary_error_count: summary.canary_error_count ?? 0,
    committed_doc_latency: repoRoot ? extractLatencyFromDocs(repoRoot).retrieval_latency : null,
    kpi_query_observations_available: summary.kpi_query_observations_available ?? false,
  };
  return buildReportEnvelope({
    gitSha,
    status: summary.status,
    metrics,
    gaps: queryLatencyGaps(summary),
    source: summary.source || 'ai_kpi_query_observations',
  });
}

export function buildUsefulnessKpiReport({ gitSha, observationRows = [] }) {
  const summary = summarizeUsefulnessKpiHonest(observationRows);
  const byProtocol = {};
  for (const protocol of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const bucket = summary.by_protocol?.[protocol] || { response_pass_rate: null, sample_count: 0 };
    byProtocol[protocol] = {
      ...bucket,
      evidence_label: PROTOCOL_EVIDENCE_LABELS[protocol],
    };
  }
  const metrics = {
    time_series: summary.time_series || [],
    by_protocol: byProtocol,
    by_evidence_label: summary.by_evidence_label || {},
    by_workflow: summary.by_workflow || {},
    rubric: {
      response_pass_rate: summary.response_pass_rate,
      sentiment_pass_rate: summary.sentiment_pass_rate,
      red_team_safety_pass_rate: summary.red_team_safety_pass_rate,
      leakage_failures: summary.leakage_failures ?? 0,
      quality_score_avg: summary.quality_score_avg,
      quality_score_worst: summary.quality_score_worst,
    },
    kpi_usefulness_observations_available: summary.kpi_usefulness_observations_available ?? false,
    notes: summary.notes || [],
  };
  return buildReportEnvelope({
    gitSha,
    status: summary.status,
    metrics,
    gaps: usefulnessGaps(summary),
    source: summary.source || 'ai_kpi_usefulness_observations',
  });
}

export function buildOperationalHealthKpiReport({ gitSha, operationalInput = {} }) {
  const operational = buildOperationalHealth(operationalInput);
  const metrics = {
    uptime_ratio: null,
    http_4xx_rate: null,
    http_5xx_rate: null,
    timeout_rate: null,
    fallback_rate: null,
    canary_error_rate: null,
    telemetry_warn_count: null,
    archive_verifiers_pass: operational.archive_verifiers_pass,
    phase_23_guardrails_pass: operational.phase_23_guardrails_pass,
    evidence_label_guard_pass: operational.evidence_label_guard_pass,
    dry_run_resume_validation_pass: operational.dry_run_resume_validation_pass,
    production_posture: {
      default_retrieval: LOCKED_PRODUCTION_POSTURE.production_default,
      preview_ui_api: LOCKED_PRODUCTION_POSTURE.preview_ui_api,
      PERCENT: LOCKED_PRODUCTION_POSTURE.percent,
      ALLOW_PROD_PERCENT: LOCKED_PRODUCTION_POSTURE.allow_prod_percent,
      hybrid_vector_production_default: LOCKED_PRODUCTION_POSTURE.hybrid_vector_production_default,
    },
    telemetry_warns: operational.telemetry_warns,
  };
  const gaps =
    operational.status === 'PASS'
      ? ['unified uptime/error budget requires Prometheus wiring in later phases']
      : ['archive or guardrail verifiers not fully available in readonly extraction'];
  return buildReportEnvelope({
    gitSha,
    status: operational.status === 'PASS' ? 'PARTIAL' : 'GAP',
    metrics,
    gaps,
    source: 'phase26f-operational-health-readonly',
  });
}

export function buildCombinedAiPlatformKpiReport({
  gitSha,
  repoRoot,
  kpiRows = {},
  runLevelFallback = null,
  operationalInput = {},
}) {
  const ingestion = buildIngestionKpiReport({
    gitSha,
    eventRows: kpiRows.ingestionEvents || [],
    runLevelFallback,
  });
  const searchability = buildSearchabilityKpiReport({
    gitSha,
    checkRows: kpiRows.searchabilityChecks || [],
    runLevelFallback,
  });
  const queryLatency = buildQueryLatencyKpiReport({
    gitSha,
    observationRows: kpiRows.queryObservations || [],
    repoRoot,
  });
  const usefulness = buildUsefulnessKpiReport({
    gitSha,
    observationRows: kpiRows.usefulnessObservations || [],
  });
  const operationalHealth = buildOperationalHealthKpiReport({ gitSha, operationalInput });

  const recommendationUsefulness = repoRoot
    ? extractUsefulnessFromDocs(repoRoot).recommendation_usefulness
    : null;

  const childStatuses = {
    ingestion: ingestion.status,
    searchability: searchability.status,
    query_latency: queryLatency.status,
    usefulness: usefulness.status,
    operational_health: operationalHealth.status,
  };

  const gapInventory = [
    ...ingestion.gaps,
    ...searchability.gaps,
    ...queryLatency.gaps,
    ...usefulness.gaps,
    ...operationalHealth.gaps,
  ];

  const metrics = {
    evidence_labels: buildEvidenceLabelsSection(),
    recommendation_usefulness: recommendationUsefulness,
    query_latency: queryLatency.metrics,
    ingestion: ingestion.metrics,
    searchability: searchability.metrics,
    usefulness: usefulness.metrics,
    operational_health: operationalHealth.metrics,
    production_posture: operationalHealth.metrics.production_posture,
    child_kpi_statuses: childStatuses,
    gap_inventory: gapInventory,
    usefulness_wording: 'Usefulness/rubric pass rate only — not model accuracy without ground truth',
    child_artifacts: {
      phase25_ingestion_kpis: ingestion,
      phase25_searchability_kpis: searchability,
      phase25_query_latency_kpis: queryLatency,
      phase25_usefulness_kpis: usefulness,
      phase25_operational_health_kpis: operationalHealth,
    },
  };

  const combined = buildReportEnvelope({
    gitSha,
    status: 'PASS',
    metrics,
    gaps: gapInventory,
  });

  assertArtifactRedacted(combined);
  assertArtifactRedacted(ingestion);
  assertArtifactRedacted(searchability);
  assertArtifactRedacted(queryLatency);
  assertArtifactRedacted(usefulness);
  assertArtifactRedacted(operationalHealth);

  return {
    phase25_ingestion_kpis: ingestion,
    phase25_searchability_kpis: searchability,
    phase25_query_latency_kpis: queryLatency,
    phase25_usefulness_kpis: usefulness,
    phase25_operational_health_kpis: operationalHealth,
    phase25_combined_ai_platform_kpi_report: combined,
    child_kpi_statuses: childStatuses,
  };
}

export function writePhase26fReports(outDir, reports) {
  assertWritableOutputDir(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    'phase25_ingestion_kpis.json': reports.phase25_ingestion_kpis,
    'phase25_searchability_kpis.json': reports.phase25_searchability_kpis,
    'phase25_query_latency_kpis.json': reports.phase25_query_latency_kpis,
    'phase25_usefulness_kpis.json': reports.phase25_usefulness_kpis,
    'phase25_operational_health_kpis.json': reports.phase25_operational_health_kpis,
    'phase25_combined_ai_platform_kpi_report.json': reports.phase25_combined_ai_platform_kpi_report,
  };
  for (const [filename, payload] of Object.entries(files)) {
    assertArtifactRedacted(payload);
    fs.writeFileSync(path.join(outDir, filename), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return Object.keys(files);
}
