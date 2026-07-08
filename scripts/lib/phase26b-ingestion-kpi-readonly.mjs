/**
 * Phase 26B — ingestion KPI aggregation from ai_kpi_ingestion_events (read-only).
 */
import { summarizeIngestionKpi } from './phase24b-ai-kpi-readonly.mjs';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ingestionSuccessRate(received, indexed) {
  if (received <= 0) return null;
  return indexed / received;
}

export function summarizeIngestionKpiFromEvents(eventRows, runLevelFallback = null) {
  if (!Array.isArray(eventRows) || eventRows.length === 0) {
    const fallback = summarizeIngestionKpi(runLevelFallback);
    return {
      ...fallback,
      source: 'ai.ai_ingestion_runs_fallback',
      kpi_events_available: false,
    };
  }

  const bySourceType = {};
  for (const row of eventRows) {
    const sourceType = row.source_type;
    if (!bySourceType[sourceType]) {
      bySourceType[sourceType] = {
        records_received: 0,
        records_indexed: 0,
        embedding_jobs_started: 0,
        embedding_jobs_completed: 0,
        embedding_jobs_failed: 0,
        index_upsert_success: 0,
        index_upsert_failed: 0,
        dead_letter_count: 0,
        retry_count: 0,
        event_count: 0,
      };
    }
    const bucket = bySourceType[sourceType];
    bucket.records_received += toNumber(row.records_received);
    bucket.records_indexed += toNumber(row.records_indexed);
    bucket.embedding_jobs_started += toNumber(row.embedding_jobs_started);
    bucket.embedding_jobs_completed += toNumber(row.embedding_jobs_completed);
    bucket.embedding_jobs_failed += toNumber(row.embedding_jobs_failed);
    bucket.index_upsert_success += toNumber(row.index_upsert_success);
    bucket.index_upsert_failed += toNumber(row.index_upsert_failed);
    bucket.dead_letter_count += toNumber(row.dead_letter_count);
    bucket.retry_count += toNumber(row.retry_count);
    bucket.event_count += 1;
  }

  const bySourceTypeWithRates = {};
  for (const [sourceType, metrics] of Object.entries(bySourceType)) {
    bySourceTypeWithRates[sourceType] = {
      ...metrics,
      ingestion_success_rate: ingestionSuccessRate(metrics.records_received, metrics.records_indexed),
    };
  }

  const runLevel = summarizeIngestionKpi(runLevelFallback);

  return {
    status: 'PASS',
    source: 'ai.ai_kpi_ingestion_events',
    kpi_events_available: true,
    by_source_type: bySourceTypeWithRates,
    run_counts: runLevel.run_counts ?? null,
    run_success_rate: runLevel.run_success_rate ?? null,
    last_ingestion_run: runLevel.last_ingestion_run ?? null,
    corpus: runLevel.corpus ?? null,
    ingestion_success_rate: null,
    notes: [
      'Per-source_type ingestion_success_rate from ai.ai_kpi_ingestion_events aggregates',
      'Run-level fallback preserved when ai.ai_ingestion_runs data is available',
    ],
  };
}

export function summarizeIngestionKpiHonest(eventRows, runLevelFallback = null) {
  if (!Array.isArray(eventRows) || eventRows.length === 0) {
    const fallback = summarizeIngestionKpi(runLevelFallback);
    return {
      ...fallback,
      source: runLevelFallback?.status === 'GAP' ? 'unavailable' : 'ai.ai_ingestion_runs_fallback',
      kpi_events_available: false,
    };
  }
  return summarizeIngestionKpiFromEvents(eventRows, runLevelFallback);
}
