import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { watchdogTick } from '../scripts/phase32h-extreme-watchdog.mjs';
import { registerInflight, buildInflightRecord } from '../scripts/lib/phase32h-inflight-probe-registry.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-watchdog-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('phase32h extreme watchdog', () => {
  it('triggers diagnostic bundle after 60s while in-flight', () => {
    const probe = {
      probe_id: 11925,
      protocol_label: 'HTTP/2',
      matrix_protocol: 'h2',
      case_id: 'final_tagged_plan',
      window: 1,
      run: 1,
      user_class: 'real_participant',
      expected_gate_reason: 'preview_opt_in',
    };
    const record = buildInflightRecord(probe);
    record.monotonic_started_ms = Date.now() - 65_000;
    registerInflight(tmp, 'h2', record);
    const result = watchdogTick(tmp);
    assert.equal(result.inflight, 1);
    assert.equal(result.triggered.length, 1);
    const diagDir = fs.readdirSync(path.join(tmp, 'diagnostics')).find((d) => d.includes('11925'));
    assert.ok(diagDir);
    assert.ok(fs.existsSync(path.join(tmp, 'diagnostics', diagDir, 'trigger.json')));
    assert.ok(fs.existsSync(path.join(tmp, 'heartbeats', 'watchdog.jsonl')));
  });

  it('does not re-trigger the same probe', () => {
    const second = watchdogTick(tmp);
    assert.equal(second.triggered.length, 0);
  });
});
