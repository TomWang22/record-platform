import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_LATENCY_ARCHIVE,
  assertNoForbiddenClaims,
  validatePhase31LatencyOutlierGuard,
  readFile,
} from '../scripts/lib/phase31-latency-outlier-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase31 latency outlier guard', () => {
  it('validates Phase 31 latency outlier doc batch', () => {
    assert.equal(validatePhase31LatencyOutlierGuard(repoRoot).status, 'PASS');
  });

  it('rejects forbidden production enablement claim without negation', () => {
    assert.throws(
      () => assertNoForbiddenClaims('Production enablement approved for Phase 31.', 'test.md'),
      /forbidden posture/,
    );
  });

  it('allows negated production enablement claim', () => {
    assert.doesNotThrow(() =>
      assertNoForbiddenClaims('Production enablement: NOT APPROVED', 'test.md'),
    );
  });

  it('latency archive documents max outlier', () => {
    const archive = readFile(repoRoot, DOC_LATENCY_ARCHIVE);
    assert.match(archive, /1[,.]?037[,.]?645|1037645/);
  });
});
