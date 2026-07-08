import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeIngestionKpi } from '../scripts/lib/phase24b-ai-kpi-readonly.mjs';
import {
  summarizeIngestionKpiFromEvents,
  summarizeIngestionKpiHonest,
} from '../scripts/lib/phase26b-ingestion-kpi-readonly.mjs';

const runLevelPartial = {
  status: 'PASS',
  run_counts: { completed: 12, failed: 1, running: 0 },
  last_run: {
    id: 'run-1',
    status: 'completed',
    started_at: '2026-06-22T19:19:39.687Z',
    finished_at: '2026-06-22T19:19:41.204Z',
    source_counts: { listing: { inserted: 5, skipped: 0, updated: 0 } },
  },
  corpus: { document_count: 100, chunk_count: 100, chunks_with_embedding: 0 },
};

describe('phase26b ingestion kpi readonly', () => {
  it('reports PASS with per-source_type metrics when event rows exist', () => {
    const result = summarizeIngestionKpiFromEvents(
      [
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
        {
          source_type: 'listing',
          records_received: 5,
          records_indexed: 5,
          embedding_jobs_started: 5,
          embedding_jobs_completed: 5,
          embedding_jobs_failed: 0,
          index_upsert_success: 5,
          index_upsert_failed: 0,
          dead_letter_count: 0,
          retry_count: 0,
        },
      ],
      runLevelPartial,
    );
    assert.equal(result.status, 'PASS');
    assert.equal(result.kpi_events_available, true);
    assert.equal(result.by_source_type.listing.records_received, 15);
    assert.equal(result.by_source_type.listing.records_indexed, 14);
    assert.equal(result.by_source_type.listing.ingestion_success_rate, 14 / 15);
  });

  it('falls back to PARTIAL run-level summary when no event rows', () => {
    const result = summarizeIngestionKpiHonest([], runLevelPartial);
    assert.equal(result.kpi_events_available, false);
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.source, 'ai.ai_ingestion_runs_fallback');
  });

  it('reports GAP honestly when neither events nor run-level data exist', () => {
    const result = summarizeIngestionKpiHonest([], { status: 'GAP', reason: 'db unavailable' });
    assert.equal(result.status, 'GAP');
    assert.equal(result.kpi_events_available, false);
  });

  it('does not invent ingestion_success_rate at top level from events alone', () => {
    const result = summarizeIngestionKpiFromEvents(
      [{ source_type: 'obo_offer_summary', records_received: 4, records_indexed: 4 }],
      runLevelPartial,
    );
    assert.equal(result.ingestion_success_rate, null);
    assert.equal(result.by_source_type.obo_offer_summary.ingestion_success_rate, 1);
  });

  it('run-level summarizer stays PARTIAL without per-record instrumentation', () => {
    const partial = summarizeIngestionKpi(runLevelPartial);
    assert.equal(partial.status, 'PARTIAL');
    assert.ok(partial.notes.some((note) => note.includes('ingestion_success_rate')));
  });
});
