#!/usr/bin/env node
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildR1CanaryManifest, buildR1Manifest } from '../scripts/phase32h-build-r1-manifest.mjs';
import { CONTRACT, PROMPTS, expectedGate, loadN5Participants } from '../scripts/lib/phase22-full-replay-common.mjs';
import {
  R1_CANARY_PER_PROTOCOL,
  R1_CANARY_TOTAL,
  R1_EVIDENCE_LABEL_BASELINE,
  R1_EVIDENCE_LABEL_CANARY,
  R1_PER_PROTOCOL,
  R1_TOTAL,
} from '../scripts/lib/phase32h-r1-config.mjs';
import {
  REQUEST_CONTRACT_BLOCKED,
  assertManifestContract,
  assertRequestContractBeforeNetwork,
  requestBodyFingerprint,
  validateManifestContract,
} from '../scripts/lib/phase32h-manifest-contract.mjs';
import { buildRepairSmokeManifest } from '../scripts/lib/phase32h-repair-smoke-manifest.mjs';
import { shouldRetryProbeResponse } from '../scripts/lib/http-retry-policy.mjs';
import { executeProbe } from '../scripts/phase31-controlled-observability-matrix-runner.mjs';

function sampleRow(overrides = {}) {
  const question = new Map(PROMPTS).get('auction_pressure');
  return {
    probe_id: 1,
    matrix_protocol: 'h1',
    protocol_label: 'HTTP/1.1',
    window: 1,
    run: 1,
    case_id: 'auction_pressure',
    user_class: 'contract',
    user_uid: CONTRACT.uid,
    user_email: CONTRACT.email,
    question,
    expected_gate_reason: 'allowlist',
    evidence_label: R1_EVIDENCE_LABEL_BASELINE,
    ...overrides,
  };
}

