import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PHASE32G_MATRIX_OUT,
  MATRIX_TARGET,
  PHASE32G_EVIDENCE_LABEL,
  TARGET_TOTAL,
  isPhase32gRoot,
  resolveMatrixEvidenceLabel,
} from '../scripts/lib/phase32g-long-soak-config.mjs';
import { classifyRcaOutcome } from '../scripts/phase32g-summarize-long-soak.mjs';

describe('phase32g long soak config', () => {
  it('defines 51840 target and distinct evidence label', () => {
    assert.equal(TARGET_TOTAL, 51840);
    assert.equal(MATRIX_TARGET.perProtocol, 17280);
    assert.match(PHASE32G_EVIDENCE_LABEL, /Phase 32G/);
    assert.doesNotMatch(PHASE32G_EVIDENCE_LABEL, /31D-R2/);
    assert.equal(DEFAULT_PHASE32G_MATRIX_OUT, '/tmp/phase32g-timing-attributed-repaired-long-soak');
  });

  it('resolves phase32g evidence label from root', () => {
    assert.equal(
      resolveMatrixEvidenceLabel({}, DEFAULT_PHASE32G_MATRIX_OUT),
      PHASE32G_EVIDENCE_LABEL,
    );
    assert.ok(isPhase32gRoot(DEFAULT_PHASE32G_MATRIX_OUT));
  });
});

describe('phase32g RCA outcome', () => {
  it('classifies not reproduced when max below 60s', () => {
    const rows = [{ timing: { wall_total_ms: 5000, curl_time_total_ms: 4000, rag_total_ms: 3000 } }];
    const result = classifyRcaOutcome(rows, { status: 'PASS' });
    assert.equal(result.outcome, 'RCA_NOT_REPRODUCED_FULL_SOAK');
  });

  it('classifies blocked when gates fail', () => {
    const rows = [{ timing: { wall_total_ms: 1000 } }];
    const result = classifyRcaOutcome(rows, { status: 'BLOCKED' });
    assert.equal(result.outcome, 'BLOCKED');
  });
});
