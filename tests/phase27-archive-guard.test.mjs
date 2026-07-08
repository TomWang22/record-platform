import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_ARCHIVE,
  DOC_OPERATOR,
  DOC_CODE_MAP,
  DOC_27I,
  DOC_ACTIVE,
  EXPECTED_ARTIFACT_SHA,
  validatePhase27Archive,
  validateArchiveDoc,
  validateOperatorGuide,
  validateCodeMap,
  readFile,
  Phase27ArchiveGuardError,
} from '../scripts/lib/phase27-archive-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase27 archive guard', () => {
  it('validates full Phase 27I archive batch', () => {
    const result = validatePhase27Archive(repoRoot);
    assert.equal(result.status, 'PASS');
    assert.equal(result.docs_checked, 5);
  });

  it('archive docs require CLOSED PASS and non-production posture', () => {
    assert.doesNotThrow(() => validateArchiveDoc(readFile(repoRoot, DOC_ARCHIVE)));
    assert.doesNotThrow(() => validateOperatorGuide(readFile(repoRoot, DOC_OPERATOR)));
    assert.doesNotThrow(() => validateCodeMap(readFile(repoRoot, DOC_CODE_MAP)));
  });

  it('ACTIVE_CONTEXT and 27I keep artifact SHA and Phase 28A next step', () => {
    const active = readFile(repoRoot, DOC_ACTIVE);
    const doc27i = readFile(repoRoot, DOC_27I);
    assert.ok(active.includes(EXPECTED_ARTIFACT_SHA) || doc27i.includes(EXPECTED_ARTIFACT_SHA));
    assert.match(active, /Phase 27:\s*CLOSED PASS/i);
    assert.match(doc27i, /Phase 28A/);
  });

  it('Phase27ArchiveGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase27ArchiveGuardError('test');
      },
      (err) => err.name === 'Phase27ArchiveGuardError',
    );
  });
});
