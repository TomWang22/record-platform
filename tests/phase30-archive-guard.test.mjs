import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePhase30Archive, EXPECTED_ARTIFACT_SHA, readFile, DOC_30K } from '../scripts/lib/phase30-archive-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase30 archive guard', () => {
  it('validates Phase 30K doc batch', () => {
    assert.equal(validatePhase30Archive(repoRoot).status, 'PASS');
  });
  it('30K includes artifact SHA', () => {
    assert.ok(readFile(repoRoot, DOC_30K).includes(EXPECTED_ARTIFACT_SHA));
  });
});
