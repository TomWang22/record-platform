import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCombinedAiPlatformKpiReport,
  writePhase26fReports,
  assertArtifactRedacted,
  containsForbiddenFields,
  Phase26fReportError,
  EVIDENCE_LABELS,
} from '../scripts/lib/phase26f-combined-kpi-report-readonly.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function completeFixtureRows() {
  return {
    ingestionEvents: [
      {
        source_type: 'listing',
        records_received: 10,
        records_indexed: 9,
        embedding_jobs_started: 10,
        embedding_jobs_completed: 9,
        embedding_jobs_failed: 1,
        index_upsert_success: 9,
        index_upsert_failed: 1,
        dead_letter_count: 0,
        retry_count: 1,
      },
    ],
    searchabilityChecks: [
      { source_type: 'listing', arrival_to_searchable_ms: 1000, searchable_verified_at: '2026-07-08T01:00:00Z' },
      { source_type: 'listing', arrival_to_searchable_ms: 2000, searchable_verified_at: '2026-07-08T01:01:00Z' },
    ],
    queryObservations: [
      { protocol: 'HTTP/1.1', rag_total_ms: 100, gate_reason: 'keyword_default', workflow: 'rag_query', fallback_count: 0, canary_error_count: 0 },
      { protocol: 'HTTP/2', rag_total_ms: 120, gate_reason: 'allowlist', workflow: 'rag_query', fallback_count: 0, canary_error_count: 0 },
      { protocol: 'HTTP/3', rag_total_ms: 130, gate_reason: 'keyword_default', workflow: 'rag_query', fallback_count: 0, canary_error_count: 0 },
    ],
    usefulnessObservations: [
      {
        protocol: 'HTTP/1.1',
        evidence_label: 'H1 baseline 57105/57105',
        response_pass: true,
        sentiment_pass: true,
        red_team_safety_pass: true,
        leakage_failures: 0,
        quality_score: 4.5,
        observed_at: '2026-07-08T02:00:00Z',
        workflow: 'seller_intelligence',
      },
      {
        protocol: 'HTTP/2',
        evidence_label: 'H2 replay 57105/57105',
        response_pass: true,
        sentiment_pass: true,
        red_team_safety_pass: true,
        leakage_failures: 0,
        quality_score: 4.0,
        observed_at: '2026-07-08T02:01:00Z',
        workflow: 'seller_intelligence',
      },
      {
        protocol: 'HTTP/3',
        evidence_label: 'H3 replay 57105/57105',
        response_pass: true,
        sentiment_pass: true,
        red_team_safety_pass: true,
        leakage_failures: 0,
        quality_score: 3.5,
        observed_at: '2026-07-08T02:02:00Z',
        workflow: 'seller_intelligence',
      },
    ],
  };
}

describe('phase26f combined kpi report readonly', () => {
  it('builds combined report from complete child KPI fixtures', () => {
    const reports = buildCombinedAiPlatformKpiReport({
      gitSha: 'testsha',
      repoRoot,
      kpiRows: completeFixtureRows(),
      runLevelFallback: { status: 'PASS', run_counts: { completed: 1, failed: 0, running: 0 } },
      operationalInput: { archive_verifiers_pass: true, phase23_guardrails_pass: true },
    });
    assert.equal(reports.phase25_combined_ai_platform_kpi_report.status, 'PASS');
    assert.equal(reports.child_kpi_statuses.ingestion, 'PASS');
    assert.equal(reports.child_kpi_statuses.searchability, 'PASS');
    assert.equal(reports.child_kpi_statuses.query_latency, 'PASS');
    assert.equal(reports.child_kpi_statuses.usefulness, 'PASS');
    assert.ok(reports.phase25_combined_ai_platform_kpi_report.metrics.evidence_labels);
    assert.ok(reports.phase25_combined_ai_platform_kpi_report.metrics.recommendation_usefulness);
  });

  it('returns GAP when no DB/table/rows exist', () => {
    const reports = buildCombinedAiPlatformKpiReport({
      gitSha: 'testsha',
      repoRoot,
      kpiRows: {},
      runLevelFallback: { status: 'GAP', reason: 'unavailable' },
      operationalInput: {},
    });
    assert.equal(reports.child_kpi_statuses.ingestion, 'GAP');
    assert.equal(reports.child_kpi_statuses.searchability, 'GAP');
    assert.equal(reports.child_kpi_statuses.query_latency, 'GAP');
    assert.equal(reports.child_kpi_statuses.usefulness, 'GAP');
  });

  it('returns PARTIAL when one protocol or KPI child is missing', () => {
    const rows = completeFixtureRows();
    rows.queryObservations = rows.queryObservations.filter((row) => row.protocol === 'HTTP/2');
    const reports = buildCombinedAiPlatformKpiReport({
      gitSha: 'testsha',
      repoRoot,
      kpiRows: rows,
      runLevelFallback: { status: 'PASS', run_counts: { completed: 1, failed: 0, running: 0 } },
      operationalInput: { archive_verifiers_pass: true },
    });
    assert.equal(reports.child_kpi_statuses.query_latency, 'PARTIAL');
  });

  it('preserves H1/H2/H3/171315/22C/22B labels', () => {
    const reports = buildCombinedAiPlatformKpiReport({
      gitSha: 'testsha',
      repoRoot,
      kpiRows: completeFixtureRows(),
      operationalInput: { archive_verifiers_pass: true },
    });
    const labels = reports.phase25_combined_ai_platform_kpi_report.metrics.evidence_labels;
    assert.match(labels.h1_baseline, /57105\/57105/);
    assert.match(labels.h2_replay, /57105\/57105/);
    assert.match(labels.h3_replay, /57105\/57105/);
    assert.match(labels.combined_labeled_full_protocol_evidence, /171315\/171315/);
    assert.match(labels.phase_22c, /7200\/7200 sample only/);
    assert.match(labels.phase_22b, /15\/15 smoke only/);
    assert.equal(EVIDENCE_LABELS.labeled_sum_only, '171315/171315');
  });

  it('rejects forbidden raw/private fields', () => {
    assert.equal(containsForbiddenFields({ response_body: 'x' }), true);
    assert.throws(() => {
      assertArtifactRedacted({
        generated_at: new Date().toISOString(),
        metrics: { answer: 'secret' },
      });
    }, Phase26fReportError);
  });

  it('does not call 7200 full parity or 171315 unlabeled cumulative', () => {
    const reports = buildCombinedAiPlatformKpiReport({
      gitSha: 'testsha',
      repoRoot,
      kpiRows: {},
      operationalInput: {},
    });
    const serialized = JSON.stringify(reports.phase25_combined_ai_platform_kpi_report);
    assert.doesNotMatch(serialized, /7200\/7200.*full parity/i);
    assert.doesNotMatch(serialized, /171315\/171315.*unlabeled cumulative/i);
    assert.ok(
      reports.phase25_combined_ai_platform_kpi_report.metrics.evidence_labels.notes.some((note) =>
        /labeled H1\+H2\+H3 only/i.test(note),
      ),
    );
  });

  it('writes only to /tmp in tests', () => {
    const outDir = path.join(os.tmpdir(), `phase26f-test-${process.pid}`);
    const reports = buildCombinedAiPlatformKpiReport({
      gitSha: 'testsha',
      repoRoot,
      kpiRows: completeFixtureRows(),
      operationalInput: { archive_verifiers_pass: true },
    });
    const files = writePhase26fReports(outDir, reports);
    assert.equal(files.length, 6);
    for (const file of files) {
      const content = fs.readFileSync(path.join(outDir, file), 'utf8');
      assertArtifactRedacted(JSON.parse(content));
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
