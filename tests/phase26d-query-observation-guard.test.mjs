import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  FORBIDDEN_COLUMNS,
  CLOSEOUT_DOC,
  validatePhase26dQueryObservation,
  readFile,
  Phase26dQueryObservationGuardError,
} from '../scripts/lib/phase26d-query-observation-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26d query observation guard', () => {
  it('validates full Phase 26D query observation batch', () => {
    const result = validatePhase26dQueryObservation(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('closeout claims query-observation-only posture', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.match(closeout, /Phase 26D:.*PASS/i);
    assert.match(closeout, /Phase 26E:.*NOT STARTED/i);
    assert.match(closeout, /Live eval:.*NOT RUN/i);
    assert.match(closeout, /H1\/H2\/H3 protocol capture tested:.*YES/i);
    assert.match(closeout, /Bench logs committed:.*NO/i);
  });

  it('query observation module rejects forbidden payload keys', () => {
    const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_query_observations.py');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.ok(kpiPy.includes(forbidden), `missing forbidden guard for ${forbidden}`);
    }
  });

  it('artifact SHA unchanged', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.ok(closeout.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26dQueryObservationGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26dQueryObservationGuardError('test');
      },
      (err) => err.name === 'Phase26dQueryObservationGuardError',
    );
  });
});
