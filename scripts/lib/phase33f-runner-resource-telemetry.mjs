/**
 * Phase 33F runner-process resource telemetry (bounded, redacted).
 * Host freemem/loadavg is NOT a substitute for these metrics.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const RUNNER_RESOURCE_TELEMETRY_VERSION = 'phase33f-runner-resource-v1';
export const RUNNER_RESOURCE_TELEMETRY_REL = path.join('telemetry', 'runner-resource-telemetry.jsonl');

export const RESOURCE_POLICY_VERSION = 'phase33f-resource-v1';

/** Hard stops for canary/target readiness. */
export const RESOURCE_HARD_LIMITS = Object.freeze({
  worker_active_max: 3,
  worker_final_max: 0,
  message_port_final_max: 0,
  listener_growth_per_100_batches_max: 5,
  listener_final_max_above_baseline: 2,
  active_handle_final_max_above_baseline: 4,
  worker_queue_depth_max: 64,
  // Sustained positive slope (MB per batch) over final half — block if exceeded.
  heap_slope_mb_per_batch_max: 0.75,
  rss_slope_mb_per_batch_max: 1.5,
});

function mb(bytes) {
  return Math.round((Number(bytes) || 0) / (1024 * 1024) * 1000) / 1000;
}

function countByPrefix(info, prefix) {
  if (!Array.isArray(info)) return 0;
  return info.filter((t) => String(t).startsWith(prefix)).length;
}

function inspectActiveResources() {
  // Prefer process.getActiveResourcesInfo when it returns data; fall back to
  // _getActiveHandles/_getActiveRequests (still available on Node 22 darwin).
  const info =
    typeof process.getActiveResourcesInfo === 'function' ? process.getActiveResourcesInfo() : [];
  if (Array.isArray(info) && info.length > 0) {
    return {
      active_handle_current: info.length,
      message_port_current: countByPrefix(info, 'MessagePort') + countByPrefix(info, 'Worker'),
      listener_current:
        countByPrefix(info, 'TCP') + countByPrefix(info, 'Pipe') + countByPrefix(info, 'TTY'),
      active_request_current:
        countByPrefix(info, 'HTTPClientRequest') + countByPrefix(info, 'HTTPParser'),
      source: 'getActiveResourcesInfo',
    };
  }
  const handles =
    typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
  const requests =
    typeof process._getActiveRequests === 'function' ? process._getActiveRequests() : [];
  let messagePorts = 0;
  let listeners = 0;
  for (const h of handles) {
    const name = h?.constructor?.name || '';
    if (name === 'MessagePort' || name === 'Worker') messagePorts += 1;
    if (name === 'Socket' || name === 'Server' || name === 'Pipe' || name === 'TTY') listeners += 1;
  }
  return {
    active_handle_current: handles.length,
    message_port_current: messagePorts,
    listener_current: listeners,
    active_request_current: requests.length,
    source: 'getActiveHandles',
  };
}

/**
 * Snapshot runner-local resource counters. Never includes prompts/tokens/PII.
 */
