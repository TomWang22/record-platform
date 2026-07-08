import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_ARCHIVE,
  DOC_OPERATOR,
  DOC_CODE_MAP,
  DOC_28I,
  DOC_ACTIVE,
  EXPECTED_ARTIFACT_SHA,
  validatePhase28Archive,
  validateArchiveDoc,
  validateOperatorGuide,
  validateCodeMap,
  validate28iDoc,
  readFile,
  Phase28ArchiveGuardError,
  assertNoForbiddenProductionClaims,
} from '../scripts/lib/phase28-archive-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase28 archive guard', () => {
  it('validates full Phase 28I archive batch', () => {
    const result = validatePhase28Archive(repoRoot);
    assert.equal(result.status, 'PASS');
    assert.equal(result.docs_checked, 5);
  });

  it('archive docs require CLOSED PASS and non-production posture', () => {
    assert.doesNotThrow(() => validateArchiveDoc(readFile(repoRoot, DOC_ARCHIVE)));
    assert.doesNotThrow(() => validateOperatorGuide(readFile(repoRoot, DOC_OPERATOR)));
    assert.doesNotThrow(() => validateCodeMap(readFile(repoRoot, DOC_CODE_MAP)));
    assert.doesNotThrow(() => validate28iDoc(readFile(repoRoot, DOC_28I)));
  });

  it('ACTIVE_CONTEXT and 28I keep artifact SHA and Phase 29A next step', () => {
    const active = readFile(repoRoot, DOC_ACTIVE);
    const doc28i = readFile(repoRoot, DOC_28I);
    assert.ok(active.includes(EXPECTED_ARTIFACT_SHA) || doc28i.includes(EXPECTED_ARTIFACT_SHA));
    assert.match(active, /Phase 28:\s*CLOSED PASS/i);
    assert.match(doc28i, /Phase 29A/);
  });

  it('rejects forbidden production rollout claims', () => {
    assert.throws(
      () =>
        assertNoForbiddenProductionClaims(
          'Phase 28 production rollout approved for all users.',
          'test.md',
        ),
      Phase28ArchiveGuardError,
    );
    assert.doesNotThrow(() =>
      assertNoForbiddenProductionClaims(
        'NOT production rollout approved. Production enablement: NOT APPROVED.',
        'test.md',
      ),
    );
  });

  it('Phase28ArchiveGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase28ArchiveGuardError('test');
      },
      (err) => err.name === 'Phase28ArchiveGuardError',
    );
  });
});
