/**
 * Phase 32H-R1 — worker thread: execute one matrix probe after barrier release.
 * Supports pool mode (message jobs) and legacy one-shot workerData mode.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { executeProbe } from '../phase31-controlled-observability-matrix-runner.mjs';
import { login } from './phase22-full-replay-common.mjs';

function waitUntilRelease(releaseAtMs) {
  while (Date.now() < releaseAtMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
  }
}

async function runOne({ probe, cfg, releaseAtMs, probeContext }) {
  waitUntilRelease(releaseAtMs);
  const started_at = new Date().toISOString();
  const started_epoch = Date.now() / 1000;
  const token = login(probe.user_email, cfg);
  const getToken = () => token;
  const { row, probeFail, failureClass } = executeProbe(probe, cfg, getToken, probeContext || {});
  return {
    ok: true,
    protocol: probe.matrix_protocol,
    started_at,
    started_epoch,
    finished_epoch: Date.now() / 1000,
    row,
    probeFail,
    failureClass,
  };
}

const poolMode = Boolean(workerData?.pool);

if (poolMode) {
  parentPort.on('message', async (msg) => {
    if (!msg || msg.type !== 'job') return;
    try {
      const result = await runOne(msg.payload);
      parentPort.postMessage(result);
    } catch (err) {
      parentPort.postMessage({
        ok: false,
        error: err.message,
        stack: err.stack,
      });
    }
  });
} else {
  try {
    const result = await runOne(workerData);
    parentPort.postMessage(result);
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      protocol: workerData?.probe?.matrix_protocol,
      error: err.message,
      stack: err.stack,
    });
  }
}