export function sampleRunnerResourceTelemetry({
  completedBatch = 0,
  probeTotal = 0,
  workerPool = null,
  queue = null,
  peaks = null,
  baseline = null,
} = {}) {
  const mem = process.memoryUsage();
  const active = inspectActiveResources();
  const workerConfigured = workerPool?.size ?? 0;
  const workerActive = workerPool?.busyCount ?? 0;
  const workerQueueDepth = workerPool?.queueDepth ?? 0;
  const poolPeakBusy = workerPool?.stats?.peakBusy ?? workerActive;
  const poolWorkers = workerPool?.workerCount ?? 0;
  // Floor message-port / handle counts with live worker-thread count when OS APIs under-count.
  const messagePortCurrent = Math.max(active.message_port_current, poolWorkers);
  const activeHandleCurrent = Math.max(active.active_handle_current, poolWorkers);
  const listenerCurrent = active.listener_current;
  const activeRequestCurrent = active.active_request_current;

  const nextPeaks = {
    worker_peak: Math.max(peaks?.worker_peak ?? 0, workerActive, poolPeakBusy),
    message_port_peak: Math.max(peaks?.message_port_peak ?? 0, messagePortCurrent),
    listener_peak: Math.max(peaks?.listener_peak ?? 0, listenerCurrent),
    active_handle_peak: Math.max(peaks?.active_handle_peak ?? 0, activeHandleCurrent),
    heap_used_peak_mb: Math.max(peaks?.heap_used_peak_mb ?? 0, mb(mem.heapUsed)),
    rss_peak_mb: Math.max(peaks?.rss_peak_mb ?? 0, mb(mem.rss)),
  };

  return {
    schema_version: RUNNER_RESOURCE_TELEMETRY_VERSION,
    timestamp: new Date().toISOString(),
    completed_batch: completedBatch,
    probe_total: probeTotal,
    rss_mb: mb(mem.rss),
    heap_used_mb: mb(mem.heapUsed),
    heap_total_mb: mb(mem.heapTotal),
    external_mb: mb(mem.external),
    array_buffers_mb: mb(mem.arrayBuffers || 0),
    worker_configured: workerConfigured,
    worker_active: workerActive,
    worker_peak: nextPeaks.worker_peak,
    message_port_current: messagePortCurrent,
    message_port_peak: nextPeaks.message_port_peak,
    listener_current: listenerCurrent,
    listener_peak: nextPeaks.listener_peak,
    active_handle_current: activeHandleCurrent,
    active_handle_peak: nextPeaks.active_handle_peak,
    active_request_current: activeRequestCurrent,
    worker_queue_depth: workerQueueDepth,
    queue_pending: queue?.pending_count ?? queue?.stats?.pending_count ?? 0,
    queue_running: queue?.running_count ?? queue?.stats?.running_count ?? 0,
    queue_complete: queue?.complete_count ?? queue?.stats?.complete_count ?? 0,
    queue_failed: queue?.failed_count ?? queue?.stats?.failed_count ?? 0,
    introspection_source: active.source,
    baseline: baseline
      ? {
          listeners: baseline.listeners ?? null,
          active_handles: baseline.active_handles ?? null,
          message_ports: baseline.message_ports ?? null,
        }
      : null,
    peaks: nextPeaks,
  };
}

