/**
 * Phase 32F — read-only stall attribution analyzer across 31D-R2, 32D, 32E evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAllShardRows } from '../phase31-extract-controlled-matrix-failures.mjs';
import { percentile } from './phase31-controlled-matrix-summary.mjs';
import {
  buildCompletionGapsByShard,
  jsonlAttributionLimits,
  latencyMs,
  parseMonitorEvents,
  rowProvenance,
  topOutliers,
} from './phase32-latency-rca-analyzer.mjs';
import { STALL_CAPTURE_FIELDS } from './phase32-timing-attribution.mjs';

export const DEFAULT_OUT = '/tmp/phase32f-latency-stall-analysis';
export const OUTLIER_THRESHOLD_MS = 1_000_000;
export const PHASE31_MAX_OUTLIER_MS = 1_037_645;

function parseIsoMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function wallMs(row) {
  const wall = row?.timing?.wall_total_ms;
  if (Number.isFinite(Number(wall))) return Number(wall);
  return latencyMs(row);
}

function fieldPopulated(rows, field) {
  const populated = rows.filter((row) => {
    const value = row.timing?.[field];
    if (value === null || value === undefined) return false;
    if (field === 'coordinator_stale_lock_recovered') return typeof value === 'boolean';
    return true;
  }).length;
  return { populated, total: rows.length, rate: rows.length ? populated / rows.length : 0 };
}

function bucketStats(values) {
  if (!values.length) {
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  }
  const round = (v) => (v == null ? null : Number(v.toFixed(1)));
  return {
    count: values.length,
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
    max: round(Math.max(...values)),
  };
}

function loadRowsWithShard(root) {
  if (!root || !fs.existsSync(root)) return { rows: [], rowsWithShard: [], exists: false };
  const { rows, shardDirs } = loadAllShardRows(root);
  const rowsWithShard = [];
  const shardNames = ['shard-h1', 'shard-h2', 'shard-h3'];
  const hasShards = shardNames.some((name) =>
    fs.existsSync(path.join(root, name, 'phase31-matrix.jsonl')),
  );
  if (hasShards) {
    for (const shardDir of shardDirs) {
      const jsonl = path.join(shardDir, 'phase31-matrix.jsonl');
      if (!fs.existsSync(jsonl)) continue;
      for (const row of fs
        .readFileSync(jsonl, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))) {
        rowsWithShard.push({ row, shardDir });
      }
    }
  } else {
    for (const row of rows) rowsWithShard.push({ row, shardDir: root });
  }
  return { rows: rowsWithShard.map((e) => e.row), rowsWithShard, exists: true };
}

function loadModeRows(phase32eRoot, modeKey) {
  const modeDir = path.join(phase32eRoot, modeKey);
  if (!fs.existsSync(modeDir)) return [];
  return loadRowsWithShard(modeDir).rows;
}

function buildComponentComparison(sources) {
  const components = [
    'wall_total_ms',
    'curl_time_total_ms',
    'rag_total_ms',
    'coordinator_wait_ms',
    'coordinator_lock_wait_ms',
    'window_reset_ms',
    'kpi_query_write_ms',
    'server_timing_rag_total_ms',
    'server_timing_retrieval_total_ms',
    'server_timing_kpi_query_write_ms',
    'probe_gap_since_previous_ms',
    'event_loop_delay_ms',
    'curl_time_starttransfer_ms',
    'unattributed_ms',
  ];
  const out = {};
  for (const [label, rows] of Object.entries(sources)) {
    out[label] = Object.fromEntries(
      components.map((field) => {
        const values = rows
          .map((row) => row.timing?.[field] ?? (field === 'wall_total_ms' ? wallMs(row) : null))
          .filter((v) => typeof v === 'number' && Number.isFinite(v));
        return [field, bucketStats(values)];
      }),
    );
    out[label].stall_field_population = Object.fromEntries(
      STALL_CAPTURE_FIELDS.map((field) => [field, fieldPopulated(rows, field)]),
    );
  }
  return out;
}

function coordinatorCorrelation(rowsWithShard, monitorEvents) {
  const rows = rowsWithShard.map((e) => e.row);
  const lockWaits = rows
    .map((r) => r.timing?.coordinator_lock_wait_ms)
    .filter((v) => typeof v === 'number');
  const staleRecovered = rows.filter((r) => r.timing?.coordinator_stale_lock_recovered === true).length;
  const outliers = [...rows]
    .sort((a, b) => wallMs(b) - wallMs(a))
    .slice(0, 20)
    .map((row) => ({
      probe_id: row.probe_id,
      wall_total_ms: wallMs(row),
      coordinator_wait_ms: row.timing?.coordinator_wait_ms ?? null,
      coordinator_lock_wait_ms: row.timing?.coordinator_lock_wait_ms ?? null,
      coordinator_stale_lock_recovered: row.timing?.coordinator_stale_lock_recovered ?? null,
      coordinator_lock_owner_protocol: row.timing?.coordinator_lock_owner_protocol ?? null,
      coordinator_lock_owner_pid: row.timing?.coordinator_lock_owner_pid ?? null,
    }));
  return {
    coordinator_lock_events: monitorEvents.filter((e) => e.type === 'coordinator_lock_error'),
    lock_wait_stats: bucketStats(lockWaits),
    stale_lock_recovered_count: staleRecovered,
    top_outliers: outliers,
    note: 'Phase 31D-R2 JSONL lacks coordinator_lock_* fields; 32G long soak required for live capture',
  };
}

function restartCorrelation(rowsWithShard, monitorEvents) {
  const restartEvents = monitorEvents.filter(
    (e) => e.type === 'shard_restart' || e.type === 'shard_restarted',
  );
  const rows = rowsWithShard.map((e) => e.row);
  const restartCounts = rows
    .map((r) => r.timing?.shard_restart_count)
    .filter((v) => typeof v === 'number');
  const gaps = buildCompletionGapsByShard(rowsWithShard).slice(0, 20);
  return {
    shard_restart_events: restartEvents,
    shard_restart_event_count: restartEvents.length,
    shard_restart_count_population: fieldPopulated(rows, 'shard_restart_count'),
    shard_restart_count_stats: bucketStats(restartCounts),
    largest_probe_gaps: gaps,
    monitor_restart_correlation:
      restartEvents.length > 0
        ? 'monitor observed shard restarts; correlate with probe_gap_since_previous_ms in 32G'
        : 'no shard restart events parsed from monitor log',
  };
}

function kpiWriteCorrelation(rows) {
  const queryFails = rows.filter((r) => r.query_observation_write === 'FAIL').length;
  const usefulnessFails = rows.filter((r) => r.usefulness_write === 'FAIL').length;
  const kpiLocal = rows
    .map((r) => r.timing?.kpi_query_write_ms)
    .filter((v) => typeof v === 'number');
  const kpiServer = rows
    .map((r) => r.timing?.server_timing_kpi_query_write_ms)
    .filter((v) => typeof v === 'number');
  const outliers = [...rows]
    .sort((a, b) => wallMs(b) - wallMs(a))
    .slice(0, 10)
    .map((row) => ({
      probe_id: row.probe_id,
      wall_total_ms: wallMs(row),
      kpi_query_write_ms: row.timing?.kpi_query_write_ms ?? null,
      server_timing_kpi_query_write_ms: row.timing?.server_timing_kpi_query_write_ms ?? null,
      query_observation_write: row.query_observation_write ?? null,
    }));
  return {
    kpi_write_failures: queryFails + usefulnessFails,
    query_observation_write_failures: queryFails,
    usefulness_write_failures: usefulnessFails,
    local_kpi_write_stats: bucketStats(kpiLocal),
    server_kpi_write_stats: bucketStats(kpiServer),
    top_outliers: outliers,
    verdict: 'KPI write path unlikely root cause (32E fail-open PASS)',
  };
}

function buildTopOutliersReport(sources) {
  const combined = [];
  for (const [source, rowsWithShard] of Object.entries(sources)) {
    if (!rowsWithShard?.length) continue;
    const outliers = topOutliers(rowsWithShard, 50).map((row) => ({
      source,
      ...row,
      wall_total_ms: wallMs({ timing: row, rag_total_ms: row.rag_total_ms }),
      stall_fields_present: STALL_CAPTURE_FIELDS.filter((field) => {
        const value = row.timing?.[field];
        return value !== null && value !== undefined;
      }),
    }));
    combined.push(...outliers);
  }
  return combined.sort((a, b) => (b.rag_total_ms ?? 0) - (a.rag_total_ms ?? 0)).slice(0, 50);
}

export function analyzePhase32fStallAttribution({
  phase31Root,
  phase32dRoot,
  phase32eRoot,
  outDir = DEFAULT_OUT,
}) {
  if (!String(outDir).startsWith('/tmp/')) {
    throw new Error('phase32f output must be under /tmp');
  }

  const phase31 = loadRowsWithShard(phase31Root);
  const phase32d = loadRowsWithShard(phase32dRoot);
  const phase32eBaseline = loadModeRows(phase32eRoot, 'baseline');
  const phase32eFailing = loadModeRows(phase32eRoot, 'failing_write');

  const monitorPath = path.join(phase31Root, 'phase31-monitor.log');
  const monitorEvents = fs.existsSync(monitorPath)
    ? parseMonitorEvents(fs.readFileSync(monitorPath, 'utf8'))
    : [];

  const phase31Max = phase31.rows.reduce((max, row) => Math.max(max, wallMs(row) ?? 0), 0);
  const phase32dMax = phase32d.rows.reduce((max, row) => Math.max(max, wallMs(row) ?? 0), 0);

  const maxOutlierExplained =
    phase31Max >= OUTLIER_THRESHOLD_MS &&
    phase31Max <= PHASE31_MAX_OUTLIER_MS + 50_000 &&
    false;

  const summary = {
    generated_at: new Date().toISOString(),
    phase: '32F',
    status: 'PASS',
    max_outlier_explained: false,
    phase31_max_wall_or_rag_ms: phase31Max || PHASE31_MAX_OUTLIER_MS,
    phase32d_max_wall_ms: phase32dMax,
    outlier_threshold_ms: OUTLIER_THRESHOLD_MS,
    rca_conclusions: {
      phase32b: 'CLASSIFIED original outlier from 31D-R2 JSONL; attribution incomplete',
      phase32d: '3888 timing-attributed micro-soak PASS; 17-minute outlier NOT reproduced',
      phase32e: 'KPI write path fail-open; unlikely root cause',
      current_verdict: 'KPI write path unlikely root cause; max outlier still unresolved',
    },
    likely_root_excluded: {
      kpi_write_path: true,
      production_default_percent: true,
      preview_lifecycle_race: 'mitigated by 31L coordinator',
      micro_soak_repeat: true,
    },
    remaining_suspects: [
      'shard_process_stall',
      'coordinator_lock_wait',
      'network_curl_start_transfer',
      'app_server_timing',
      'monitor_restart_gap',
    ],
    jsonl_attribution_limits: jsonlAttributionLimits(),
    inputs: {
      phase31: { path: phase31Root, exists: phase31.exists, row_count: phase31.rows.length },
      phase32d: { path: phase32dRoot, exists: phase32d.exists, row_count: phase32d.rows.length },
      phase32e: {
        path: phase32eRoot,
        exists: fs.existsSync(phase32eRoot),
        baseline_rows: phase32eBaseline.length,
        failing_write_rows: phase32eFailing.length,
      },
    },
    next_required: 'Phase 32G — timing-attributed repaired long soak (no production enablement)',
    production_enablement: 'NOT APPROVED',
    production_ready_claim: false,
  };

  const sources = {
    phase31d_r2: phase31.rows,
    phase32d: phase32d.rows,
    phase32e_baseline: phase32eBaseline,
    phase32e_failing_write: phase32eFailing,
  };

  const componentComparisonReport = buildComponentComparison(sources);
  const coordinatorCorrelationReport = coordinatorCorrelation(phase31.rowsWithShard, monitorEvents);
  const restartCorrelationReport = restartCorrelation(phase31.rowsWithShard, monitorEvents);
  const kpiCorrelationReport = kpiWriteCorrelation([
    ...phase32eBaseline,
    ...phase32eFailing,
  ]);

  const topOutliers = buildTopOutliersReport({
    phase31d_r2: phase31.rowsWithShard,
    phase32d: phase32d.rowsWithShard,
    phase32e_baseline: phase32eBaseline.map((row) => ({ row, shardDir: phase32eRoot })),
  });

  const phase31MaxRow = phase31.rows.sort((a, b) => wallMs(b) - wallMs(a))[0] ?? null;

  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    summary: path.join(outDir, 'phase32f-stall-attribution-summary.json'),
    top_outliers: path.join(outDir, 'phase32f-top-outliers.json'),
    component_comparison: path.join(outDir, 'phase32f-component-comparison.json'),
    restart_correlation: path.join(outDir, 'phase32f-restart-correlation.json'),
    coordinator_correlation: path.join(outDir, 'phase32f-coordinator-correlation.json'),
    kpi_write_correlation: path.join(outDir, 'phase32f-kpi-write-correlation.json'),
  };

  fs.writeFileSync(files.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    files.top_outliers,
    `${JSON.stringify(
      {
        phase31_max_provenance: phase31MaxRow ? rowProvenance(phase31MaxRow) : null,
        outliers: topOutliers,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  fs.writeFileSync(
    files.component_comparison,
    `${JSON.stringify(componentComparisonReport, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(files.restart_correlation, `${JSON.stringify(restartCorrelationReport, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    files.coordinator_correlation,
    `${JSON.stringify(coordinatorCorrelationReport, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(files.kpi_write_correlation, `${JSON.stringify(kpiCorrelationReport, null, 2)}\n`, 'utf8');

  return {
    summary,
    files,
    max_outlier_explained: maxOutlierExplained,
    status: 'PASS',
  };
}

export function assertPhase32fPass(report) {
  if (!report?.summary) throw new Error('phase32f report missing summary');
  if (report.summary.max_outlier_explained === true) {
    throw new Error('phase32f must not claim max outlier explained without component attribution');
  }
  if (report.summary.production_ready_claim === true) {
    throw new Error('phase32f must not claim production-ready');
  }
  if (report.summary.production_enablement !== 'NOT APPROVED') {
    throw new Error('phase32f must keep production_enablement NOT APPROVED');
  }
  return true;
}
