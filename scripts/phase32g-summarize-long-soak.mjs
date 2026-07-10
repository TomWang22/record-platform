#!/usr/bin/env node
/**
 * Phase 32G — summarize timing-attributed repaired long soak + RCA outcome.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllShardRows } from './phase31-extract-controlled-matrix-failures.mjs';
import { mergeRows } from './phase31-summarize-controlled-matrix.mjs';
import { percentile, summarizeMatrixRows } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  ALL_TIMING_FIELDS,
  assertRedactedProbeRow,
  TIMING_FIELDS,
} from './lib/phase32-timing-attribution.mjs';
import {
  DEFAULT_PHASE32G_MATRIX_OUT,
  MATRIX_TARGET,
  PHASE32G_EVIDENCE_LABEL,
  RCA_ATTRIBUTION_SHARE,
  RCA_NOT_REPRODUCED_THRESHOLD_MS,
  RCA_OUTLIER_THRESHOLD_MS,
  resolvePhase32gMatrixRoot,
} from './lib/phase32g-long-soak-config.mjs';

function parseArgs(argv) {
  const opts = { in: resolvePhase32gMatrixRoot(), requirePass: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--require-pass') opts.requirePass = true;
    else if (arg === '--json') opts.json = true;
  }
  return opts;
}

function round1(v) {
  return v == null ? null : Number(v.toFixed(1));
}

function timingStats(rows, field) {
  const values = rows
    .map((r) => r.timing?.[field])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  return {
    count: values.length,
    p50: round1(percentile(values, 50)),
    p95: round1(percentile(values, 95)),
    p99: round1(percentile(values, 99)),
    max: values.length ? round1(Math.max(...values)) : null,
  };
}

function timingCoverage(rows, field) {
  const populated = rows.filter((row) => {
    const value = row.timing?.[field];
    return value !== null && value !== undefined;
  }).length;
  return { populated, total: rows.length, rate: rows.length ? populated / rows.length : 0 };
}

function wallMs(row) {
  const wall = row?.timing?.wall_total_ms;
  if (Number.isFinite(Number(wall))) return Number(wall);
  return typeof row?.rag_total_ms === 'number' ? row.rag_total_ms : null;
}

function attributeOutlier(row) {
  const wall = wallMs(row);
  if (wall == null) return { wall, dominant: null, share: null };
  const components = [
    ['coordinator_wait_ms', row.timing?.coordinator_wait_ms],
    ['window_reset_ms', row.timing?.window_reset_ms],
    ['curl_time_total_ms', row.timing?.curl_time_total_ms],
    ['rag_total_ms', row.timing?.rag_total_ms ?? row.rag_total_ms],
    ['server_timing_rag_total_ms', row.timing?.server_timing_rag_total_ms],
    ['kpi_query_write_ms', row.timing?.kpi_query_write_ms],
    ['retry_delay_ms', row.timing?.retry_delay_ms],
    ['probe_gap_since_previous_ms', row.timing?.probe_gap_since_previous_ms],
    ['event_loop_delay_ms', row.timing?.event_loop_delay_ms],
    ['unattributed_ms', row.timing?.unattributed_ms],
  ].filter(([, v]) => typeof v === 'number' && v > 0);
  if (!components.length) return { wall, dominant: null, share: null };
  const [dominant, value] = components.sort((a, b) => b[1] - a[1])[0];
  return { wall, dominant, share: wall > 0 ? value / wall : null, dominant_ms: value };
}

export function classifyRcaOutcome(rows, gates) {
  if (gates.status !== 'PASS') {
    return { outcome: 'BLOCKED', reason: 'quality gates failed' };
  }
  const maxWall = Math.max(...rows.map((r) => wallMs(r) ?? 0), 0);
  const maxCurl = Math.max(
    ...rows.map((r) => r.timing?.curl_time_total_ms ?? 0).filter((v) => typeof v === 'number'),
    0,
  );
  const maxRag = Math.max(
    ...rows.map((r) => r.timing?.rag_total_ms ?? r.rag_total_ms ?? 0).filter((v) => typeof v === 'number'),
    0,
  );
  const tierMax = Math.max(maxWall, maxCurl, maxRag);

  if (tierMax < RCA_NOT_REPRODUCED_THRESHOLD_MS) {
    return {
      outcome: 'RCA_NOT_REPRODUCED_FULL_SOAK',
      max_wall_ms: maxWall,
      max_curl_ms: maxCurl,
      max_rag_ms: maxRag,
    };
  }

  const topRow = [...rows].sort((a, b) => (wallMs(b) ?? 0) - (wallMs(a) ?? 0))[0];
  const attribution = attributeOutlier(topRow);
  if (tierMax >= RCA_OUTLIER_THRESHOLD_MS && attribution.share >= RCA_ATTRIBUTION_SHARE) {
    return {
      outcome: 'RCA_REPRODUCED_ATTRIBUTED',
      max_wall_ms: maxWall,
      max_curl_ms: maxCurl,
      max_rag_ms: maxRag,
      top_outlier: {
        probe_id: topRow?.probe_id,
        protocol_label: topRow?.protocol_label,
        attribution,
      },
    };
  }
  if (tierMax >= RCA_OUTLIER_THRESHOLD_MS) {
    return {
      outcome: 'RCA_REPRODUCED_UNATTRIBUTED',
      max_wall_ms: maxWall,
      max_curl_ms: maxCurl,
      max_rag_ms: maxRag,
      top_outlier: {
        probe_id: topRow?.probe_id,
        protocol_label: topRow?.protocol_label,
        attribution,
      },
    };
  }
  return {
    outcome: 'RCA_NOT_REPRODUCED_FULL_SOAK',
    max_wall_ms: maxWall,
    max_curl_ms: maxCurl,
    max_rag_ms: maxRag,
    note: 'tier-1 outlier not reached; below 300000ms attribution threshold',
  };
}

export function buildPhase32gReport(root) {
  if (!fs.existsSync(root)) {
    return {
      status: 'IN_PROGRESS',
      phase: '32G',
      evidence_label: PHASE32G_EVIDENCE_LABEL,
      matrix_total: `0/${MATRIX_TARGET.total}`,
      gates: { http200: 0, wrong_gate_count: 0, fallback_count: 0, leakage_failures: 0 },
      timing_population: { timing: { rate: 0, total: 0, populated: 0 } },
      latency_by_protocol: {},
      maxima: {},
      forbidden_field_violations: 0,
      rca_outcome: 'IN_PROGRESS',
      production_enablement: 'NOT APPROVED',
    };
  }
  const rows = mergeRows(root);
  const gates = summarizeMatrixRows(rows, {
    targetPerProtocol: MATRIX_TARGET.perProtocol,
    targetTotal: MATRIX_TARGET.total,
    evidenceLabel: PHASE32G_EVIDENCE_LABEL,
  });

  let forbidden = 0;
  for (const row of rows) {
    try {
      assertRedactedProbeRow(row);
    } catch {
      forbidden += 1;
    }
  }

  const byProtocol = {};
  for (const proto of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const subset = rows.filter((r) => r.protocol_label === proto);
    byProtocol[proto] = {
      count: subset.length,
      wall: timingStats(subset, 'wall_total_ms'),
      curl: timingStats(subset, 'curl_time_total_ms'),
      server_rag: timingStats(subset, 'server_timing_rag_total_ms'),
      rag: timingStats(subset, 'rag_total_ms'),
    };
  }

  const timingPopulation = Object.fromEntries(
    ['timing', 'wall_total_ms', 'curl_time_total_ms', 'server_timing_rag_total_ms'].map((key) => {
      if (key === 'timing') {
        const rate = rows.length
          ? rows.filter((r) => r.timing && typeof r.timing === 'object').length / rows.length
          : 0;
        return [key, { populated: Math.round(rate * rows.length), total: rows.length, rate }];
      }
      return [key, timingCoverage(rows, key)];
    }),
  );

  const rca = classifyRcaOutcome(rows, gates);
  const topOutliers = [...rows]
    .sort((a, b) => (wallMs(b) ?? 0) - (wallMs(a) ?? 0))
    .slice(0, 20)
    .map((row) => ({
      probe_id: row.probe_id,
      protocol_label: row.protocol_label,
      case_id: row.case_id,
      window: row.window,
      run: row.run,
      wall_total_ms: wallMs(row),
      timing: row.timing,
      attribution: attributeOutlier(row),
    }));

  const maxima = {
    event_loop_delay_ms: timingStats(rows, 'event_loop_delay_ms').max,
    coordinator_wait_ms: timingStats(rows, 'coordinator_wait_ms').max,
    window_reset_ms: timingStats(rows, 'window_reset_ms').max,
    retry_delay_ms: timingStats(rows, 'retry_delay_ms').max,
    kpi_query_write_ms: timingStats(rows, 'kpi_query_write_ms').max,
    jsonl_flush_ms: timingStats(rows, 'jsonl_flush_ms').max,
    unattributed_ms: timingStats(rows, 'unattributed_ms').max,
  };

  let status = 'IN_PROGRESS';
  if (gates.matrix_total === `${MATRIX_TARGET.total}/${MATRIX_TARGET.total}` && gates.status === 'PASS') {
    status = rca.outcome === 'BLOCKED' ? 'BLOCKED' : 'PASS';
  } else if (rows.length >= MATRIX_TARGET.total && gates.status !== 'PASS') {
    status = 'BLOCKED';
  }

  const timingFieldCoverage = Object.fromEntries(
    TIMING_FIELDS.map((field) => [field, timingCoverage(rows, field)]),
  );

  return {
    status,
    phase: '32G',
    evidence_label: PHASE32G_EVIDENCE_LABEL,
    matrix_total: gates.matrix_total,
    gates,
    timing_population: timingPopulation,
    timing_field_coverage: timingFieldCoverage,
    latency_by_protocol: byProtocol,
    maxima,
    forbidden_field_violations: forbidden,
    rca_outcome: rca.outcome,
    rca,
    top_outliers: topOutliers,
    production_enablement: 'NOT APPROVED',
    production_ready_claim: false,
    max_outlier_explained: rca.outcome === 'RCA_REPRODUCED_ATTRIBUTED',
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildPhase32gReport(opts.in);
  fs.writeFileSync(
    path.join(opts.in, 'phase32g-summary.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  const payload = opts.json
    ? report
    : {
        status: report.status,
        matrix_total: report.matrix_total,
        rca_outcome: report.rca_outcome,
        timing_population: report.timing_population,
        maxima: report.maxima,
      };
  console.log(JSON.stringify(payload, null, 2));

  if (opts.requirePass) {
    if (report.status === 'IN_PROGRESS') return 2;
    if (report.status !== 'PASS') return 1;
    if (report.forbidden_field_violations > 0) return 1;
    if (report.timing_population.timing.rate < 1) return 1;
    if (report.timing_population.wall_total_ms.rate < 1) return 1;
    if (report.timing_population.curl_time_total_ms.rate < 1) return 1;
    if (report.production_ready_claim) return 1;
  }
  return report.status === 'PASS' ? 0 : report.status === 'IN_PROGRESS' ? 2 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
