import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_RFC,
  EXPECTED_ARTIFACT_SHA,
  validatePhase29ProductionEnablementGuard,
  validateRfcDoc,
  readFile,
  Phase29ProductionEnablementGuardError,
  assertNoForbiddenProductionClaims,
} from '../scripts/lib/phase29-production-enablement-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase29 production enablement guard', () => {
  it('validates Phase 29 doc batch', () => {
    const result = validatePhase29ProductionEnablementGuard(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('RFC includes artifact SHA and decision options', () => {
    const rfc = readFile(repoRoot, DOC_RFC);
    assert.ok(rfc.includes(EXPECTED_ARTIFACT_SHA));
    assert.doesNotThrow(() => validateRfcDoc(rfc));
  });

  it('rejects forbidden production rollout claims', () => {
    assert.throws(
      () => assertNoForbiddenProductionClaims('Phase 29 production rollout approved.', 'test.md'),
      Phase29ProductionEnablementGuardError,
    );
  });
});
