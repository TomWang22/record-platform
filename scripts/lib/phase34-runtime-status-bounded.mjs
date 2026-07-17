/**
 * Bounded Phase 34 / 33F matrix counters and acceptance classification helpers.
 * Never loads an entire matrix into memory for monitor polls.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

/**
 * Stream matrix JSONL shards and accumulate bounded counters.
 * @param {string} outRoot
 */
export async function streamMatrixCounters(outRoot) {
  const counts = {
    h1: 0,
    h2: 0,
    h3: 0,
    ok: 0,
    fail: 0,
    http_0: 0,
    http_422: 0,
    http_429: 0,
    http_5xx: 0,
    curl_failures: 0,
    logical_batches: new Set(),
    logical_fail_batches: new Set(),
    capabilities: Object.create(null),
  };
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase33f-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        counts.fail += 1;
        continue;
      }
      counts[shard] += 1;
      if (row.ok) counts.ok += 1;
      else counts.fail += 1;
      const status = Number(row.http_status);
      if (status === 0 || row.http_status == null) counts.http_0 += 1;
      else if (status === 422) counts.http_422 += 1;
      else if (status === 429) counts.http_429 += 1;
      else if (Number.isFinite(status) && status >= 500) counts.http_5xx += 1;
      if (String(row.error_class || '').startsWith('curl') || row.error_class === 'curl_failed') {
        counts.curl_failures += 1;
      }
      const batchId = row.batch_id || null;
      if (batchId) {
        counts.logical_batches.add(batchId);
        if (!row.ok) counts.logical_fail_batches.add(batchId);
        const cap = row.capability || 'unknown';
        counts.capabilities[cap] = (counts.capabilities[cap] || 0) + (shard === 'h1' ? 1 : 0);
      }
    }
  }
  const logicalComplete = counts.logical_batches.size;
  const logicalFail = counts.logical_fail_batches.size;
  return {
    h1: counts.h1,
    h2: counts.h2,
    h3: counts.h3,
    ok: counts.ok,
    fail: counts.fail,
    total: counts.h1 + counts.h2 + counts.h3,
    http_0: counts.http_0,
    http_422: counts.http_422,
    http_429: counts.http_429,
    http_5xx: counts.http_5xx,
    curl_failures: counts.curl_failures,
    logical_complete: logicalComplete,
    logical_pass: Math.max(0, logicalComplete - logicalFail),
    logical_fail: logicalFail,
    capability_logical: { ...counts.capabilities },
  };
}

/**
 * Sessions-per-minute from two monotonic snapshots.
 * Rejects zero/negative duration, reversed time, and counter resets.
 */
export function computeSessionsPerMinute({
  previousComplete,
  currentComplete,
  previousAtMs,
  currentAtMs,
} = {}) {
  if (![previousComplete, currentComplete, previousAtMs, currentAtMs].every(Number.isFinite)) {
    return { status: 'REJECTED', reason: 'non_finite_inputs', sessions_per_minute: null };
  }
  if (currentAtMs <= previousAtMs) {
    return { status: 'REJECTED', reason: 'non_positive_or_reversed_interval', sessions_per_minute: null };
  }
  if (currentComplete < previousComplete) {
    return { status: 'REJECTED', reason: 'counter_reset', sessions_per_minute: null };
  }
  const elapsedMs = currentAtMs - previousAtMs;
  if (elapsedMs < 1000) {
    return { status: 'REJECTED', reason: 'interval_too_short', sessions_per_minute: null };
  }
  const gained = currentComplete - previousComplete;
  const sessionsPerMinute = (gained / elapsedMs) * 60_000;
  if (!Number.isFinite(sessionsPerMinute) || sessionsPerMinute < 0 || sessionsPerMinute > 10_000) {
    return { status: 'REJECTED', reason: 'impossible_rate', sessions_per_minute: null };
  }
  return {
    status: 'OK',
    sessions_per_minute: Number(sessionsPerMinute.toFixed(2)),
    gained,
    elapsed_ms: elapsedMs,
  };
}

/**
 * Separate execution progress from irreversible acceptance.
 */
export function classifyRuntimeAcceptance({
  frozenPass = false,
  frozenBlocked = false,
  protocolFail = 0,
  logicalFail = 0,
  liveBlockMarker = false,
  queueCompleteIncreasing = false,
  runnerAlive = false,
} = {}) {
  let execution_state = 'STOPPED';
  if (frozenPass || frozenBlocked) execution_state = 'FROZEN';
  else if (queueCompleteIncreasing && runnerAlive) execution_state = 'ADVANCING';
  else if (runnerAlive) execution_state = 'IDLE';

  let acceptance_state = 'PASS_POSSIBLE';
  if (frozenPass) acceptance_state = 'TERMINAL_PASS';
  else if (frozenBlocked) acceptance_state = 'TERMINAL_BLOCKED';
  else if (liveBlockMarker || protocolFail > 0 || logicalFail > 0) acceptance_state = 'BLOCKED';

  return {
    execution_state,
    acceptance_state,
    cooperative_termination_required:
      acceptance_state === 'BLOCKED' &&
      (execution_state === 'ADVANCING' || execution_state === 'IDLE'),
  };
}
