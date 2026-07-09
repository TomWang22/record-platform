import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_29K,
  EXPECTED_ARTIFACT_SHA,
  validatePhase29Archive,
  readFile,
  Phase29ArchiveGuardError,
  assertNoForbiddenProductionClaims,
} from '../scripts/lib/phase29-archive-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase29 archive guard', () => {
  it('validates Phase 29K doc batch', () => {
    const result = validatePhase29Archive(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('29K explainer includes artifact SHA', () => {
    const doc = readFile(repoRoot, DOC_29K);
    assert.ok(doc.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('rejects forbidden production rollout claims', () => {
    assert.throws(
      () => assertNoForbiddenProductionClaims('Phase 29 production rollout approved.', 'test.md'),
      Phase29ArchiveGuardError,
    );
  });
});
