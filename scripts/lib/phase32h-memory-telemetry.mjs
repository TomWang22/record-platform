/**
 * Phase 32H — redacted bounded memory telemetry samples.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export const MEMORY_TELEMETRY_BATCH_INTERVAL = Number(
  process.env.PHASE32H_MEMORY_TELEMETRY_BATCH_INTERVAL || 5,
);
export const MEMORY_TELEMETRY_TIME_INTERVAL_MS = Number(
  process.env.PHASE32H_MEMORY_TELEMETRY_TIME_MS || 10_000,
);

function activeHandles() {
  return typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
}

function activeRequests() {
  return typeof process._getActiveRequests === 'function' ? process._getActiveRequests() : [];
}

export function countMessagePorts(handles = activeHandles()) {
  let n = 0;
  for (const h of handles) {
    if (!h) continue;
    if (h.constructor?.name === 'MessagePort') n += 1;
  }
  return n;
}

export function countListenerTargets(handles = activeHandles()) {
  let n = 0;
  for (const h of handles) {
    if (!h || typeof h.eventNames !== 'function' || typeof h.listenerCount !== 'function') continue;
    try {
      for (const ev of h.eventNames()) {
        n += h.listenerCount(ev);
      }
    } catch {
      // ignore exotic handle types
    }
  }
  // Also count process-level listeners (signals etc).
  if (typeof process.eventNames === 'function') {
    for (const ev of process.eventNames()) {
      n += process.listenerCount(ev);
    }
  }
  return n;
}

export function sampleMemoryTelemetry(extra = {}) {
  const mu = process.memoryUsage();
  const handles = activeHandles();
  const requests = activeRequests();
  const completed = extra.completed_batch ?? extra.batch_complete ?? 0;
  return {
    timestamp: new Date().toISOString(),
    completed_batch: completed,
    batch_complete: completed,
    probe_total: extra.probe_total ?? 0,
    rss_mb: Number((mu.rss / (1024 * 1024)).toFixed(2)),
    heap_used_mb: Number((mu.heapUsed / (1024 * 1024)).toFixed(2)),
    heap_total_mb: Number((mu.heapTotal / (1024 * 1024)).toFixed(2)),
    external_mb: Number((mu.external / (1024 * 1024)).toFixed(2)),
    array_buffers_mb: Number(((mu.arrayBuffers || 0) / (1024 * 1024)).toFixed(2)),
    active_handles: handles.length,
    active_requests: requests.length,
    worker_count: extra.worker_count ?? 0,
    message_port_count: extra.message_port_count ?? countMessagePorts(handles),
    listener_count: extra.listener_count ?? countListenerTargets(handles),
    worker_queue_depth: extra.worker_queue_depth ?? 0,
    correlation_pending: extra.correlation_pending ?? extra.queue_pending ?? 0,
    correlation_running: extra.correlation_running ?? extra.queue_running ?? 0,
    correlation_complete_total:
      extra.correlation_complete_total ?? extra.queue_complete_total ?? 0,
    // Keep legacy aliases for older report consumers.
    queue_pending: extra.correlation_pending ?? extra.queue_pending ?? 0,
    queue_running: extra.correlation_running ?? extra.queue_running ?? 0,
    queue_complete_total: extra.correlation_complete_total ?? extra.queue_complete_total ?? 0,
  };
}

export function appendMemoryTelemetry(outRoot, sample, { fileName = 'memory-telemetry.jsonl' } = {}) {
  const dir = path.join(outRoot, 'run-state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  fs.appendFileSync(file, `${JSON.stringify(sample)}\n`, 'utf8');
  return file;
}

/**
 * Decide whether to emit a sample for denser memory smoke contracts.
 * Prefers every N completed batches; also emits on wall-clock interval.
 */
export function shouldSampleMemoryTelemetry(completedBatches, {
  lastSampleAtMs = 0,
  batchInterval = MEMORY_TELEMETRY_BATCH_INTERVAL,
  timeIntervalMs = MEMORY_TELEMETRY_TIME_INTERVAL_MS,
  nowMs = Date.now(),
  force = false,
} = {}) {
  if (force) return true;
  if (completedBatches > 0 && completedBatches % batchInterval === 0) return true;
  if (lastSampleAtMs > 0 && nowMs - lastSampleAtMs >= timeIntervalMs) return true;
  return false;
}

// Silence unused import lint in environments that tree-shake EventEmitter usage.
void EventEmitter;
