import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_26F,
  DOC_ARCHIVE,
  DOC_OPERATOR,
  DOC_ACTIVE,
  EXPECTED_ARTIFACT_SHA,
  validatePhase26jArchiveSupersession,
  validateHistoricalSnapshotBanner,
  validateArchivePrecedence,
  validateOperatorHowToRead,
  readFile,
  Phase26jArchiveSupersessionGuardError,
} from '../scripts/lib/phase26j-archive-supersession-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26j archive supersession guard', () => {
  it('validates full supersession batch against the repo', () => {
    const result = validatePhase26jArchiveSupersession(repoRoot);
    assert.equal(result.status, 'PASS');
    assert.ok(result.checks.length >= 6);
  });

  it('requires 26F historical snapshot banner before NOT STARTED', () => {
    const doc26f = readFile(repoRoot, DOC_26F);
    assert.doesNotThrow(() => validateHistoricalSnapshotBanner(doc26f));
  });

  it('requires archive precedence and operator how-to-read', () => {
    assert.doesNotThrow(() => validateArchivePrecedence(readFile(repoRoot, DOC_ARCHIVE)));
    assert.doesNotThrow(() => validateOperatorHowToRead(readFile(repoRoot, DOC_OPERATOR)));
  });

  it('ACTIVE_CONTEXT keeps Phase 26 closed and disabled-by-default truth', () => {
    const active = readFile(repoRoot, DOC_ACTIVE);
    assert.match(active, /Phase 26:\s*CLOSED PASS/i);
    assert.match(active, /Phase 26H/i);
    assert.match(active, /Phase 26I/i);
    assert.match(active, /Operational KPI row population remains disabled by default/i);
    assert.ok(active.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26jArchiveSupersessionGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26jArchiveSupersessionGuardError('test');
      },
      (err) => err.name === 'Phase26jArchiveSupersessionGuardError',
    );
  });
});
