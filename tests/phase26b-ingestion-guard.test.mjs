import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  FORBIDDEN_COLUMNS,
  CLOSEOUT_DOC,
  validatePhase26bIngestion,
  readFile,
  Phase26bIngestionGuardError,
} from '../scripts/lib/phase26b-ingestion-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26b ingestion guard', () => {
  it('validates full Phase 26B ingestion batch', () => {
    const result = validatePhase26bIngestion(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('closeout claims ingestion-only posture', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.match(closeout, /Phase 26B:.*PASS/i);
    assert.match(closeout, /Phase 26C:.*NOT STARTED/i);
    assert.match(closeout, /Live eval:.*NOT RUN/i);
    assert.match(closeout, /Reindex\/backfill run:.*NO/i);
    assert.match(closeout, /Default flags OFF:.*PASS/i);
  });

  it('ingestion module rejects forbidden payload keys', () => {
    const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_ingestion_events.py');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.ok(kpiPy.includes(forbidden), `missing forbidden guard for ${forbidden}`);
    }
  });

  it('artifact SHA unchanged', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.ok(closeout.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26bIngestionGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26bIngestionGuardError('test');
      },
      (err) => err.name === 'Phase26bIngestionGuardError',
    );
  });
});
