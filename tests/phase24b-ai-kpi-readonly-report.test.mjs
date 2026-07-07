import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertReportIsRedacted,
  buildKpiReport,
  buildOperationalHealth,
  containsForbiddenContent,
  extractUsefulnessFromDocs,
  formatCombinedEvidenceLabel,
  summarizeDataToSearchableKpi,
  summarizeIngestionKpi,
} from '../scripts/lib/phase24b-ai-kpi-readonly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const reportScript = path.join(repoRoot, 'scripts/phase24b-ai-kpi-readonly-report.mjs');

test('summarizer handles complete usefulness metrics', () => {
  const { recommendation_usefulness: usefulness } = extractUsefulnessFromDocs(repoRoot);
  assert.equal(usefulness.h2_replay.count.completed, 57105);
  assert.equal(usefulness.h3_replay.count.completed, 57105);
  assert.equal(usefulness.h2_replay.response_pass_rate, 100);
  assert.equal(usefulness.h3_replay.red_team_safety_pass_rate, 100);
  assert.equal(usefulness.phase_22c_sample.count.completed, 7200);
});

test('summarizer labels H1 H2 H3 separately', () => {
  const { recommendation_usefulness: usefulness } = extractUsefulnessFromDocs(repoRoot);
  assert.match(usefulness.h1_baseline.evidence_label, /H1 baseline/);
  assert.match(usefulness.h2_replay.evidence_label, /H2 replay/);
  assert.match(usefulness.h3_replay.evidence_label, /H3 replay/);
  assert.match(usefulness.phase_22c_sample.evidence_label, /7200\/7200 sample only/);
});

test('summarizer does not merge 171315 into unlabeled cumulative', () => {
  const report = buildKpiReport({
    repoRoot,
    ingestionQueryResult: { status: 'GAP', reason: 'test' },
    operationalInput: { archive_verifiers_pass: true },
  });
  const combined = report.recommendation_usefulness.combined_labeled_full_protocol_evidence;
  assert.equal(combined.sum, 171315);
  assert.equal(combined.not_an_unlabeled_cumulative_matrix, true);
  const label = formatCombinedEvidenceLabel(report);
  assert.match(label, /labeled H1\+H2\+H3 only/);
  assert.doesNotMatch(JSON.stringify(report), /171315 cumulative/i);
  assert.doesNotMatch(JSON.stringify(report), /171315 unlabeled/i);
});

test('missing ingestion data returns GAP not PASS', () => {
  const summary = summarizeIngestionKpi({ status: 'GAP', reason: 'db_unavailable' });
  assert.equal(summary.status, 'GAP');
  assert.equal(summary.ingestion_success_rate, null);
});

test('missing data-to-searchable chain returns GAP not invented timing', () => {
  const summary = summarizeDataToSearchableKpi({
    last_run: { started_at: '2026-01-01T00:00:00.000Z', finished_at: '2026-01-01T00:05:00.000Z' },
  });
  assert.equal(summary.status, 'GAP');
  assert.equal(summary.arrival_to_searchable_ms, null);
});

test('operational health report preserves production locks', () => {
  const health = buildOperationalHealth({
    archive_verifiers_pass: true,
    phase23_guardrails_pass: true,
    production_env: {
      AI_RAG_HYBRID_CANARY: '1',
      AI_RAG_HYBRID_CANARY_PERCENT: '0',
      AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT: '0',
    },
  });
  assert.equal(health.production_posture.production_default, 'keyword');
  assert.equal(health.production_posture.percent, 0);
  assert.equal(health.production_posture.allow_prod_percent, 0);
  assert.equal(health.production_posture.hybrid_vector_production_default, 'NOT APPROVED');
});

test('redacted output contains no response bodies JWTs passwords or DB dumps', () => {
  const report = buildKpiReport({
    repoRoot,
    ingestionQueryResult: { status: 'GAP', reason: 'test' },
    operationalInput: { archive_verifiers_pass: true },
  });
  const serialized = JSON.stringify(report);
  assert.equal(containsForbiddenContent(serialized), false);
  assert.equal(assertReportIsRedacted(report), true);
  assert.doesNotMatch(serialized, /eyJ[A-Za-z0-9_-]{10,}/);
});

test('phase24b report script exits PASS', () => {
  const result = spawnSync(process.execPath, [reportScript], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS: Phase 24B AI-platform KPI read-only report/);
});

test('fixture report with forbidden content is rejected', () => {
  const badReport = { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig' };
  assert.throws(() => assertReportIsRedacted(badReport));
});

test('partial ingestion data stays PARTIAL or GAP without inventing per-record success', () => {
  const summary = summarizeIngestionKpi({
    status: 'PASS',
    run_counts: { completed: 0, failed: 0, running: 0 },
    corpus: { document_count: 0, chunk_count: 0, chunks_with_embedding: 0 },
    last_run: null,
  });
  assert.notEqual(summary.status, 'PASS');
  assert.equal(summary.ingestion_success_rate, null);
});
