import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_LATENCY_ARCHIVE,
  assertNoForbiddenClaims,
  validatePhase31LatencyOutlierGuard,
  validatePhase31KLabelUniqueness,
  validateActiveContext,
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

  it('rejects duplicate Phase 31K latency label in ACTIVE_CONTEXT', () => {
    const badActive = [
      'Phase 31: CLOSED PASS',
      'STAGING CONTINUE',
      'Production enablement: NOT APPROVED',
      'Phase 31K (latency outlier): PASS',
    ].join('\n');
    assert.throws(
      () => validateActiveContext(badActive),
      /must not label latency outlier as Phase 31K/,
    );
  });

  it('requires Phase 31O latency outlier in ACTIVE_CONTEXT', () => {
    const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');
    assert.match(active, /Phase 31O.*latency outlier/i);
    assert.doesNotMatch(active, /31K \(latency/i);
  });

  it('operator guide points to Phase 31O archive', () => {
    const operator = readFile(repoRoot, 'docs/ai-platform/PHASE_31_OBSERVABILITY_OPERATOR_GUIDE.md');
    assert.match(operator, /PHASE_31O_LATENCY_OUTLIER_AND_STAGING_CONTINUE_ARCHIVE\.md/);
  });

  it('only one Phase 31K doc exists (preview lifecycle)', () => {
    assert.doesNotThrow(() => validatePhase31KLabelUniqueness(repoRoot));
    const archive = readFile(repoRoot, DOC_LATENCY_ARCHIVE);
    assert.match(archive, /Phase 31O:\s*PASS/i);
    assert.doesNotMatch(archive, /^Phase 31K:\s*PASS/m);
  });

  it('latency archive documents max outlier', () => {
    const archive = readFile(repoRoot, DOC_LATENCY_ARCHIVE);
    assert.match(archive, /1[,.]?037[,.]?645|1037645/);
  });
});
