import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPhase32hManifest } from '../scripts/phase32h-build-targeted-manifest.mjs';
import {
  PHASE32H_EVIDENCE_LABEL,
  TARGET_PER_PROTOCOL,
  TARGET_TOTAL,
  TARGETED_CASE_IDS,
  matrixDimensions,
} from '../scripts/lib/phase32h-targeted-reproduction-config.mjs';

describe('phase32h targeted manifest', () => {
  it('builds 17280 rows with mandatory final_tagged_plan', () => {
    const rows = buildPhase32hManifest();
    assert.equal(rows.length, TARGET_TOTAL);
    assert.equal(rows.filter((r) => r.matrix_protocol === 'h1').length, TARGET_PER_PROTOCOL);
    assert.ok(rows.some((r) => r.case_id === 'final_tagged_plan'));
    assert.deepEqual([...new Set(rows.map((r) => r.case_id))].sort(), [...TARGETED_CASE_IDS].sort());
  });

  it('uses distinct Phase 32H evidence label', () => {
    const rows = buildPhase32hManifest();
    assert.ok(rows.every((r) => r.evidence_label === PHASE32H_EVIDENCE_LABEL));
    assert.doesNotMatch(PHASE32H_EVIDENCE_LABEL, /32G|31D-R2|57105/);
  });

  it('matrix dimensions match 3×16×6×10×6', () => {
    const dims = matrixDimensions();
    assert.equal(dims.total, 17280);
    assert.equal(dims.per_protocol, 5760);
  });
});
