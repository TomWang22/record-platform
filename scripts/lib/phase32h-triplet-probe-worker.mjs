/**
 * Phase 32H-R1 — worker thread: execute one matrix probe after barrier release.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { executeProbe } from '../phase31-controlled-observability-matrix-runner.mjs';
import { login } from './phase22-full-replay-common.mjs';

const { probe, cfg, releaseAtMs, probeContext } = workerData;

function waitUntilRelease() {
  while (Date.now() < releaseAtMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
  }
}

try {
  waitUntilRelease();
  const started_at = new Date().toISOString();
  const started_epoch = Date.now() / 1000;
  const token = login(probe.user_email, cfg);
  const getToken = () => token;
  const { row, probeFail, failureClass } = executeProbe(probe, cfg, getToken, probeContext);
  parentPort.postMessage({
    ok: true,
    protocol: probe.matrix_protocol,
    started_at,
    started_epoch,
    finished_epoch: Date.now() / 1000,
    row,
    probeFail,
    failureClass,
  });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    protocol: probe.matrix_protocol,
    error: err.message,
    stack: err.stack,
  });
}
