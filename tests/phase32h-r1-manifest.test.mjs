import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildR1Manifest, buildR1CanaryManifest } from '../scripts/phase32h-build-r1-manifest.mjs';
import {
  R1_CASE_IDS,
  R1_CANARY_PER_PROTOCOL,
  R1_CANARY_TOTAL,
  R1_PER_PROTOCOL,
  R1_TOTAL,
  R1_WINDOWS,
  R1_EVIDENCE_LABEL_BASELINE,
  R1_EVIDENCE_LABEL_CANARY,
  r1Dimensions,
} from '../scripts/lib/phase32h-r1-config.mjs';

describe('phase32h R1 manifest', () => {
  it('builds 8640 rows with 2880 per protocol', () => {
    const rows = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
    assert.equal(rows.length, R1_TOTAL);
    assert.equal(rows.filter((r) => r.matrix_protocol === 'h1').length, R1_PER_PROTOCOL);
    assert.equal(rows.filter((r) => r.matrix_protocol === 'h2').length, R1_PER_PROTOCOL);
    assert.equal(rows.filter((r) => r.matrix_protocol === 'h3').length, R1_PER_PROTOCOL);
  });

  it('uses eight windows and six extreme-associated cases', () => {
    const rows = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
    assert.deepEqual([...new Set(rows.map((r) => r.window))].sort((a, b) => a - b), R1_WINDOWS);
    assert.deepEqual([...new Set(rows.map((r) => r.case_id))].sort(), [...R1_CASE_IDS].sort());
    assert.ok(rows.some((r) => r.case_id === 'final_tagged_plan'));
  });

  it('dimensions are 3×8×6×10×6', () => {
    const dims = r1Dimensions();
    assert.equal(dims.total, 8640);
    assert.equal(dims.per_protocol, 2880);
  });

  it('builds 90-row canary manifest with 30 per protocol', () => {
    const rows = buildR1CanaryManifest({ evidenceLabel: R1_EVIDENCE_LABEL_CANARY });
    assert.equal(rows.length, R1_CANARY_TOTAL);
    assert.equal(rows.filter((r) => r.matrix_protocol === 'h1').length, R1_CANARY_PER_PROTOCOL);
    assert.equal(rows.filter((r) => r.matrix_protocol === 'h2').length, R1_CANARY_PER_PROTOCOL);
    assert.equal(rows.filter((r) => r.matrix_protocol === 'h3').length, R1_CANARY_PER_PROTOCOL);
    const dims = r1Dimensions({ canary: true });
    assert.equal(dims.total, 90);
    assert.equal(dims.triplet_batches, 30);
  });
});
