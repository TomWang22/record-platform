/**
 * Phase 33F capability probe worker — true parallel H1/H2/H3 curls.
 * Pool protocol matches phase32h-worker-pool (type: 'job').
 */
import { parentPort, workerData } from 'node:worker_threads';
import { issueCapabilityProbe } from './phase33f-capability-probe.mjs';

function waitUntilRelease(releaseAtMs) {
  while (Date.now() < releaseAtMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
  }
}

function runOne(payload) {
  const { row, releaseAtMs, baseUrl, caCert, curlResolve, token, userId } = payload;
  waitUntilRelease(releaseAtMs);
  const result = issueCapabilityProbe(row, {
    baseUrl,
    caCert,
    curlResolve,
    token,
    userId,
  });
  return { ok: true, result };
}

const poolMode = Boolean(workerData?.pool);

if (poolMode) {
  parentPort.on('message', async (msg) => {
    if (!msg || msg.type !== 'job') return;
    try {
      parentPort.postMessage(runOne(msg.payload));
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
    parentPort.postMessage(runOne(workerData));
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: err.message,
      stack: err.stack,
    });
  }
}