export function appendRunnerResourceTelemetry(outRoot, sample) {
  if (!outRoot) {
    const err = new Error('runner resource telemetry requires outRoot');
    err.code = 'RUNNER_TELEMETRY_WRITE_FAIL';
    throw err;
  }
  const file = path.join(outRoot, RUNNER_RESOURCE_TELEMETRY_REL);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(sample)}\n`, 'utf8');
  } catch (err) {
    const e = new Error(`runner resource telemetry write failed: ${err.message}`);
    e.code = 'RUNNER_TELEMETRY_WRITE_FAIL';
    e.cause = err;
    throw e;
  }
  return file;
}

/**
 * Stream JSONL and retain only the last `limit` rows (bounded memory).
 */
export async function readRunnerResourceTelemetryTail(outRoot, { limit = 64 } = {}) {
  const file = path.join(outRoot, RUNNER_RESOURCE_TELEMETRY_REL);
  if (!fs.existsSync(file)) {
    return { status: 'ABSENT', path: file, rows: [], peaks: null, latest: null };
  }
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const ring = [];
  let lineNo = 0;
  let malformed = 0;
  let peaks = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    lineNo += 1;
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || !row.schema_version) {
        malformed += 1;
        continue;
      }
      ring.push(row);
      if (ring.length > limit) ring.shift();
      if (row.peaks) peaks = row.peaks;
    } catch {
      malformed += 1;
    }
  }
  if (malformed > 0 && ring.length === 0) {
    return { status: 'MALFORMED', path: file, rows: [], peaks: null, latest: null, malformed };
  }
  return {
    status: 'OK',
    path: file,
    rows: ring,
    peaks,
    latest: ring.length ? ring[ring.length - 1] : null,
    malformed,
    lines_seen: lineNo,
  };
}

function olsSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function theilSenSlope(xs, ys) {
  const slopes = [];
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const dx = xs[j] - xs[i];
      if (dx === 0) continue;
      slopes.push((ys[j] - ys[i]) / dx);
    }
  }
  if (!slopes.length) return 0;
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

export function evaluateResourcePolicy(samples, {
  limits = RESOURCE_HARD_LIMITS,
  workerFinal = null,
  messagePortFinal = null,
  listenerFinal = null,
  activeHandleFinal = null,
  baseline = null,
} = {}) {
  const violations = [];
  if (!samples?.length) {
    return { status: 'FAIL', code: 'RESOURCE_TELEMETRY_ABSENT', violations: ['no_samples'], limits };
  }

  for (const s of samples) {
    if (s.worker_active > limits.worker_active_max) {
      violations.push(`worker_active_overflow:${s.worker_active}`);
    }
    if (s.worker_queue_depth > limits.worker_queue_depth_max) {
      violations.push(`worker_queue_overflow:${s.worker_queue_depth}`);
    }
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const batches = Math.max(1, (last.completed_batch || 0) - (first.completed_batch || 0));
  const listenerGrowth = (last.listener_current || 0) - (first.listener_current || 0);
  const growthPer100 = (listenerGrowth / batches) * 100;
  // Require enough batches before treating listener delta as linear growth.
  if (batches >= 20 && growthPer100 > limits.listener_growth_per_100_batches_max) {
    violations.push(`listener_linear_growth:${growthPer100.toFixed(3)}`);
  }

  const half = samples.slice(Math.floor(samples.length / 2));
  const xs = half.map((s) => s.completed_batch || 0);
  const heapYs = half.map((s) => s.heap_used_mb || 0);
  const rssYs = half.map((s) => s.rss_mb || 0);
  const heapSlope = olsSlope(xs, heapYs);
  const rssSlope = olsSlope(xs, rssYs);
  const heapTs = theilSenSlope(xs, heapYs);
  const rssTs = theilSenSlope(xs, rssYs);
  if (half.length >= 10 && heapSlope > limits.heap_slope_mb_per_batch_max) {
    violations.push(`heap_slope:${heapSlope}`);
  }
  if (half.length >= 10 && rssSlope > limits.rss_slope_mb_per_batch_max) {
    violations.push(`rss_slope:${rssSlope}`);
  }

  if (workerFinal != null && workerFinal > limits.worker_final_max) {
    violations.push(`worker_final:${workerFinal}`);
  }
  const baseListeners = baseline?.listeners ?? first.listener_current ?? 0;
  const baseHandles = baseline?.active_handles ?? first.active_handle_current ?? 0;
  const baseMessagePorts = baseline?.message_ports ?? first.message_port_current ?? 0;
  if (messagePortFinal != null && messagePortFinal - baseMessagePorts > limits.message_port_final_max) {
    // message_port_final_max is max allowed delta above baseline after shutdown.
    violations.push(`message_port_final_delta:${messagePortFinal - baseMessagePorts}`);
  }
  if (listenerFinal != null && listenerFinal - baseListeners > limits.listener_final_max_above_baseline) {
    violations.push(`listener_final_delta:${listenerFinal - baseListeners}`);
  }
  if (
    activeHandleFinal != null &&
    activeHandleFinal - baseHandles > limits.active_handle_final_max_above_baseline
  ) {
    violations.push(`active_handle_final_delta:${activeHandleFinal - baseHandles}`);
  }

  return {
    status: violations.length ? 'FAIL' : 'PASS',
    code: violations.length ? 'RESOURCE_POLICY_BLOCKED' : 'RESOURCE_POLICY_PASS',
    violations: [...new Set(violations)],
    limits,
    slopes: {
      heap_ols_mb_per_batch: heapSlope,
      rss_ols_mb_per_batch: rssSlope,
      heap_theil_sen_mb_per_batch: heapTs,
      rss_theil_sen_mb_per_batch: rssTs,
    },
    peaks: last.peaks || null,
    latest: last,
  };
}

export function projectResourceToBatch(samples, targetBatch, { z = 1.645 } = {}) {
  if (!samples?.length) return null;
  const half = samples.slice(Math.floor(samples.length / 2));
  const xs = half.map((s) => s.completed_batch || 0);
  const heapYs = half.map((s) => s.heap_used_mb || 0);
  const rssYs = half.map((s) => s.rss_mb || 0);
  const heapSlope = olsSlope(xs, heapYs);
  const rssSlope = olsSlope(xs, rssYs);
  const last = samples[samples.length - 1];
  const dx = targetBatch - (last.completed_batch || 0);
  const heapProj = (last.heap_used_mb || 0) + heapSlope * dx;
  const rssProj = (last.rss_mb || 0) + rssSlope * dx;
  // Crude residual SE for UCB
  const heapResid = half.map((s, i) => heapYs[i] - ((half[0].heap_used_mb || 0) + heapSlope * (xs[i] - xs[0])));
  const rssResid = half.map((s, i) => rssYs[i] - ((half[0].rss_mb || 0) + rssSlope * (xs[i] - xs[0])));
  const heapSe = Math.sqrt(heapResid.reduce((a, b) => a + b * b, 0) / Math.max(1, heapResid.length - 2));
  const rssSe = Math.sqrt(rssResid.reduce((a, b) => a + b * b, 0) / Math.max(1, rssResid.length - 2));
  return {
    target_batch: targetBatch,
    projected_heap_mb: heapProj,
    projected_rss_mb: rssProj,
    heap_95_ucb_mb: heapProj + z * heapSe,
    rss_95_ucb_mb: rssProj + z * rssSe,
    heap_slope_mb_per_batch: heapSlope,
    rss_slope_mb_per_batch: rssSlope,
  };
}
