/**
 * Phase 32D — summarize timing attribution micro-soak + verdict.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllShardRows } from './phase31-extract-controlled-matrix-failures.mjs';
import { percentile, summarizeMatrixRows } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  MATRIX_EVIDENCE_LABEL,
  MATRIX_TARGET,
  OUTLIER_THRESHOLD_MS,
  resolvePhase32dMatrixRoot,
} from './lib/phase32d-controlled-matrix-config.mjs';
import { assertRedactedProbeRow } from './lib/phase32-timing-attribution.mjs';

const TIMING_COMPONENTS = [
  'wall_total_ms',
  'curl_time_total_ms',
  'rag_total_ms',
  'coordinator_wait_ms',
  'window_reset_ms',
  'pre_probe_gate_verify_ms',
  'retry_delay_ms',
  'kpi_query_write_ms',
  'kpi_usefulness_write_ms',
  'jsonl_write_ms',
  'unattributed_ms',
];

function parseArgs(argv) {
  const opts = {
    in: resolvePhase32dMatrixRoot(),
    requirePass: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--require-pass') opts.requirePass = true;
  }
  return opts;
}

function round1(v) {
  return v == null ? null : Number(v.toFixed(1));
}

function validateTimingRows(rows) {
  const stats = {
    total: rows.length,
    wall_total_ms_populated: 0,
    curl_time_total_ms_populated: 0,
    rag_total_ms_populated: 0,
    unattributed_ms_populated: 0,
    negative_fields: 0,
    forbidden_field_violations: 0,
    missing_timing: 0,
  };

  for (const row of rows) {
    try {
      assertRedactedProbeRow(row);
    } catch {
      stats.forbidden_field_violations += 1;
    }
    const timing = row.timing;
    if (!timing) {
      stats.missing_timing += 1;
      continue;
    }
    if (timing.wall_total_ms != null) stats.wall_total_ms_populated += 1;
    if (timing.curl_time_total_ms != null) stats.curl_time_total_ms_populated += 1;
    if (timing.rag_total_ms != null) stats.rag_total_ms_populated += 1;
    if (timing.unattributed_ms != null) stats.unattributed_ms_populated += 1;
    for (const field of TIMING_COMPONENTS) {
      const value = timing[field];
      if (value != null && Number(value) < 0) stats.negative_fields += 1;
    }
  }
  return stats;
}

function gateSummary(rows) {
  const summary = summarizeMatrixRows(rows, {
    targetPerProtocol: MATRIX_TARGET.perProtocol,
    targetTotal: MATRIX_TARGET.total,
    evidenceLabel: MATRIX_EVIDENCE_LABEL,
  });
  return summary;
}

function topOutliers(rows, limit = 50) {
  return [...rows]
    .filter((r) => r.timing?.wall_total_ms != null || typeof r.rag_total_ms === 'number')
    .sort((a, b) => {
      const am = a.timing?.wall_total_ms ?? a.rag_total_ms ?? 0;
      const bm = b.timing?.wall_total_ms ?? b.rag_total_ms ?? 0;
      return bm - am;
    })
    .slice(0, limit)
    .map((r) => ({
      probe_id: r.probe_id,
      protocol_label: r.protocol_label,
      matrix_protocol: r.matrix_protocol,
      case_id: r.case_id,
      window: r.window,
      run: r.run,
      user_class: r.user_class,
      gate_reason: r.gate_reason,
      timing: r.timing,
      rag_total_ms: r.rag_total_ms,
    }));
}

function maxByProtocol(rows) {
  const out = {};
  for (const proto of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const subset = rows.filter((r) => r.protocol_label === proto);
    const walls = subset.map((r) => r.timing?.wall_total_ms).filter((v) => v != null);
    const curls = subset.map((r) => r.timing?.curl_time_total_ms).filter((v) => v != null);
    const rags = subset.map((r) => r.timing?.rag_total_ms).filter((v) => v != null);
    out[proto] = {
      max_wall_total_ms: walls.length ? Math.max(...walls) : null,
      max_curl_time_total_ms: curls.length ? Math.max(...curls) : null,
      max_rag_total_ms: rags.length ? Math.max(...rags) : null,
      count: subset.length,
    };
  }
  return out;
}

function maxByTimingComponent(rows) {
  const out = {};
  for (const field of TIMING_COMPONENTS) {
    const values = rows.map((r) => r.timing?.[field]).filter((v) => v != null);
    out[field] = values.length ? round1(Math.max(...values)) : null;
  }
  return out;
}

function latencyByComponent(rows) {
  return TIMING_COMPONENTS.map((field) => {
    const values = rows.map((r) => r.timing?.[field]).filter((v) => typeof v === 'number');
    return {
      component: field,
      count: values.length,
      p50: round1(percentile(values, 50)),
      p95: round1(percentile(values, 95)),
      p99: round1(percentile(values, 99)),
      max: values.length ? round1(Math.max(...values)) : null,
    };
  });
}

function attributeOutlierOwner(maxByComponent, reproduced) {
  if (!reproduced) {
    const ranked = Object.entries(maxByComponent)
      .filter(([, v]) => v != null)
      .sort((a, b) => b[1] - a[1]);
    return ranked[0]?.[0] ?? 'none';
  }
  const owners = [
    ['curl/end-to-end', maxByComponent.curl_time_total_ms],
    ['app rag_total_ms', maxByComponent.rag_total_ms],
    ['coordinator_wait_ms', maxByComponent.coordinator_wait_ms],
    ['window_reset_ms', maxByComponent.window_reset_ms],
    ['retry_delay_ms', maxByComponent.retry_delay_ms],
    ['KPI write path', Math.max(maxByComponent.kpi_query_write_ms ?? 0, maxByComponent.kpi_usefulness_write_ms ?? 0)],
    ['jsonl write', maxByComponent.jsonl_write_ms],
    ['unattributed/process stall', maxByComponent.unattributed_ms],
  ];
  owners.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return owners[0][0];
}

export function buildPhase32dReport(inDir) {
  const { rows } = loadAllShardRows(inDir);
  const gates = gateSummary(rows);
  const timingStats = validateTimingRows(rows);
  const outliers = topOutliers(rows);
  const maxProtocol = maxByProtocol(rows);
  const maxComponent = maxByTimingComponent(rows);
  const globalMaxWall = maxComponent.wall_total_ms ?? 0;
  const outlierReproduced = globalMaxWall >= OUTLIER_THRESHOLD_MS;

  const ragPct =
    timingStats.total > 0 ? timingStats.rag_total_ms_populated / timingStats.total : 0;
  const appTimingBlocked = ragPct < 1;

  const matrixComplete = rows.length === MATRIX_TARGET.total && gates.status === 'PASS';
  const timingComplete =
    timingStats.wall_total_ms_populated === timingStats.total &&
    timingStats.curl_time_total_ms_populated === timingStats.total &&
    timingStats.unattributed_ms_populated === timingStats.total &&
    timingStats.negative_fields === 0 &&
    timingStats.forbidden_field_violations === 0 &&
    timingStats.missing_timing === 0 &&
    (appTimingBlocked ? false : timingStats.rag_total_ms_populated === timingStats.total);

  let phase32dStatus = 'BLOCKED';
  if (appTimingBlocked) {
    phase32dStatus = 'BLOCKED';
  } else if (matrixComplete && timingComplete) {
    phase32dStatus = 'PASS';
  } else if (rows.length < MATRIX_TARGET.total) {
    phase32dStatus = 'IN_PROGRESS';
  }

  const verdict = {
    phase: '32D',
    status: phase32dStatus,
    outlier_threshold_ms: OUTLIER_THRESHOLD_MS,
    seventeen_minute_outlier_reproduced: outlierReproduced ? 'YES' : 'NO',
    attribution_owner: attributeOutlierOwner(maxComponent, outlierReproduced),
    app_timing_exposure_blocked: appTimingBlocked,
    rag_total_ms_population_rate: ragPct,
    max_latency_by_protocol: maxProtocol,
    max_latency_by_timing_component: maxComponent,
    notes: appTimingBlocked
      ? ['timing.rag_total_ms not 100% populated — app timing exposure blocked or service not patched']
      : [],
  };

  return {
    generated_at: new Date().toISOString(),
    phase: '32D',
    matrix_in: inDir,
    status: phase32dStatus,
    gates,
    timing_stats: timingStats,
    timing_population: {
      wall_total_ms: `${timingStats.wall_total_ms_populated}/${timingStats.total}`,
      curl_time_total_ms: `${timingStats.curl_time_total_ms_populated}/${timingStats.total}`,
      rag_total_ms: `${timingStats.rag_total_ms_populated}/${timingStats.total}`,
      unattributed_ms: `${timingStats.unattributed_ms_populated}/${timingStats.total}`,
    },
    outliers_top50: outliers,
    latency_by_protocol: gates.latency_by_protocol,
    latency_by_case: gates.latency_by_case,
    latency_by_timing_component: latencyByComponent(rows),
    attribution_verdict: verdict,
    production_enablement: 'NOT APPROVED',
  };
}

export function writePhase32dArtifacts(inDir, report) {
  fs.mkdirSync(inDir, { recursive: true });
  const files = {
    'phase32d-summary.json': {
      status: report.status,
      gates: report.gates,
      timing_stats: report.timing_stats,
      timing_population: report.timing_population,
      generated_at: report.generated_at,
    },
    'phase32d-latency-by-protocol.json': report.latency_by_protocol,
    'phase32d-latency-by-case.json': report.latency_by_case,
    'phase32d-latency-by-timing-component.json': report.latency_by_timing_component,
    'phase32d-outliers-top50.json': report.outliers_top50,
    'phase32d-attribution-verdict.json': report.attribution_verdict,
  };
  for (const [name, payload] of Object.entries(files)) {
    fs.writeFileSync(path.join(inDir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return files;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildPhase32dReport(opts.in);
  writePhase32dArtifacts(opts.in, report);
  console.log(
    JSON.stringify(
      {
        status: report.status,
        matrix_total: report.gates.matrix_total,
        timing_population: report.timing_population,
        verdict: report.attribution_verdict,
      },
      null,
      2,
    ),
  );
  if (opts.requirePass && report.status !== 'PASS') return 2;
  if (report.status === 'IN_PROGRESS') return 2;
  if (report.status === 'BLOCKED') return 1;
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
