import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  FORBIDDEN_COLUMNS,
  CLOSEOUT_DOC,
  validatePhase26eUsefulnessObservation,
  readFile,
  Phase26eUsefulnessObservationGuardError,
} from '../scripts/lib/phase26e-usefulness-observation-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26e usefulness observation guard', () => {
  it('validates full Phase 26E usefulness batch', () => {
    const result = validatePhase26eUsefulnessObservation(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('closeout claims usefulness-only posture', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.match(closeout, /Phase 26E:.*PASS/i);
    assert.match(closeout, /Phase 26F:.*NOT STARTED/i);
    assert.match(closeout, /Live eval:.*NOT RUN/i);
    assert.match(closeout, /H1\/H2\/H3 usefulness labels tested:.*YES/i);
    assert.match(closeout, /No model accuracy claim without ground truth:.*YES/i);
    assert.match(closeout, /Bench logs committed:.*NO/i);
  });

  it('usefulness module rejects forbidden payload keys', () => {
    const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_usefulness_observations.py');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.ok(kpiPy.includes(forbidden), `missing forbidden guard for ${forbidden}`);
    }
  });

  it('artifact SHA unchanged', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.ok(closeout.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26eUsefulnessObservationGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26eUsefulnessObservationGuardError('test');
      },
      (err) => err.name === 'Phase26eUsefulnessObservationGuardError',
    );
  });
});
