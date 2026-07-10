/**
 * Phase 32C/32F — timing attribution helpers for matrix probe JSONL rows.
 */
import { FORBIDDEN_FIELDS as MATRIX_FORBIDDEN_FIELDS } from './phase31-controlled-matrix-summary.mjs';

export const TIMING_FIELDS = [
  'probe_started_at',
  'probe_finished_at',
  'wall_total_ms',
  'curl_time_total_ms',
  'rag_total_ms',
  'coordinator_wait_ms',
  'window_reset_ms',
  'pre_probe_gate_verify_ms',
  'retry_count',
  'retry_delay_ms',
  'kpi_query_write_ms',
  'kpi_usefulness_write_ms',
  'jsonl_write_ms',
  'unattributed_ms',
];

export const STALL_CAPTURE_FIELDS = [
  'event_loop_delay_ms',
  'process_cpu_user_ms',
  'process_cpu_system_ms',
  'rss_mb',
  'coordinator_lock_wait_ms',
  'coordinator_stale_lock_recovered',
  'coordinator_lock_owner_protocol',
  'coordinator_lock_owner_pid',
  'child_process_spawn_ms',
  'curl_exit_code',
  'curl_error_class',
  'curl_time_namelookup_ms',
  'curl_time_connect_ms',
  'curl_time_appconnect_ms',
  'curl_time_pretransfer_ms',
  'curl_time_starttransfer_ms',
  'server_timing_rag_total_ms',
  'server_timing_retrieval_total_ms',
  'server_timing_kpi_query_write_ms',
  'jsonl_flush_ms',
  'probe_gap_since_previous_ms',
  'shard_restart_count',
];

export const ALL_TIMING_FIELDS = [...TIMING_FIELDS, ...STALL_CAPTURE_FIELDS];

export const KNOWN_TIMING_MS_FIELDS = [
  'coordinator_wait_ms',
  'window_reset_ms',
  'pre_probe_gate_verify_ms',
  'curl_time_total_ms',
  'retry_delay_ms',
  'kpi_query_write_ms',
  'kpi_usefulness_write_ms',
  'jsonl_write_ms',
];

export const FORBIDDEN_PROBE_FIELDS = [
  ...MATRIX_FORBIDDEN_FIELDS,
  'question',
  'user_email',
  'user_uid',
  'summary',
  'answer',
  'response',
  'text',
  'message',
  'raw_prompt',
  'prompt',
];

export class Phase32TimingAttributionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase32TimingAttributionError';
  }
}

function parseIsoMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function roundMs(value) {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10) / 10;
}

export function extractAppRagTotalMs(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.rag_total_ms,
    body.details?.rag_total_ms,
    body.details?.server_total_ms,
    body.details?.hybrid_canary?.rag_total_ms,
    body.details?.server_timing?.rag_total_ms,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return roundMs(num);
  }
  return null;
}

export function extractServerTimingFromBody(body) {
  if (!body || typeof body !== 'object') return {};
  const details = body.details || {};
  const pick = (key) => {
    const num = Number(details[key]);
    return Number.isFinite(num) && num >= 0 ? roundMs(num) : null;
  };
  const rag = extractAppRagTotalMs(body);
  return {
    rag_total_ms: rag,
    server_total_ms: pick('server_total_ms'),
    retrieval_total_ms: pick('retrieval_total_ms'),
    kpi_query_write_ms: pick('kpi_query_write_ms'),
    kpi_usefulness_write_ms: pick('kpi_usefulness_write_ms'),
    server_timing_rag_total_ms: rag,
    server_timing_retrieval_total_ms: pick('retrieval_total_ms'),
    server_timing_kpi_query_write_ms: pick('kpi_query_write_ms'),
  };
}

export function mergeStallCaptureFields(timing, stall = {}) {
  const merged = { ...timing };
  for (const field of STALL_CAPTURE_FIELDS) {
    if (field === 'coordinator_stale_lock_recovered') {
      merged[field] = stall[field] === true;
      continue;
    }
    if (field === 'coordinator_lock_owner_protocol') {
      merged[field] = stall[field] ?? null;
      continue;
    }
    if (field === 'curl_error_class') {
      merged[field] = stall[field] ?? null;
      continue;
    }
    if (field === 'shard_restart_count' || field === 'coordinator_lock_owner_pid' || field === 'curl_exit_code') {
      const num = stall[field];
      merged[field] = Number.isFinite(Number(num)) ? Number(num) : null;
      continue;
    }
    merged[field] = roundMs(stall[field]);
  }
  return merged;
}

export function computeWallTotalMs(probeStartedAt, probeFinishedAt) {
  const start = parseIsoMs(probeStartedAt);
  const end = parseIsoMs(probeFinishedAt);
  if (start == null || end == null) return null;
  return roundMs(end - start);
}

export function computeKnownMs(timing) {
  return KNOWN_TIMING_MS_FIELDS.reduce((sum, field) => {
    const value = timing?.[field];
    if (value == null) return sum;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      throw new Phase32TimingAttributionError(`invalid timing field ${field}: ${value}`);
    }
    return sum + num;
  }, 0);
}

export function computeUnattributedMs(timing) {
  const wall = timing?.wall_total_ms;
  if (wall == null) return null;
  const wallNum = Number(wall);
  if (!Number.isFinite(wallNum) || wallNum < 0) {
    throw new Phase32TimingAttributionError(`invalid wall_total_ms: ${wall}`);
  }
  const known = computeKnownMs(timing);
  return roundMs(Math.max(0, wallNum - known));
}

