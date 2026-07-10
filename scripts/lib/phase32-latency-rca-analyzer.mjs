/**
 * Phase 32B — read-only latency RCA analyzer over Phase 31D-R2 matrix JSONL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAllShardRows } from '../phase31-extract-controlled-matrix-failures.mjs';
import { percentile } from './phase31-controlled-matrix-summary.mjs';

export function latencyMs(row) {
  const value = Number(row?.rag_total_ms);
  return Number.isFinite(value) ? value : null;
}

export function rowProvenance(row, shardDir = null) {
  return {
    probe_id: row.probe_id ?? null,
    matrix_protocol: row.matrix_protocol ?? null,
    protocol_label: row.protocol_label ?? null,
    case_id: row.case_id ?? null,
    window: row.window ?? null,
    run: row.run ?? null,
    user_uid_hash: row.user_uid_hash ?? null,
    user_class: row.user_class ?? null,
    rag_total_ms: latencyMs(row),
    gate_reason: row.gate_reason ?? null,
    http_status: row.http_status ?? null,
    completed_at: row.completed_at ?? null,
    shard_dir: shardDir,
  };
}

export function jsonlAttributionLimits() {
  return {
    latency_field: 'rag_total_ms',
    is_curl_time_total: false,
    includes_retry_delay: 'unknown — field not present in Phase 31D-R2 JSONL',
    includes_coordinator_wait: 'unknown — field not present in Phase 31D-R2 JSONL',
    includes_kpi_write_ms: 'unknown — field not present in Phase 31D-R2 JSONL',
    includes_process_stall_or_timestamp_gap:
      'partial — inferred from completed_at ordering gaps within shard JSONL only',
  };
}

export function maxLatencyAttribution(row) {
  const limits = jsonlAttributionLimits();
  return {
    ...rowProvenance(row),
    attribution: {
      measured_as: limits.latency_field,
      max_is_rag_total_ms: true,
      max_is_curl_time_total: limits.is_curl_time_total,
      includes_retry_delay: limits.includes_retry_delay,
      includes_coordinator_wait: limits.includes_coordinator_wait,
      includes_process_stall_or_timestamp_gap: limits.includes_process_stall_or_timestamp_gap,
    },
  };
}

function bucketStats(values) {
  if (!values.length) {
    return { count: 0, p50: null, p90: null, p95: null, p99: null, p99_9: null, max: null };
  }
  const round = (v) => (v == null ? null : Number(v.toFixed(1)));
  return {
    count: values.length,
    p50: round(percentile(values, 50)),
    p90: round(percentile(values, 90)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
    p99_9: round(percentile(values, 99.9)),
    max: Number(Math.max(...values).toFixed(1)),
  };
}

export function groupPercentiles(rows, keyFn, labelKey) {
  const buckets = new Map();
  for (const row of rows) {
    const ms = latencyMs(row);
    if (ms == null) continue;
    const key = keyFn(row);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(ms);
  }
  return [...buckets.entries()]
    .map(([key, values]) => ({
      [labelKey]: key,
      ...bucketStats(values),
    }))
    .sort((a, b) => String(a[labelKey]).localeCompare(String(b[labelKey])));
}

export function topOutliers(rows, limit = 50) {
  const enriched = rows
    .map((entry) => ({ ...rowProvenance(entry.row, entry.shardDir), attribution: jsonlAttributionLimits() }))
    .filter((row) => row.rag_total_ms != null)
    .sort((a, b) => b.rag_total_ms - a.rag_total_ms);
  return enriched.slice(0, limit);
}

function parseIsoMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function completionGapMs(prevCompletedAt, completedAt) {
  const prev = parseIsoMs(prevCompletedAt);
  const cur = parseIsoMs(completedAt);
  if (prev == null || cur == null) return null;
  return cur - prev;
}

export function buildCompletionGapsByShard(rowsWithShard) {
  const gaps = [];
  const byShard = new Map();
  for (const entry of rowsWithShard) {
    const shard = path.basename(entry.shardDir || 'unknown');
    if (!byShard.has(shard)) byShard.set(shard, []);
    byShard.get(shard).push(entry);
  }
  for (const [shard, entries] of byShard) {
    const sorted = [...entries].sort((a, b) => {
      const ta = parseIsoMs(a.row.completed_at) ?? 0;
      const tb = parseIsoMs(b.row.completed_at) ?? 0;
      return ta - tb;
    });
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = completionGapMs(sorted[i - 1].row.completed_at, sorted[i].row.completed_at);
      if (gap == null) continue;
      gaps.push({
        shard,
        gap_ms: gap,
        prior_probe_id: sorted[i - 1].row.probe_id ?? null,
        probe_id: sorted[i].row.probe_id ?? null,
        completed_at: sorted[i].row.completed_at ?? null,
      });
    }
  }
  return gaps.sort((a, b) => b.gap_ms - a.gap_ms);
}

export function parseMonitorEvents(monitorText) {
  const events = [];
  const lines = monitorText.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/runner stopped; inspecting log before restart/i.test(line)) {
      events.push({ type: 'shard_restart_inspection', line: i + 1, detail: line.trim() });
    } else if (/restarting h[123] with --resume/i.test(line)) {
      events.push({ type: 'shard_restart', line: i + 1, detail: line.trim() });
    } else if (/restarted h[123] pid=/i.test(line)) {
      events.push({ type: 'shard_restarted', line: i + 1, detail: line.trim() });
    } else if (/window-coordinator\/lock\/meta\.json/i.test(line)) {
      events.push({ type: 'coordinator_lock_error', line: i + 1, detail: line.trim() });
    } else if (/monitor gap|stall/i.test(line)) {
      events.push({ type: 'monitor_gap', line: i + 1, detail: line.trim() });
    }
  }
  return events;
}

export function correlateOutliers(outliers, monitorEvents, completionGaps) {
  const coordinatorLockEvents = monitorEvents.filter((e) => e.type === 'coordinator_lock_error');
  const shardRestartEvents = monitorEvents.filter(
    (e) => e.type === 'shard_restart' || e.type === 'shard_restarted',
  );
  const largeGaps = completionGaps.filter((g) => g.gap_ms >= 60_000);

  return outliers.slice(0, 10).map((outlier) => {
    const shard = String(outlier.matrix_protocol || outlier.protocol_label || '').toLowerCase();
    const gapHit = largeGaps.find((g) => g.probe_id === outlier.probe_id) || null;
    return {
      probe_id: outlier.probe_id,
      rag_total_ms: outlier.rag_total_ms,
      matrix_protocol: outlier.matrix_protocol,
      protocol_label: outlier.protocol_label,
      case_id: outlier.case_id,
      window: outlier.window,
      run: outlier.run,
      user_class: outlier.user_class,
      coordinator_lock_events_present: coordinatorLockEvents.length > 0,
      coordinator_lock_event_count: coordinatorLockEvents.length,
      shard_restart_events_present: shardRestartEvents.length > 0,
      shard_restart_event_count: shardRestartEvents.length,
      h1_restart_observed: shardRestartEvents.some((e) => /h1/i.test(e.detail)),
      completion_gap_on_probe: gapHit,
      note:
        outlier.rag_total_ms >= 1_000_000
          ? 'max-tier outlier; JSONL alone cannot split retry/coordinator/curl components'
          : null,
    };
  });
}

export function analyzePhase32LatencyRca({ matrixIn, outDir, topN = 50 }) {
  const { rows, shardDirs } = loadAllShardRows(matrixIn);
  const rowsWithShard = [];
  const shardNames = ['shard-h1', 'shard-h2', 'shard-h3'];
  const hasShards = shardNames.some((name) =>
    fs.existsSync(path.join(matrixIn, name, 'phase31-matrix.jsonl')),
  );
  if (hasShards) {
    for (const shardDir of shardDirs) {
      const jsonl = path.join(shardDir, 'phase31-matrix.jsonl');
      for (const row of fs
        .readFileSync(jsonl, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))) {
        rowsWithShard.push({ row, shardDir });
      }
    }
  } else {
    for (const row of rows) rowsWithShard.push({ row, shardDir: matrixIn });
  }

  const flatRows = rowsWithShard.map((e) => e.row);
  const outliers = topOutliers(rowsWithShard, topN);
  const maxRow = [...flatRows].sort((a, b) => latencyMs(b) - latencyMs(a))[0] ?? null;
  const completionGaps = buildCompletionGapsByShard(rowsWithShard);
  const monitorPath = path.join(matrixIn, 'phase31-monitor.log');
  const monitorEvents = fs.existsSync(monitorPath)
    ? parseMonitorEvents(fs.readFileSync(monitorPath, 'utf8'))
    : [];

  const report = {
    generated_at: new Date().toISOString(),
    phase: '32B',
    matrix_in: matrixIn,
    row_count: flatRows.length,
    jsonl_attribution_limits: jsonlAttributionLimits(),
    max_latency_provenance: maxRow ? maxLatencyAttribution(maxRow) : null,
    max_outlier_explained_from_jsonl: false,
    latency_rca_status: 'CLASSIFIED',
    top_outliers: outliers,
    per_protocol: groupPercentiles(flatRows, (r) => r.protocol_label || 'unknown', 'protocol'),
    per_case: groupPercentiles(flatRows, (r) => r.case_id || 'unknown', 'case_id'),
    per_window: groupPercentiles(flatRows, (r) => String(r.window ?? 'unknown'), 'window'),
    per_user_class: groupPercentiles(flatRows, (r) => r.user_class || 'unknown', 'user_class'),
    monitor_events: monitorEvents,
    largest_completion_gaps_top20: completionGaps.slice(0, 20),
    outlier_correlation: correlateOutliers(outliers, monitorEvents, completionGaps),
    production_enablement: 'NOT APPROVED',
    notes: [
      'Read-only analyzer; outputs belong in /tmp/phase32-latency-rca/ only',
      'rag_total_ms is the only latency field in Phase 31D-R2 JSONL',
      'Full retry/coordinator/curl attribution requires Phase 32C instrumentation',
    ],
  };

  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    summary: path.join(outDir, 'phase32-latency-rca-summary.json'),
    top_outliers: path.join(outDir, 'phase32-top-50-outliers.json'),
    max_provenance: path.join(outDir, 'phase32-max-latency-provenance.json'),
    per_protocol: path.join(outDir, 'phase32-per-protocol-percentiles.json'),
    per_case: path.join(outDir, 'phase32-per-case-percentiles.json'),
    per_window: path.join(outDir, 'phase32-per-window-percentiles.json'),
    per_user_class: path.join(outDir, 'phase32-per-user-class-percentiles.json'),
    correlation: path.join(outDir, 'phase32-correlation-events.json'),
  };

  fs.writeFileSync(files.summary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(files.top_outliers, `${JSON.stringify(outliers, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    files.max_provenance,
    `${JSON.stringify(report.max_latency_provenance, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(files.per_protocol, `${JSON.stringify(report.per_protocol, null, 2)}\n`, 'utf8');
  fs.writeFileSync(files.per_case, `${JSON.stringify(report.per_case, null, 2)}\n`, 'utf8');
  fs.writeFileSync(files.per_window, `${JSON.stringify(report.per_window, null, 2)}\n`, 'utf8');
  fs.writeFileSync(files.per_user_class, `${JSON.stringify(report.per_user_class, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    files.correlation,
    `${JSON.stringify(
      {
        monitor_events: monitorEvents,
        outlier_correlation: report.outlier_correlation,
        largest_completion_gaps_top20: report.largest_completion_gaps_top20,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { report, files };
}
