import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  FORBIDDEN_COLUMNS,
  CLOSEOUT_DOC,
  validatePhase26cSearchability,
  readFile,
  Phase26cSearchabilityGuardError,
} from '../scripts/lib/phase26c-searchability-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26c searchability guard', () => {
  it('validates full Phase 26C searchability batch', () => {
    const result = validatePhase26cSearchability(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('closeout claims searchability-only posture', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.match(closeout, /Phase 26C:.*PASS/i);
    assert.match(closeout, /Phase 26D:.*NOT STARTED/i);
    assert.match(closeout, /Schema SQL applied to local\/dev python_ai DB:.*YES/i);
    assert.match(closeout, /Live eval:.*NOT RUN/i);
    assert.match(closeout, /Reindex\/backfill run:.*NO/i);
  });

  it('searchability module rejects forbidden payload keys', () => {
    const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_searchability_checks.py');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.ok(kpiPy.includes(forbidden), `missing forbidden guard for ${forbidden}`);
    }
  });

  it('artifact SHA unchanged', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.ok(closeout.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26cSearchabilityGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26cSearchabilityGuardError('test');
      },
      (err) => err.name === 'Phase26cSearchabilityGuardError',
    );
  });
});
