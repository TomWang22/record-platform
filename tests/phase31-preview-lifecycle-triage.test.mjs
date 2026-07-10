#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  uidHash,
  redactEmail,
  resolveUserByHash,
  buildFailureTable,
  analyzeWindowContext,
  classifyRootCause,
  buildPreviewLifecycleTriage,
} from '../scripts/phase31-preview-lifecycle-triage-readonly.mjs';

describe('phase31 preview lifecycle triage', () => {
  it('maps uid hash and redacts email', () => {
    const hash = uidHash('b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2');
    assert.equal(hash, '4c6830b9d086');
    assert.equal(redactEmail('phase21-preview-internal-2@record-platform.local'), 'phas…@record-platform.local');
    const user = resolveUserByHash('4c6830b9d086', [
      {
        uid: 'b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2',
        email: 'phase21-preview-internal-2@record-platform.local',
        role: 'preview',
        user_class: 'real_participant',
      },
    ]);
    assert.equal(user.user_uid_hash, '4c6830b9d086');
    assert.equal(user.role, 'preview');
    assert.match(user.email_redacted, /…@/);
  });

  it('builds eight-row failure table from deterministic failures', () => {
    const failures = [
      {
        probe_id: 2142,
        matrix_protocol: 'h3',
        protocol_label: 'HTTP/3',
        window: 4,
        run: 8,
        case_id: 'final_tagged_plan',
        expected_gate_reason: 'preview_opt_in',
        gate_reason: 'keyword_default',
        http_status: 200,
        retrieval_mode: 'keyword',
        user_class: 'real_participant',
        user_uid_hash: '4c6830b9d086',
        response_pass: 'FAIL',
      },
    ];
    const table = buildFailureTable(failures);
    assert.equal(table.length, 1);
    assert.equal(table[0].observed_gate_reason, 'keyword_default');
    assert.equal(table[0].expected_gate_reason, 'preview_opt_in');
  });

  it('classifies sparse late-run keyword failures as runner lifecycle race', () => {
    const failures = Array.from({ length: 8 }, (_, i) => ({
      probe_id: 1000 + i,
      matrix_protocol: i < 4 ? 'h1' : i < 6 ? 'h2' : 'h3',
      window: [20, 22, 26, 29, 17, 17, 4, 4][i],
      run: i === 6 ? 8 : 9,
      case_id: 'pricing_strategy',
      expected_gate_reason: 'preview_opt_in',
      gate_reason: 'keyword_default',
      http_status: 200,
      retrieval_mode: 'keyword',
      user_class: 'real_participant',
      user_uid_hash: '4c6830b9d086',
      response_pass: 'PASS',
    }));
    const windowContext = {
      context: failures.map((f) => ({
        matrix_protocol: f.matrix_protocol,
        window: f.window,
        total_probes: 90,
        wrong_gate: 1,
        late_run_failures: 1,
      })),
    };
    const verdict = classifyRootCause({
      failures,
      windowContext,
      triage: { counts: { lifecycle_bug_suspect: 8, retryable_failures: 0 } },
    });
    assert.equal(verdict.lifecycle_bug_confirmed, true);
    assert.equal(verdict.runner_bug_confirmed, true);
    assert.equal(verdict.service_bug_confirmed, false);
    assert.match(verdict.root_cause, /parallel matrix shards/i);
  });

  it('integrates with on-disk Phase 31 triage when present', () => {
    const report = buildPreviewLifecycleTriage({
      triage: '/tmp/phase31-staging-long-soak-matrix/phase31-failure-triage-final.json',
      matrixIn: '/tmp/phase31-staging-long-soak-matrix',
      out: '/tmp/phase31-preview-lifecycle-triage-test.json',
      live: false,
    });
    assert.equal(report.affected_user_hash, '4c6830b9d086');
    assert.equal(report.failure_table.length, 8);
    assert.equal(report.phase31k_status, 'PASS');
    assert.equal(report.verdict.lifecycle_bug_confirmed, true);
  });
});
