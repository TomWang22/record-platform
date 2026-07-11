import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Phase32hGuardError,
  assertTmpOnly,
  validateEvidenceLabel,
} from '../scripts/lib/phase32h-targeted-reproduction-guard.mjs';
import { PHASE32H_EVIDENCE_LABEL } from '../scripts/lib/phase32h-targeted-reproduction-config.mjs';

describe('phase32h targeted reproduction guard', () => {
  it('requires /tmp output roots', () => {
    assert.throws(() => assertTmpOnly('/var/tmp/x'), Phase32hGuardError);
    assert.doesNotThrow(() => assertTmpOnly('/tmp/phase32h-targeted-reproduction'));
  });

  it('accepts Phase 32H evidence label and rejects merged labels', () => {
    assert.doesNotThrow(() => validateEvidenceLabel(PHASE32H_EVIDENCE_LABEL));
    assert.throws(
      () => validateEvidenceLabel('Phase 32G timing-attributed repaired long-soak matrix: 51840/51840'),
      Phase32hGuardError,
    );
    assert.throws(
      () => validateEvidenceLabel('Phase 31D-R2 repaired staging long-soak matrix: 51840/51840'),
      Phase32hGuardError,
    );
  });
});
