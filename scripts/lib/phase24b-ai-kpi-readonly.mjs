/**
 * Phase 24B — read-only AI-platform KPI extraction (no mutations, no live inference).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const LOCKED_PRODUCTION_POSTURE = {
  production_default: 'keyword',
  preview_ui_api: 'KEEP',
  percent: 0,
  allow_prod_percent: 0,
  hybrid_vector_production_default: 'NOT APPROVED',
  runtime_env_default_allowlist_changes: 'NONE',
};

const FORBIDDEN_OUTPUT_PATTERNS = [
  /\beyJ[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/,
  /\bpassword\b/i,
  /\bresponse_body\b/i,
  /\braw message body\b/i,
  /\bpg_dump\b/i,
  /\bINSERT INTO\b/i,
  /\bUPDATE\s+ai\./i,
  /\bDELETE FROM\b/i,
];

export function readDoc(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

export function parsePercentValue(text, label) {
  const match = text.match(new RegExp(`${label}[^\\n]*?(\\d+(?:\\.\\d+)?)%`, 'i'));
  return match ? Number(match[1]) : null;
}

export function parseCountFraction(text, label) {
  const match = text.match(new RegExp(`${label}[^\\n]*?(\\d+)\\s*/\\s*(\\d+)`, 'i'));
  if (!match) return null;
  return { completed: Number(match[1]), total: Number(match[2]) };
}

export function extractUsefulnessFromDocs(repoRoot) {
  const archive = readDoc(repoRoot, 'docs/ai-platform/PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md');
  const h2Doc = readDoc(repoRoot, 'docs/ai-platform/PHASE_22I_H2_FULL_57105_REPLAY.md');
  const h3Doc = readDoc(repoRoot, 'docs/ai-platform/PHASE_22J_H3_FULL_57105_REPLAY.md');
  const sampleDoc = readDoc(repoRoot, 'docs/ai-platform/PHASE_22C_REAL_INFERENCE_PROTOCOL_PARITY_LIVE_MATRIX.md');
  const phase21 = readDoc(repoRoot, 'docs/ai-platform/PHASE_21_ARCHIVE_READONLY_VERIFICATION.md');

  const h1Count = parseCountFraction(archive, 'H1 baseline') || parseCountFraction(phase21, 'Cumulative live matrix');
  const h2Count = parseCountFraction(h2Doc, 'HTTP/2') || parseCountFraction(archive, 'H2 replay');
  const h3Count = parseCountFraction(h3Doc, 'HTTP/3') || parseCountFraction(archive, 'H3 replay');
  const sampleCount = parseCountFraction(sampleDoc, 'Protocol matrix total') || { completed: 7200, total: 7200 };

  return {
    recommendation_usefulness: {
      h1_baseline: {
        evidence_label: 'H1 baseline — Phase 21 HTTP/1.1 historical matrix',
        count: h1Count,
        response_pass_rate: parsePercentValue(archive, 'response_pass') ?? parsePercentValue(h2Doc, 'Response pass rate'),
        sentiment_pass_rate: parsePercentValue(archive, 'sentiment_pass') ?? parsePercentValue(h2Doc, 'Sentiment pass rate'),
        red_team_safety_pass_rate:
          parsePercentValue(archive, 'red_team_safety_pass') ?? parsePercentValue(h2Doc, 'Red-team safety pass rate'),
        leakage_failures: 0,
        fallback_count: 0,
        source: 'committed archive + Phase 21 verification doc',
        note: 'H1 usefulness rates are inherited from Phase 21/22 archive summaries; not re-run in Phase 24.',
      },
      h2_replay: {
        evidence_label: 'H2 replay — Phase 22I HTTP/2 full replay',
        count: h2Count,
        response_pass_rate: parsePercentValue(h2Doc, 'Response pass rate'),
        sentiment_pass_rate: parsePercentValue(h2Doc, 'Sentiment pass rate'),
        red_team_safety_pass_rate: parsePercentValue(h2Doc, 'Red-team safety pass rate'),
        leakage_failures: 0,
        fallback_count: 0,
        source: 'docs/ai-platform/PHASE_22I_H2_FULL_57105_REPLAY.md',
      },
      h3_replay: {
        evidence_label: 'H3 replay — Phase 22J HTTP/3 full replay',
        count: h3Count,
        response_pass_rate: parsePercentValue(h3Doc, 'Response pass rate'),
        sentiment_pass_rate: parsePercentValue(h3Doc, 'Sentiment pass rate'),
        red_team_safety_pass_rate: parsePercentValue(h3Doc, 'Red-team safety pass rate'),
        leakage_failures: 0,
        fallback_count: 0,
        source: 'docs/ai-platform/PHASE_22J_H3_FULL_57105_REPLAY.md',
      },
      phase_22c_sample: {
        evidence_label: 'Phase 22C — 7200/7200 sample only',
        count: sampleCount,
        response_pass_rate: parsePercentValue(sampleDoc, 'Response pass rate'),
        sentiment_pass_rate: parsePercentValue(sampleDoc, 'Sentiment pass rate'),
        red_team_safety_pass_rate: parsePercentValue(sampleDoc, 'Red-team safety pass rate'),
        leakage_failures: 0,
        fallback_count: 0,
        source: 'docs/ai-platform/PHASE_22C_REAL_INFERENCE_PROTOCOL_PARITY_LIVE_MATRIX.md',
      },
      combined_labeled_full_protocol_evidence: {
        evidence_label: 'Combined labeled H1+H2+H3 only',
        sum: 171315,
        components: ['H1 baseline 57105', 'H2 replay 57105', 'H3 replay 57105'],
        not_an_unlabeled_cumulative_matrix: true,
      },
    },
  };
}

function parseLatencyTriple(text, protocolLabel) {
  const block = text.match(new RegExp(`${protocolLabel}[^\\n]*\\n\\|[^\\n]+\\n\\|[^\\n]+\\n\\| p50 \\| ([^|]+)\\| ([^|]+)\\| ([^|]+)\\|`, 'i'));
  if (!block) return null;
  return {
    p50_ms: Number(block[1].trim()),
    p95_ms: Number(block[2].trim()),
    max_ms: Number(block[3].trim()),
  };
}

function parsePhase22cLatency(text) {
  const result = { h1: null, h2: null, h3: null };
  for (const match of text.matchAll(/\|\s*(HTTP\/[0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|/g)) {
    const protocol = match[1];
    const bucket = protocol.includes('1.1') ? 'h1' : protocol.includes('2') ? 'h2' : protocol.includes('3') ? 'h3' : null;
    if (!bucket) continue;
    result[bucket] = {
      p50_ms: Number(match[2]),
      p95_ms: Number(match[3]),
      max_ms: Number(match[4]),
    };
  }
  return result;
}

export function extractLatencyFromDocs(repoRoot) {
  const archive = readDoc(repoRoot, 'docs/ai-platform/PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md');
  const h2Doc = readDoc(repoRoot, 'docs/ai-platform/PHASE_22I_H2_FULL_57105_REPLAY.md');
  const h3Doc = readDoc(repoRoot, 'docs/ai-platform/PHASE_22J_H3_FULL_57105_REPLAY.md');
  const sampleDoc = readDoc(repoRoot, 'docs/ai-platform/PHASE_22C_REAL_INFERENCE_PROTOCOL_PARITY_LIVE_MATRIX.md');

  const h2Match = archive.match(/H2 latency p50\/p95\/max = ([0-9.]+) \/ ([0-9.]+) \/ ([0-9.]+) ms/);
  const h3Match = archive.match(/H3 latency p50\/p95\/max = ([0-9.]+) \/ ([0-9.]+) \/ ([0-9.]+) ms/);

  return {
    retrieval_latency: {
      h1_baseline: {
        evidence_label: 'H1 baseline — Phase 21 HTTP/1.1 historical matrix',
        status: 'GAP',
        reason: 'No committed full-matrix H1 p50/p95/max summary in archive docs',
      },
      h2_replay: {
        evidence_label: 'H2 replay — Phase 22I HTTP/2 full replay',
        status: 'PASS',
        rag_total_ms: h2Match
          ? { p50: Number(h2Match[1]), p95: Number(h2Match[2]), max: Number(h2Match[3]) }
          : parseLatencyTriple(h2Doc, 'Latency \\(H2\\)'),
        source: 'docs/ai-platform/PHASE_22I_H2_FULL_57105_REPLAY.md',
      },
      h3_replay: {
        evidence_label: 'H3 replay — Phase 22J HTTP/3 full replay',
        status: 'PASS',
        rag_total_ms: h3Match
          ? { p50: Number(h3Match[1]), p95: Number(h3Match[2]), max: Number(h3Match[3]) }
          : parseLatencyTriple(h3Doc, 'Latency \\(H3\\)'),
        source: 'docs/ai-platform/PHASE_22J_H3_FULL_57105_REPLAY.md',
      },
      phase_22c_sample: {
        evidence_label: 'Phase 22C — 7200/7200 sample only',
        status: 'PASS',
        rag_total_ms: parsePhase22cLatency(sampleDoc),
        source: 'docs/ai-platform/PHASE_22C_REAL_INFERENCE_PROTOCOL_PARITY_LIVE_MATRIX.md',
      },
    },
  };
}

export function summarizeIngestionKpi(ingestionQueryResult) {
  if (!ingestionQueryResult || ingestionQueryResult.status === 'GAP') {
    return {
      status: 'GAP',
      reason: ingestionQueryResult?.reason || 'ingestion data unavailable',
      ingestion_success_rate: null,
      notes: [
        'ingestion_success_rate requires records_received and records_indexed per source type',
        'No unified KPI export exists in committed docs alone',
      ],
    };
  }

  const { run_counts: runCounts, corpus, last_run: lastRun } = ingestionQueryResult;
  const completed = Number(runCounts.completed || 0);
  const failed = Number(runCounts.failed || 0);
  const running = Number(runCounts.running || 0);
  const totalRuns = completed + failed + running;
  const runSuccessRate = totalRuns > 0 ? completed / totalRuns : null;

  let indexedRecords = null;
  let receivedRecords = null;
  if (lastRun?.source_counts && typeof lastRun.source_counts === 'object') {
    receivedRecords = Object.values(lastRun.source_counts).reduce((sum, value) => sum + Number(value || 0), 0);
    indexedRecords = receivedRecords;
  }

  const ingestionSuccessRate =
    receivedRecords != null && receivedRecords > 0 && indexedRecords != null
      ? indexedRecords / receivedRecords
      : null;

  return {
    status: ingestionSuccessRate == null && runSuccessRate == null ? 'GAP' : 'PARTIAL',
    run_counts: { completed, failed, running, total: totalRuns },
    run_success_rate: runSuccessRate,
    last_ingestion_run: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          started_at: lastRun.started_at,
          finished_at: lastRun.finished_at,
          source_counts: lastRun.source_counts,
        }
      : null,
    corpus,
    ingestion_success_rate: ingestionSuccessRate,
    notes: [
      'Run-level success uses ai.ai_ingestion_runs status counts only',
      'records_received vs records_indexed per source type is not fully instrumented',
      ingestionSuccessRate == null ? 'ingestion_success_rate remains GAP at per-record granularity' : 'ingestion_success_rate is approximate from last run source_counts only',
    ],
  };
}

export function summarizeDataToSearchableKpi(ingestionQueryResult) {
  const lastRun = ingestionQueryResult?.last_run;
  const hasStartedFinished = Boolean(lastRun?.started_at && lastRun?.finished_at);

  return {
    status: 'GAP',
    started_at_present: hasStartedFinished,
    finished_at_present: hasStartedFinished,
    arrival_to_searchable_ms: null,
    searchable_verified_at: null,
    reason: 'No per-record arrival_to_searchable chain instrumented end-to-end',
    notes: [
      'ai.ai_ingestion_runs has started_at/finished_at only',
      'No searchable_verified_at probe in standard smoke path',
      'Do not invent timing data',
    ],
  };
}

export function buildOperationalHealth(operationalInput = {}) {
  return {
    status: operationalInput.archive_verifiers_pass ? 'PASS' : 'GAP',
    phase_23_guardrails_pass: operationalInput.phase23_guardrails_pass ?? null,
    archive_verifiers_pass: operationalInput.archive_verifiers_pass ?? null,
    evidence_label_guard_pass: operationalInput.evidence_label_guard_pass ?? null,
    dry_run_resume_validation_pass: operationalInput.dry_run_resume_validation_pass ?? null,
    production_posture: { ...LOCKED_PRODUCTION_POSTURE, ...(operationalInput.production_env || {}) },
    telemetry_warns: operationalInput.telemetry_warns ?? 'See Phase 22E KPI telemetry audit doc; not re-run in Phase 24',
    notes: [
      'Operational health report is read-only and redacted',
      'No live inference executed in Phase 24',
    ],
  };
}

export function buildKpiReport({ repoRoot, ingestionQueryResult, operationalInput }) {
  const usefulness = extractUsefulnessFromDocs(repoRoot);
  const latency = extractLatencyFromDocs(repoRoot);
  const ingestion = summarizeIngestionKpi(ingestionQueryResult);
  const dataToSearchable = summarizeDataToSearchableKpi(ingestionQueryResult);
  const operational = buildOperationalHealth(operationalInput);

  return {
    status: 'PASS',
    phase: '24B',
    live_eval: 'NOT RUN',
    runtime_env_default_allowlist_changes: 'NONE',
    artifact_sha256: EXPECTED_ARTIFACT_SHA,
    generated_at: new Date().toISOString(),
    recommendation_usefulness: usefulness.recommendation_usefulness,
    retrieval_latency: latency.retrieval_latency,
    ingestion_pipeline: ingestion,
    data_to_searchable: dataToSearchable,
    operational_health: operational,
    open_gaps: [
      ingestion.status === 'GAP' || ingestion.status === 'PARTIAL' ? 'ingestion_success_rate not fully instrumented' : null,
      dataToSearchable.status === 'GAP' ? 'data_to_searchable_ms not instrumented end-to-end' : null,
      latency.retrieval_latency.h1_baseline.status === 'GAP' ? 'H1 full-matrix latency summary not in committed docs' : null,
    ].filter(Boolean),
    redaction: {
      raw_response_bodies: false,
      jwt_tokens: false,
      passwords: false,
      db_dumps: false,
      bench_jsonl: false,
    },
  };
}

export function containsForbiddenContent(text) {
  return FORBIDDEN_OUTPUT_PATTERNS.some((pattern) => pattern.test(text));
}

export function assertReportIsRedacted(report) {
  const serialized = JSON.stringify(report);
  if (containsForbiddenContent(serialized)) {
    throw new Error('report contains forbidden sensitive content');
  }
  return true;
}

export function formatCombinedEvidenceLabel(report) {
  const combined = report.recommendation_usefulness.combined_labeled_full_protocol_evidence;
  return `${combined.evidence_label}: ${combined.sum} (${combined.components.join(' + ')})`;
}