describe('phase32h manifest contract', () => {
  it('1. complete R1 manifest validates', () => {
    const report = validateManifestContract(
      buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE }),
      {
        evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
        expectedTotal: R1_TOTAL,
        expectedPerProtocol: R1_PER_PROTOCOL,
      },
    );
    assert.equal(report.status, 'PASS');
    assert.equal(report.rows, R1_TOTAL);
    assert.equal(report.questions_valid, R1_TOTAL);
  });

  it('2. canary manifest contains exactly 90 rows', () => {
    const rows = buildR1CanaryManifest({ evidenceLabel: R1_EVIDENCE_LABEL_CANARY });
    assert.equal(rows.length, 90);
    const report = validateManifestContract(rows, {
      evidenceLabel: R1_EVIDENCE_LABEL_CANARY,
      expectedTotal: R1_CANARY_TOTAL,
      expectedPerProtocol: R1_CANARY_PER_PROTOCOL,
    });
    assert.equal(report.status, 'PASS');
    assert.equal(report.rows, 90);
  });

  it('3. every canary row has question length >= 2', () => {
    const rows = buildR1CanaryManifest({ evidenceLabel: R1_EVIDENCE_LABEL_CANARY });
    for (const row of rows) {
      assert.ok(typeof row.question === 'string');
      assert.ok(row.question.trim().length >= 2);
    }
  });

  it('4. every 8640-arm row has question length >= 2', () => {
    const rows = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
    for (const row of rows) {
      assert.ok(row.question.trim().length >= 2);
    }
  });

  it('5. missing question blocks before network', () => {
    const probe = sampleRow({ question: undefined });
    assert.throws(
      () => assertRequestContractBeforeNetwork(probe, {}),
      (err) => err.code === REQUEST_CONTRACT_BLOCKED,
    );
  });

  it('6. blank question blocks before network', () => {
    const probe = sampleRow({ question: '  ' });
    assert.throws(
      () => assertRequestContractBeforeNetwork(probe, {}),
      (err) => err.code === REQUEST_CONTRACT_BLOCKED,
    );
  });

  it('7. unknown case_id blocks', () => {
    const report = validateManifestContract([sampleRow({ case_id: 'not_a_case', question: 'hello world' })], {
      evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
      expectedTotal: 1,
      expectedPerProtocol: 1,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(report.unknown_cases.includes('not_a_case'));
  });

  it('8. literal undefined blocks', () => {
    const probe = sampleRow({ question: 'undefined' });
    assert.throws(
      () => assertRequestContractBeforeNetwork(probe, {}),
      (err) => err.code === REQUEST_CONTRACT_BLOCKED,
    );
  });

  it('9. duplicate probe_id blocks', () => {
    const row = sampleRow();
    const report = validateManifestContract([row, { ...row, matrix_protocol: 'h2', protocol_label: 'HTTP/2' }], {
      evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
      expectedTotal: 2,
      expectedPerProtocol: 1,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(report.duplicate_probe_ids > 0);
  });

  it('10. duplicate coordinate blocks', () => {
    const row = sampleRow();
    const report = validateManifestContract([row, { ...row, probe_id: 2 }], {
      evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
      expectedTotal: 2,
      expectedPerProtocol: 2,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(report.duplicate_coordinates > 0);
  });

  it('11. wrong protocol count blocks', () => {
    const rows = buildR1CanaryManifest({ evidenceLabel: R1_EVIDENCE_LABEL_CANARY }).slice(0, 89);
    const report = validateManifestContract(rows, {
      evidenceLabel: R1_EVIDENCE_LABEL_CANARY,
      expectedTotal: 90,
      expectedPerProtocol: 30,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(report.violations.some((v) => v.reason === 'wrong_total' || v.reason === 'wrong_protocol_count'));
  });

  it('12. wrong launch SHA blocks', () => {
    const row = sampleRow({ launch_head: 'deadbeef' });
    const report = validateManifestContract([row], {
      evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
      launchHead: 'cafebabe',
      expectedTotal: 1,
      expectedPerProtocol: 1,
    });
    assert.equal(report.status, 'BLOCKED');
  });

  it('13. auction_pressure row serializes question + user_id', () => {
    const question = new Map(PROMPTS).get('auction_pressure');
    const fp = requestBodyFingerprint(question, CONTRACT.uid);
    assert.deepEqual(fp.body_field_names, ['question', 'user_id']);
    assert.ok(fp.body_byte_length > 50);
  });

  it('14. contract and preview rows preserve expected gate reasons', () => {
    const preview = loadN5Participants().find((u) => u.email === 'tom@example.com');
    assert.ok(preview);
    const contractRow = sampleRow({ expected_gate_reason: expectedGate(CONTRACT) });
    const previewRow = sampleRow({
      probe_id: 2,
      matrix_protocol: 'h2',
      protocol_label: 'HTTP/2',
      user_uid: preview.uid,
      user_class: preview.user_class,
      expected_gate_reason: expectedGate(preview),
    });
    const previewH3 = sampleRow({
      probe_id: 3,
      matrix_protocol: 'h3',
      protocol_label: 'HTTP/3',
      user_uid: preview.uid,
      user_class: preview.user_class,
      expected_gate_reason: expectedGate(preview),
    });
    assert.equal(contractRow.expected_gate_reason, 'allowlist');
    assert.equal(previewRow.expected_gate_reason, 'preview_opt_in');
    assertManifestContract([contractRow, previewRow, previewH3], {
      evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
      expectedTotal: 3,
      expectedPerProtocol: 1,
    });
  });

  it('15. deterministic HTTP 422 receives zero retries', () => {
    assert.equal(
      shouldRetryProbeResponse({ http_status: 422, retrieval_mode: null, attempt: 0, maxAttempts: 16 }),
      false,
    );
  });

  it('16. ordinary valid question passes unchanged', () => {
    const probe = sampleRow();
    const payload = assertRequestContractBeforeNetwork(probe, { launchHead: 'abc', runId: 'run-1' });
    assert.equal(payload.question_present, true);
    assert.equal(payload.question_type, 'string');
    assert.ok(payload.question_length >= 2);
  });

  it('repair smoke manifest validates 60 rows', () => {
    const repair = buildRepairSmokeManifest();
    const report = validateManifestContract(repair.rows, {
      evidenceLabel: repair.evidence_label,
      expectedTotal: 60,
      expectedPerProtocol: 20,
    });
    assert.equal(report.status, 'PASS');
    assert.equal(report.questions_valid, 60);
    assert.equal(report.duplicate_probe_ids, 0);
    assert.equal(report.duplicate_coordinates, 0);
  });
});

describe('executeProbe request contract guard', () => {
  it('throws PHASE32H_REQUEST_CONTRACT_BLOCKED before curl on missing question', () => {
    const probe = sampleRow({ question: undefined });
    assert.throws(
      () =>
        executeProbe(
          probe,
          { baseUrl: 'https://example.test', caCert: '/dev/null', curlBin: 'false' },
          () => 'token',
          {},
        ),
      (err) => err.code === REQUEST_CONTRACT_BLOCKED,
    );
  });
});
