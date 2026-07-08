#!/usr/bin/env node
/**
 * Phase 26F — combined KPI report CLI (read-only, writes JSON to /tmp only).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClient } from './lib/rp-ai-rag-db.mjs';
import {
  EXPECTED_ARTIFACT_SHA,
  buildCombinedAiPlatformKpiReport,
  writePhase26fReports,
} from './lib/phase26f-combined-kpi-report-readonly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  return {
    outDir: outIndex >= 0 ? argv[outIndex + 1] : '/tmp/phase26f-kpi-report',
  };
}

function resolveGitSha() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

async function queryRunLevelFallback(client) {
  const runCountsResult = await client.query(
    `SELECT status, COUNT(*)::int AS count
     FROM ai.ai_ingestion_runs
     GROUP BY status
     ORDER BY status`,
  );
  const runCounts = { completed: 0, failed: 0, running: 0 };
  for (const row of runCountsResult.rows) {
    runCounts[row.status] = row.count;
  }
  const lastRunResult = await client.query(
    `SELECT id, status, started_at, finished_at, source_counts
     FROM ai.ai_ingestion_runs
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  const corpusDocs = await client.query(`SELECT COUNT(*)::int AS count FROM ai.ai_documents`);
  const corpusChunks = await client.query(`SELECT COUNT(*)::int AS count FROM ai.ai_document_chunks`);
  const embedded = await client.query(
    `SELECT COUNT(*)::int AS count FROM ai.ai_document_chunks WHERE embedding IS NOT NULL`,
  );
  const lastRun = lastRunResult.rows[0]
    ? {
        id: String(lastRunResult.rows[0].id),
        status: lastRunResult.rows[0].status,
        started_at: lastRunResult.rows[0].started_at?.toISOString?.() || lastRunResult.rows[0].started_at,
        finished_at: lastRunResult.rows[0].finished_at?.toISOString?.() || lastRunResult.rows[0].finished_at,
        source_counts: lastRunResult.rows[0].source_counts,
      }
    : null;
  return {
    status: 'PASS',
    run_counts: runCounts,
    last_run: lastRun,
    corpus: {
      document_count: corpusDocs.rows[0].count,
      chunk_count: corpusChunks.rows[0].count,
      chunks_with_embedding: embedded.rows[0].count,
    },
  };
}

async function loadKpiRowsFromDb() {
  return withClient(5440, 'python_ai', async (client) => {
    const ingestionEvents = (
      await client.query(
        `SELECT source_type, records_received, records_indexed,
                embedding_jobs_started, embedding_jobs_completed, embedding_jobs_failed,
                index_upsert_success, index_upsert_failed, dead_letter_count, retry_count
         FROM ai.ai_kpi_ingestion_events
         ORDER BY created_at DESC
         LIMIT 5000`,
      )
    ).rows;
    const searchabilityChecks = (
      await client.query(
        `SELECT source_type, arrival_to_searchable_ms, searchable_verified_at, probe_status
         FROM ai.ai_kpi_searchability_checks
         ORDER BY created_at DESC
         LIMIT 5000`,
      )
    ).rows.map((row) => ({
      ...row,
      searchable_verified_at:
        row.searchable_verified_at?.toISOString?.() || row.searchable_verified_at,
    }));
    const queryObservations = (
      await client.query(
        `SELECT protocol, retrieval_mode, gate_reason, workflow, rag_total_ms,
                fallback_count, canary_error_count, observed_at
         FROM ai.ai_kpi_query_observations
         ORDER BY observed_at DESC
         LIMIT 5000`,
      )
    ).rows.map((row) => ({
      ...row,
      observed_at: row.observed_at?.toISOString?.() || row.observed_at,
    }));
    const usefulnessObservations = (
      await client.query(
        `SELECT protocol, case_id, workflow, response_pass, sentiment_pass,
                red_team_safety_pass, leakage_failures, quality_score, evidence_label, observed_at
         FROM ai.ai_kpi_usefulness_observations
         ORDER BY observed_at DESC
         LIMIT 5000`,
      )
    ).rows.map((row) => ({
      ...row,
      observed_at: row.observed_at?.toISOString?.() || row.observed_at,
      quality_score: row.quality_score == null ? null : Number(row.quality_score),
    }));
    const runLevelFallback = await queryRunLevelFallback(client);
    return {
      ingestionEvents,
      searchabilityChecks,
      queryObservations,
      usefulnessObservations,
      runLevelFallback,
    };
  });
}

function loadOperationalHealth() {
  const result = spawnSync('bash', ['scripts/phase24b-operational-health-readonly.sh'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return { archive_verifiers_pass: false, phase23_guardrails_pass: false };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { archive_verifiers_pass: false, phase23_guardrails_pass: false };
  }
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  const artifactPath = path.join(REPO_ROOT, 'docs/ai-platform/T20-35-owner-approved-real-preview-participants.md');
  const actualSha = spawnSync('shasum', ['-a', '256', artifactPath], { encoding: 'utf8' }).stdout.split(' ')[0];
  if (actualSha !== EXPECTED_ARTIFACT_SHA) {
    console.error(`phase26f-combined-kpi-report: FAIL — artifact SHA mismatch ${actualSha}`);
    process.exit(1);
  }

  let kpiRows = {
    ingestionEvents: [],
    searchabilityChecks: [],
    queryObservations: [],
    usefulnessObservations: [],
  };
  let runLevelFallback = { status: 'GAP', reason: 'python_ai DB unavailable' };
  try {
    const loaded = await loadKpiRowsFromDb();
    kpiRows = loaded;
    runLevelFallback = loaded.runLevelFallback;
  } catch (error) {
    runLevelFallback = {
      status: 'GAP',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const reports = buildCombinedAiPlatformKpiReport({
    gitSha: resolveGitSha(),
    repoRoot: REPO_ROOT,
    kpiRows,
    runLevelFallback,
    operationalInput: loadOperationalHealth(),
  });
  const written = writePhase26fReports(outDir, reports);
  console.log('phase26f-combined-kpi-report: PASS');
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        out_dir: outDir,
        files: written,
        child_kpi_statuses: reports.child_kpi_statuses,
        live_eval: 'NOT RUN',
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`phase26f-combined-kpi-report: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
