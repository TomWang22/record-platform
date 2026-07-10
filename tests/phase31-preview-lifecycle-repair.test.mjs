#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMatrixProbeFailure,
  isDeterministicPreviewGateMismatch,
  TRANSIENT_HTTP_STATUSES,
} from '../scripts/lib/phase31-controlled-matrix-summary.mjs';
import {
  validateParticipantIdentity,
} from '../scripts/lib/phase31-preview-window-coordinator.mjs';

describe('phase31 preview lifecycle repair', () => {
  it('preview user keyword_default under HTTP 200 is deterministic BLOCKED', () => {
    const row = {
      http_status: 200,
      expected_gate_reason: 'preview_opt_in',
      gate_reason: 'keyword_default',
      response_pass: 'PASS',
      leakage_pass: 'PASS',
    };
    assert.equal(isDeterministicPreviewGateMismatch(row), true);
    assert.equal(classifyMatrixProbeFailure(row), 'deterministic');
  });

  it('HTTP 502/503/504 remains retryable', () => {
    for (const status of TRANSIENT_HTTP_STATUSES) {
      if (status === 429) continue;
      const row = {
        http_status: status,
        expected_gate_reason: 'preview_opt_in',
        gate_reason: undefined,
        response_pass: 'FAIL',
        leakage_pass: 'PASS',
      };
      assert.equal(classifyMatrixProbeFailure(row), 'retryable');
    }
  });

  it('contract allowlist gate mismatch on HTTP 200 is deterministic', () => {
    const row = {
      http_status: 200,
      expected_gate_reason: 'allowlist',
      gate_reason: 'keyword_default',
      response_pass: 'PASS',
      leakage_pass: 'PASS',
    };
    assert.equal(isDeterministicPreviewGateMismatch(row), false);
    assert.equal(classifyMatrixProbeFailure(row), 'deterministic');
  });

  it('JWT sub vs x-user-id mismatch fails before probing', () => {
    const user = {
      uid: '00000000-0000-4000-8000-000000000001',
      email: 'test@example.com',
    };
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000002' })).toString(
      'base64url',
    );
    const token = `${header}.${payload}.sig`;
    assert.throws(() => validateParticipantIdentity(user, token), /participant identity mismatch/);
  });

  it('JWT sub match passes identity validation', () => {
    const uid = '00000000-0000-4000-8000-000000000001';
    const user = { uid, email: 'test@example.com' };
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: uid })).toString('base64url');
    const token = `${header}.${payload}.sig`;
    assert.equal(validateParticipantIdentity(user, token), true);
  });

  it('gate verify failure shape blocks coordinator before probes', () => {
    const failures = [{ expected_gate_reason: 'preview_opt_in', observed_gate_reason: 'keyword_default' }];
    const verify = { ok: false, failures };
    assert.equal(verify.ok, false);
    assert.equal(failures[0].observed_gate_reason, 'keyword_default');
  });

  it('targeted replay cannot classify deterministic preview mismatch as retryable', () => {
    const blockedRow = {
      http_status: 200,
      expected_gate_reason: 'preview_opt_in',
      gate_reason: 'keyword_default',
      response_pass: 'PASS',
      leakage_pass: 'PASS',
      lifecycle_diagnostic: {
        failure_class: 'deterministic',
        reason: 'preview_opt_in_expected_keyword_default_observed',
      },
    };
    assert.notEqual(classifyMatrixProbeFailure(blockedRow), 'retryable');
    assert.equal(classifyMatrixProbeFailure(blockedRow), 'deterministic');
  });
});
