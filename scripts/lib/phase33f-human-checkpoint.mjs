/**
 * Bounded foreground progress checkpoints for long Phase 33F/34 gauntlet runs.
 * These are stdout-only and never write to the evidence root.
 */

export const DEFAULT_CHECKPOINT_BATCH_INTERVAL = 500;
export const DEFAULT_CHECKPOINT_TIME_INTERVAL_MS = 10 * 60 * 1000;

export function shouldEmitHumanCheckpoint({
  completed,
  lastCompleted,
  nowMs,
  lastAtMs,
  batchInterval = DEFAULT_CHECKPOINT_BATCH_INTERVAL,
  timeIntervalMs = DEFAULT_CHECKPOINT_TIME_INTERVAL_MS,
} = {}) {
  if (!Number.isFinite(completed) || completed <= 0) return false;
  if ((completed || 0) - (lastCompleted || 0) >= batchInterval) return true;
  return Number.isFinite(nowMs) && Number.isFinite(lastAtMs) && nowMs - lastAtMs >= timeIntervalMs;
}

export function formatHumanCheckpointLine({
  status,
  completed,
  target,
  failed,
  startedAtMs,
  nowMs,
  previousCompleted,
  previousAtMs,
  queue = null,
} = {}) {
  const elapsedMinutes = Math.max((nowMs - startedAtMs) / 60000, 0);
  const intervalMinutes = Math.max((nowMs - previousAtMs) / 60000, 0);
  const intervalCompleted = Math.max((completed || 0) - (previousCompleted || 0), 0);
  const sessionsPerMinute =
    intervalMinutes > 0 ? Number((intervalCompleted / intervalMinutes).toFixed(3)) : null;
  const overallSessionsPerMinute =
    elapsedMinutes > 0 ? Number(((completed || 0) / elapsedMinutes).toFixed(3)) : null;
  const remaining = Math.max((target || 0) - (completed || 0), 0);
  const etaMinutes =
    sessionsPerMinute && sessionsPerMinute > 0
      ? Number((remaining / sessionsPerMinute).toFixed(1))
      : null;

  return `PHASE34_CHECKPOINT ${JSON.stringify({
    timestamp: new Date(nowMs).toISOString(),
    status,
    completed,
    target,
    percent: target ? Number(((completed / target) * 100).toFixed(3)) : null,
    interval_completed: intervalCompleted,
    sessions_per_minute: sessionsPerMinute,
    overall_sessions_per_minute: overallSessionsPerMinute,
    eta_minutes: etaMinutes,
    failed,
    queue_pending: queue?.pending_count ?? null,
    queue_running: queue?.running_count ?? null,
    queue_complete: queue?.complete_count ?? null,
    queue_failed: queue?.failed_count ?? null,
  })}`;
}

export function summarizeRunnerResult(result = null) {
  if (!result) return null;
  return {
    status: result.status,
    mode: result.mode,
    batches: result.batches,
    probes: result.probes,
    ok_count: result.ok_count,
    fail_count: result.fail_count,
    stopped_for_rate_limit: result.stopped_for_rate_limit,
    stopped_for_resource: result.stopped_for_resource,
    failure_class: result.failure_class || null,
    inter_batch_interval_ms: result.inter_batch_interval_ms,
    http_429: result.http_429 ?? null,
    queue: result.queue
      ? {
          pending_count: result.queue.pending_count,
          running_count: result.queue.running_count,
          complete_count: result.queue.complete_count,
          failed_count: result.queue.failed_count,
        }
      : null,
    resource_policy: result.resource_policy
      ? {
          status: result.resource_policy.status,
          code: result.resource_policy.code || null,
        }
      : null,
    resource_final: result.resource_final || null,
    resource_peaks: result.resource_peaks || null,
  };
}
