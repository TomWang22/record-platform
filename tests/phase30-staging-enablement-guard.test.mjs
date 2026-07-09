import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_PLAN,
  EXPECTED_ARTIFACT_SHA,
  validatePhase30StagingEnablementGuard,
  readFile,
} from '../scripts/lib/phase30-staging-enablement-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase30 staging enablement guard', () => {
  it('validates Phase 30 doc batch', () => {
    const result = validatePhase30StagingEnablementGuard(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('plan includes artifact SHA', () => {
    const plan = readFile(repoRoot, DOC_PLAN);
    assert.ok(plan.includes(EXPECTED_ARTIFACT_SHA));
  });
});
