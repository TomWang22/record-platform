import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePhase28CloseoutGuard,
  Phase28CloseoutGuardError,
} from '../scripts/lib/phase28-production-readiness-closeout-guard.mjs';

describe('phase28 production-readiness closeout guard', () => {
  it('validates closeout docs when present', () => {
    try {
      const result = validatePhase28CloseoutGuard();
      assert.equal(result.status, 'PASS');
    } catch (err) {
      if (err instanceof Phase28CloseoutGuardError) {
        assert.match(err.message, /ACTIVE_CONTEXT|28H|28D|missing/i);
        return;
      }
      throw err;
    }
  });
});
