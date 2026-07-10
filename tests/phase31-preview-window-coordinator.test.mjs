#!/usr/bin/env node
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PreviewWindowCoordinator,
  defaultCoordinatorState,
} from '../scripts/lib/phase31-preview-window-coordinator.mjs';

function tempMatrixRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase31-coord-'));
}

describe('phase31 preview window coordinator', () => {
  /** @type {string} */
  let matrixRoot;

  beforeEach(() => {
    matrixRoot = tempMatrixRoot();
  });

  afterEach(() => {
    fs.rmSync(matrixRoot, { recursive: true, force: true });
  });

  it('performs single reset per window across h1/h2/h3', () => {
    const coordinator = new PreviewWindowCoordinator(matrixRoot, { pollMs: 5, waitTimeoutMs: 5000 });
    let resetCalls = 0;
    const resetAndVerify = () => {
      resetCalls += 1;
      return { ok: true, failures: [] };
    };

    coordinator.enterWindow(1, 'h1', { resetAndVerify });
    coordinator.completeWindowProtocol(1, 'h1');
    coordinator.enterWindow(1, 'h2', { resetAndVerify });
    coordinator.completeWindowProtocol(1, 'h2');
    coordinator.enterWindow(1, 'h3', { resetAndVerify });
    coordinator.completeWindowProtocol(1, 'h3');

    assert.equal(resetCalls, 1);
    assert.equal(coordinator.getResetCount(1), 1);
    assert.equal(coordinator.windowComplete(1), true);
  });

  it('blocks h2 from window 2 until all protocols complete window 1', () => {
    const coordinator = new PreviewWindowCoordinator(matrixRoot, { pollMs: 5, waitTimeoutMs: 200 });
    const resetAndVerify = () => ({ ok: true, failures: [] });

    coordinator.enterWindow(1, 'h1', { resetAndVerify });
    coordinator.completeWindowProtocol(1, 'h1');
    coordinator.enterWindow(1, 'h2', { resetAndVerify });
    coordinator.completeWindowProtocol(1, 'h2');

    assert.throws(() => coordinator.enterWindow(2, 'h3', { resetAndVerify }), /coordinator wait timeout/);

    coordinator.enterWindow(1, 'h3', { resetAndVerify });
    coordinator.completeWindowProtocol(1, 'h3');
    coordinator.enterWindow(2, 'h3', { resetAndVerify });
    assert.equal(coordinator.getWindowStatus(2).started_protocols.includes('h3'), true);
  });

  it('blocks h3 window N+1 until h1 and h2 complete window N', () => {
    const coordinator = new PreviewWindowCoordinator(matrixRoot, { pollMs: 5, waitTimeoutMs: 200 });
    const resetAndVerify = () => ({ ok: true, failures: [] });

    for (let window = 1; window <= 3; window += 1) {
      for (const proto of ['h1', 'h2', 'h3']) {
        coordinator.enterWindow(window, proto, { resetAndVerify });
        coordinator.completeWindowProtocol(window, proto);
      }
    }

    coordinator.enterWindow(4, 'h1', { resetAndVerify });
    coordinator.completeWindowProtocol(4, 'h1');
    coordinator.enterWindow(4, 'h2', { resetAndVerify });
    coordinator.completeWindowProtocol(4, 'h2');

    assert.throws(() => coordinator.enterWindow(5, 'h3', { resetAndVerify }), /coordinator wait timeout/);

    coordinator.enterWindow(4, 'h3', { resetAndVerify });
    coordinator.completeWindowProtocol(4, 'h3');
    coordinator.enterWindow(5, 'h3', { resetAndVerify });
    assert.equal(coordinator.getWindowStatus(5).started_protocols.includes('h3'), true);
  });

  it('recovers stale lock safely', () => {
    const coordinator = new PreviewWindowCoordinator(matrixRoot, {
      pollMs: 5,
      waitTimeoutMs: 3000,
      staleLockMs: 1,
    });
    fs.mkdirSync(coordinator.lockDir, { recursive: true });
    fs.writeFileSync(
      coordinator.lockMetaPath,
      `${JSON.stringify({ pid: 999999, acquired_at: new Date(Date.now() - 60_000).toISOString() })}\n`,
      'utf8',
    );

    coordinator.withLock(() => {
      assert.ok(fs.existsSync(coordinator.lockDir));
    });
    assert.equal(fs.existsSync(coordinator.lockDir), false);
  });

  it('blocks probes when gate verification fails', () => {
    const coordinator = new PreviewWindowCoordinator(matrixRoot, { pollMs: 5, waitTimeoutMs: 3000 });
    try {
      coordinator.enterWindow(1, 'h1', {
        resetAndVerify: () => ({
          ok: false,
          failures: [{ expected_gate_reason: 'preview_opt_in', observed_gate_reason: 'keyword_default' }],
        }),
      });
      assert.fail('expected gate verification failure');
    } catch (err) {
      assert.match(err.message, /preview gate verification failed/);
      assert.equal(err.code, 'PHASE31_GATE_VERIFY_BLOCKED');
    }
    assert.equal(coordinator.getWindowStatus(1).gate_verified, false);
  });

  it('uses windowSequence for non-consecutive targeted replay windows', () => {
    const coordinator = new PreviewWindowCoordinator(matrixRoot, {
      pollMs: 5,
      waitTimeoutMs: 3000,
      windowSequence: [3, 4, 5, 16],
      expectedProtocols: ['h1'],
    });
    const resetAndVerify = () => ({ ok: true, failures: [] });
    coordinator.enterWindow(3, 'h1', { resetAndVerify });
    coordinator.completeWindowProtocol(3, 'h1');
    coordinator.enterWindow(4, 'h1', { resetAndVerify });
    assert.equal(coordinator.getResetCount(3), 1);
    assert.equal(coordinator.getResetCount(4), 1);
  });

  it('persists redacted coordinator state shape', () => {
    const coordinator = new PreviewWindowCoordinator(matrixRoot, { pollMs: 5, waitTimeoutMs: 3000 });
    for (const proto of ['h1', 'h2', 'h3']) {
      coordinator.enterWindow(1, proto, { resetAndVerify: () => ({ ok: true, failures: [] }) });
      coordinator.completeWindowProtocol(1, proto);
    }
    coordinator.enterWindow(2, 'h1', { resetAndVerify: () => ({ ok: true, failures: [] }) });
    const state = coordinator.readState();
    assert.equal(state.matrix_id, 'phase31');
    assert.deepEqual(state.expected_protocols, ['h1', 'h2', 'h3']);
    assert.equal(state.window_status['2'].lifecycle_reset_done, true);
    assert.equal(state.window_status['2'].gate_verified, true);
    assert.ok(state.window_status['2'].updated_at);
    assert.equal(defaultCoordinatorState().active_window, 0);
  });
});
