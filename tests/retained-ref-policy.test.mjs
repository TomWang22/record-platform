import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isForbiddenRetainedRef,
  listForbiddenRetainedRefs,
} from '../scripts/lib/retained-ref-policy.mjs';

describe('retained ref policy', () => {
  it('allows main and feature branches', () => {
    assert.equal(isForbiddenRetainedRef('refs/heads/main'), false);
    assert.equal(isForbiddenRetainedRef('refs/heads/feat/t20-10-shadow-diagnostics'), false);
  });

  it('rejects backup and rewrite refs', () => {
    assert.equal(isForbiddenRetainedRef('refs/heads/backup/trailer-scrub'), true);
    assert.equal(isForbiddenRetainedRef('refs/remotes/origin/rewrite/upload'), true);
    assert.equal(isForbiddenRetainedRef('refs/heads/archive/pre-cursor-cleanup'), true);
  });

  it('rejects cursor-named refs', () => {
    assert.equal(isForbiddenRetainedRef('refs/heads/cursor/cloud-agent'), true);
  });

  it('lists only forbidden refs', () => {
    const refs = [
      'refs/heads/main',
      'refs/heads/backup/old',
      'refs/heads/feat/foo',
    ];
    assert.deepEqual(listForbiddenRetainedRefs(refs), ['refs/heads/backup/old']);
  });
});
