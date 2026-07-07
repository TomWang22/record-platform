#!/usr/bin/env node
/**
 * Phase 24B — read-only ingestion KPI extractor (SELECT only, no mutations).
 */
import { withClient } from './lib/rp-ai-rag-db.mjs';
import { summarizeIngestionKpi, summarizeDataToSearchableKpi } from './lib/phase24b-ai-kpi-readonly.mjs';

async function queryIngestionKpi() {
  return withClient(5440, 'python_ai', async (client) => {
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
  });
}

async function main() {
  try {
    const ingestionQueryResult = await queryIngestionKpi();
    const output = {
      ingestion_pipeline: summarizeIngestionKpi(ingestionQueryResult),
      data_to_searchable: summarizeDataToSearchableKpi(ingestionQueryResult),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    const output = {
      ingestion_pipeline: summarizeIngestionKpi({
        status: 'GAP',
        reason: error instanceof Error ? error.message : String(error),
      }),
      data_to_searchable: summarizeDataToSearchableKpi(null),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(0);
  }
}

main();
