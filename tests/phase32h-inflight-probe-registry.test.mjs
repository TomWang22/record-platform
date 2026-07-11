import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  Phase32hInflightRegistryError,
  assertRedactedInflightRecord,
  buildInflightRecord,
  completeInflight,
  elapsedMs,
  inflightPath,
  registerInflight,
  readAllInflight,
} from '../scripts/lib/phase32h-inflight-probe-registry.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-inflight-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('phase32h inflight probe registry', () => {
  const probe = {
    probe_id: 42,
    protocol_label: 'HTTP/2',
    matrix_protocol: 'h2',
    case_id: 'final_tagged_plan',
    window: 1,
    run: 1,
    user_class: 'contract_control',
    expected_gate_reason: 'allowlist',
  };

  it('rejects forbidden private fields', () => {
    assert.throws(
      () => assertRedactedInflightRecord({ probe_id: 1, jwt: 'eyJabc' }),
      Phase32hInflightRegistryError,
    );
  });

  it('registers and completes atomically', () => {
    const record = buildInflightRecord(probe, { runnerPid: 999 });
    registerInflight(tmp, 'h2', record);
    assert.ok(fs.existsSync(inflightPath(tmp, 'h2')));
    const completed = completeInflight(tmp, 'h2');
    assert.equal(completed.completed.status, 'completed');
    assert.equal(readAllInflight(tmp).length, 0);
    assert.ok(fs.existsSync(completed.archivePath));
  });

  it('computes elapsed ms from monotonic start', () => {
    const record = { monotonic_started_ms: Date.now() - 61_000 };
    assert.ok(elapsedMs(record) >= 60_000);
  });
});