export function buildTimingAttribution(input = {}) {
  const timing = {
    probe_started_at: input.probe_started_at ?? null,
    probe_finished_at: input.probe_finished_at ?? null,
    wall_total_ms:
      input.wall_total_ms ??
      computeWallTotalMs(input.probe_started_at, input.probe_finished_at),
    curl_time_total_ms: roundMs(input.curl_time_total_ms),
    rag_total_ms: roundMs(input.rag_total_ms),
    coordinator_wait_ms: roundMs(input.coordinator_wait_ms ?? 0),
    window_reset_ms: roundMs(input.window_reset_ms ?? 0),
    pre_probe_gate_verify_ms: roundMs(input.pre_probe_gate_verify_ms ?? 0),
    retry_count: Number.isFinite(Number(input.retry_count)) ? Number(input.retry_count) : 0,
    retry_delay_ms: roundMs(input.retry_delay_ms ?? 0),
    kpi_query_write_ms: roundMs(input.kpi_query_write_ms ?? 0),
    kpi_usefulness_write_ms: roundMs(input.kpi_usefulness_write_ms ?? 0),
    jsonl_write_ms: roundMs(input.jsonl_write_ms ?? 0),
    unattributed_ms: null,
  };

  for (const field of [
    'coordinator_wait_ms',
    'window_reset_ms',
    'pre_probe_gate_verify_ms',
    'retry_delay_ms',
    'kpi_query_write_ms',
    'kpi_usefulness_write_ms',
    'jsonl_write_ms',
  ]) {
    const value = timing[field];
    if (value != null && value < 0) {
      throw new Phase32TimingAttributionError(`negative timing field ${field}: ${value}`);
    }
  }
  if (timing.retry_count < 0) {
    throw new Phase32TimingAttributionError(`negative retry_count: ${timing.retry_count}`);
  }
  if (timing.curl_time_total_ms != null && timing.curl_time_total_ms < 0) {
    throw new Phase32TimingAttributionError(`negative curl_time_total_ms: ${timing.curl_time_total_ms}`);
  }
  if (timing.rag_total_ms != null && timing.rag_total_ms < 0) {
    throw new Phase32TimingAttributionError(`negative rag_total_ms: ${timing.rag_total_ms}`);
  }

  timing.unattributed_ms = computeUnattributedMs(timing);
  return mergeStallCaptureFields(timing, input.stall || input);
}

export function buildStallCaptureSnapshot(input = {}) {
  const stall = {};
  for (const field of STALL_CAPTURE_FIELDS) {
    if (field in input) stall[field] = input[field];
  }
  return mergeStallCaptureFields(
    {
      probe_started_at: null,
      probe_finished_at: null,
      wall_total_ms: null,
      curl_time_total_ms: null,
      rag_total_ms: null,
      coordinator_wait_ms: 0,
      window_reset_ms: 0,
      pre_probe_gate_verify_ms: 0,
      retry_count: 0,
      retry_delay_ms: 0,
      kpi_query_write_ms: 0,
      kpi_usefulness_write_ms: 0,
      jsonl_write_ms: 0,
      unattributed_ms: null,
    },
    stall,
  );
}

export function finalizeProbeTiming(row, extra = {}) {
  const merged = buildTimingAttribution({
    ...row.timing,
    ...extra,
    stall: { ...row.timing, ...extra },
    probe_started_at: row.timing?.probe_started_at ?? extra.probe_started_at,
    probe_finished_at: extra.probe_finished_at ?? row.timing?.probe_finished_at,
  });
  return merged;
}

export function attachTimingToProbeRow(row, timing) {
  return {
    ...row,
    timing: buildTimingAttribution(timing),
  };
}

export function assertAllowedOutputPath(outPath) {
  if (!String(outPath).startsWith('/tmp/')) {
    throw new Phase32TimingAttributionError(`timing attribution output must be under /tmp: ${outPath}`);
  }
}

export function assertRedactedProbeRow(row, relativePath = 'probe-row') {
  const text = JSON.stringify(row).toLowerCase();
  for (const field of FORBIDDEN_PROBE_FIELDS) {
    if (text.includes(`"${field.toLowerCase()}"`)) {
      throw new Phase32TimingAttributionError(`${relativePath} must not include forbidden field: ${field}`);
    }
  }
  if (/\beyj[a-z0-9]/i.test(text)) {
    throw new Phase32TimingAttributionError(`${relativePath} must not include jwt-like token`);
  }
}

export function validateTimingAttribution(timing) {
  if (!timing || typeof timing !== 'object') {
    throw new Phase32TimingAttributionError('timing object required');
  }
  for (const field of TIMING_FIELDS) {
    if (!(field in timing)) {
      throw new Phase32TimingAttributionError(`missing timing field: ${field}`);
    }
  }
  buildTimingAttribution(timing);
  return true;
}

export function timingSeparatesRagFromCurl(timing) {
  if (!timing) return false;
  if (timing.curl_time_total_ms == null) return true;
  if (timing.rag_total_ms == null) return true;
  return timing.rag_total_ms !== timing.curl_time_total_ms;
}

export function coordinatorWaitIsNotRagTotal(timing) {
  if (!timing || timing.coordinator_wait_ms == null || timing.rag_total_ms == null) return true;
  return timing.coordinator_wait_ms !== timing.rag_total_ms;
}

export function retryDelayIsNotRagTotal(timing) {
  if (!timing || timing.retry_delay_ms == null || timing.rag_total_ms == null) return true;
  return timing.retry_delay_ms !== timing.rag_total_ms;
}
