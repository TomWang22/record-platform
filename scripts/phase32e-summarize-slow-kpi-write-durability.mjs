/**
 * Phase 32E — summarize slow KPI write durability across three modes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllShardRows } from './phase31-extract-controlled-matrix-failures.mjs';
import { percentile, summarizeMatrixRows } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  MATRIX_EVIDENCE_LABEL,
  MATRIX_TARGET,
  MODES,
  resolvePhase32eMatrixRoot,
} from './lib/phase32e-controlled-matrix-config.mjs';
import { assertRedactedProbeRow } from './lib/phase32-timing-attribution.mjs';

const TIMING_FIELDS = [
  'wall_total_ms',
  'curl_time_total_ms',
  'rag_total_ms',
  'kpi_query_write_ms',
  'kpi_usefulness_write_ms',
  'unattributed_ms',
];

function parseArgs(argv) {
  const opts = { in: resolvePhase32eMatrixRoot(), requirePass: false };
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

function loadModeRows(root, modeKey) {
  const modeDir = path.join(root, modeKey);
  return loadAllShardRows(modeDir).rows;
}

function timingStats(rows, field) {
  const values = rows.map((r) => r.timing?.[field]).filter((v) => typeof v === 'number');
  return {
    count: values.length,
    p50: round1(percentile(values, 50)),
    p95: round1(percentile(values, 95)),
    p99: round1(percentile(values, 99)),
    max: values.length ? round1(Math.max(...values)) : null,
  };
}

function summarizeMode(modeKey, rows) {
  const gates = summarizeMatrixRows(rows, {
    targetPerProtocol: MATRIX_TARGET.perProtocol,
    targetTotal: MATRIX_TARGET.total,
    evidenceLabel: `${MATRIX_EVIDENCE_LABEL} (${modeKey})`,
  });
  let forbidden = 0;
  for (const row of rows) {
    try {
      assertRedactedProbeRow(row);
    } catch {
      forbidden += 1;
    }
  }
  const ragPass = rows.filter((r) => r.http_status === 200 && r.response_pass === 'PASS').length;
  const kpiQueryFail = rows.filter((r) => r.query_observation_write === 'FAIL').length;
  const kpiUseFail = rows.filter((r) => r.usefulness_write === 'FAIL').length;
  const timingByField = Object.fromEntries(
    TIMING_FIELDS.map((field) => [field, timingStats(rows, field)]),
  );
  return {
    mode: modeKey,
    status: gates.status,
    matrix_total: gates.matrix_total,
    gates,
    rag_success_rate: rows.length ? ragPass / rows.length : 0,
    kpi_query_write_failures: kpiQueryFail,
    kpi_usefulness_write_failures: kpiUseFail,
    kpi_write_failures: kpiQueryFail + kpiUseFail,
    forbidden_field_violations: forbidden,
    timing_by_field: timingByField,
    per_protocol_counts: gates.per_protocol_counts,
  };
}

function topOutliers(rows, limit = 50) {
  return [...rows]
    .sort((a, b) => (b.timing?.wall_total_ms ?? 0) - (a.timing?.wall_total_ms ?? 0))
    .slice(0, limit)
    .map((r) => ({
      probe_id: r.probe_id,
      protocol_label: r.protocol_label,
      case_id: r.case_id,
      window: r.window,
      run: r.run,
      timing: r.timing,
      query_observation_write: r.query_observation_write,
      usefulness_write: r.usefulness_write,
      response_pass: r.response_pass,
    }));
}

export function buildPhase32eReport(root) {
  const modeSummaries = {};
  const allRows = [];
  for (const modeKey of Object.keys(MODES)) {
    const rows = loadModeRows(root, modeKey);
    modeSummaries[modeKey] = summarizeMode(modeKey, rows);
    allRows.push(...rows.map((r) => ({ ...r, phase32e_mode: modeKey })));
  }

  const allComplete = Object.values(modeSummaries).every(
    (m) => m.gates.status === 'PASS' && m.gates.matrix_total === `${MATRIX_TARGET.total}/${MATRIX_TARGET.total}`,
  );
  const failing = modeSummaries.failing_write;
  const failOpen =
    failing.rag_success_rate === 1 &&
    failing.kpi_write_failures > 0 &&
    failing.forbidden_field_violations === 0 &&
    failing.gates.wrong_gate_count === 0 &&
    failing.gates.leakage_failures === 0;

  let status = 'BLOCKED';
  if (!allComplete) {
    status = Object.values(modeSummaries).some((m) => m.gates.matrix_total?.startsWith('0/'))
      ? 'IN_PROGRESS'
      : 'BLOCKED';
  } else if (!failOpen) {
    status = 'BLOCKED';
  } else {
    status = 'PASS';
  }

  const comparison = {
    generated_at: new Date().toISOString(),
    phase: '32E',
    status,
    fail_open_under_kpi_write_failure: failOpen,
    modes: Object.fromEntries(
      Object.entries(modeSummaries).map(([key, summary]) => [
        key,
        {
          matrix_total: summary.matrix_total,
          status: summary.status,
          rag_success_rate: summary.rag_success_rate,
          kpi_write_failures: summary.kpi_write_failures,
          timing_by_field: summary.timing_by_field,
          gates: {
            fallback: summary.gates.fallback_count,
            wrong_protocol: summary.gates.wrong_protocol_count,
            wrong_gate: summary.gates.wrong_gate_count,
            leakage: summary.gates.leakage_failures,
            response_pass_rate: summary.gates.response_pass_rate,
          },
        },
      ]),
    ),
    production_enablement: 'NOT APPROVED',
  };

  return {
    status,
    modeSummaries,
    comparison,
    outliers: topOutliers(allRows),
  };
}

export function writePhase32eArtifacts(root, report) {
  fs.mkdirSync(root, { recursive: true });
  const files = {
    'phase32e-baseline-summary.json': report.modeSummaries.baseline,
    'phase32e-slow-write-summary.json': report.modeSummaries.slow_write,
    'phase32e-failing-write-summary.json': report.modeSummaries.failing_write,
    'phase32e-comparison.json': report.comparison,
    'phase32e-outliers-top50.json': report.outliers,
  };
  for (const [name, payload] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return files;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildPhase32eReport(opts.in);
  writePhase32eArtifacts(opts.in, report);
  console.log(JSON.stringify({ status: report.status, comparison: report.comparison }, null, 2));
  if (opts.requirePass && report.status !== 'PASS') return 2;
  if (report.status === 'IN_PROGRESS') return 2;
  if (report.status === 'BLOCKED') return 1;
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
