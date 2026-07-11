#!/usr/bin/env node
/**
 * Phase 32H-R1F — causal A/B comparison between baseline and caffeinate arms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import { buildPhase32hSummary } from './lib/phase32h-targeted-summary.mjs';
import {
  R1_BASELINE_ROOT,
  R1_COMPARISON_ROOT,
  R1_PROTECTED_ROOT,
  R1_TOTAL,
} from './lib/phase32h-r1-config.mjs';

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function latencyStats(rows, field) {
  const values = rows.map((r) => r.timing?.[field]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return {
    count: values.length,
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    p999: percentile(values, 99.9),
    max: values.length ? values[values.length - 1] : null,
    tail_rows_p99: Math.max(1, Math.ceil(values.length * 0.01)),
    tail_rows_p999: Math.max(1, Math.ceil(values.length * 0.001)),
  };
}

function loadArmRows(root) {
  const rows = [];
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(root, `shard-${shard}`, 'phase32h-matrix.jsonl');
    if (fs.existsSync(file)) rows.push(...loadJsonl(file));
  }
  return rows;
}

function loadDiscontinuities(root) {
  const file = path.join(root, 'telemetry/phase32h-host-discontinuities.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function detectSynchronizedClusters(rows) {
  const extremes = rows.filter((r) => (r.timing?.wall_total_ms || 0) >= 60_000);
  const clusters = [];
  for (const row of extremes) {
    const start = Date.parse(row.timing?.probe_started_at || row.timing?.wall_started_at || 0);
    const bucket = Math.floor(start / 60_000);
    let cluster = clusters.find((c) => c.bucket === bucket);
    if (!cluster) {
      cluster = { bucket, protocols: new Set(), probes: [] };
      clusters.push(cluster);
    }
    cluster.protocols.add(row.protocol_label || row.matrix_protocol);
    cluster.probes.push({
      id: row.probe_id,
      protocol: row.protocol_label || row.matrix_protocol,
      wall: row.timing?.wall_total_ms,
    });
  }
  return clusters
    .map((c) => ({
      count: c.probes.length,
      protocols: [...c.protocols],
      all_three_protocols: c.protocols.size >= 3,
      probes: c.probes,
    }))
    .filter((c) => c.count >= 2);
}

function decideRootCause(baseline, protectedArm) {
  const baselineClusters = detectSynchronizedClusters(baseline.rows);
  const protectedClusters = detectSynchronizedClusters(protectedArm.rows).filter((c) => c.all_three_protocols);
  const baselineSync = baselineClusters.filter((c) => c.all_three_protocols);
  const protectedDisc = protectedArm.discontinuities;
  const baselineDisc = baseline.discontinuities;

  if (
    baselineSync.length > 0 &&
    protectedClusters.length === 0 &&
    baseline.rows.length >= R1_TOTAL * 0.95 &&
    protectedArm.rows.length >= R1_TOTAL * 0.95
  ) {
    return {
      status: 'CONFIRMED',
      decision: 'A',
      label: 'HOST_SLEEP_OR_SUSPEND',
      reason: 'baseline reproduced synchronized stalls; protected arm did not',
    };
  }
  if (baselineSync.length === 0 && protectedClusters.length === 0 && baseline.rows.length >= R1_TOTAL) {
    return {
      status: 'UNRESOLVED',
      decision: 'E',
      label: 'FULL_SOAK_REQUIRED',
      reason: 'neither arm reproduced synchronized extremes with complete evidence',
    };
  }
  if (baselineDisc?.status === 'FLAGGED' && baselineSync.length > 0) {
    return {
      status: 'PARTIAL',
      decision: 'D',
      label: 'UNRESOLVED',
      reason: 'synchronized stalls with telemetry discontinuities but incomplete direct sleep/wake proof',
    };
  }
  return {
    status: 'PARTIAL',
    decision: 'D',
    label: 'UNRESOLVED',
    reason: 'inconclusive A/B evidence',
  };
}

function summarizeArm(root, label) {
  const rows = loadArmRows(root);
  const summary = buildPhase32hSummary(root, rows);
  const extremes = rows.filter((r) => (r.timing?.wall_total_ms || 0) >= 60_000);
  return {
    root,
    label,
    rows_total: rows.length,
    summary_status: summary.status,
    extremes: extremes.length,
    synchronized_clusters: detectSynchronizedClusters(rows),
    latency: {
      wall: latencyStats(rows, 'wall_total_ms'),
      request_to_first_byte: latencyStats(rows, 'curl_time_starttransfer_ms'),
      server_rag: latencyStats(rows, 'server_timing_rag_total_ms'),
      retrieval: latencyStats(rows, 'server_timing_retrieval_total_ms'),
      coordinator_wait: latencyStats(rows, 'coordinator_wait_ms'),
      probe_gap: latencyStats(rows, 'probe_gap_ms'),
      event_loop_delay: latencyStats(rows, 'event_loop_delay_ms'),
    },
    discontinuities: loadDiscontinuities(root),
    collector_coverage: fs.existsSync(path.join(root, 'phase32h-blocked-run-collector-coverage.json'))
      ? JSON.parse(fs.readFileSync(path.join(root, 'phase32h-blocked-run-collector-coverage.json'), 'utf8'))
      : fs.existsSync(path.join(root, 'run-state/collector-supervisor.json'))
        ? JSON.parse(fs.readFileSync(path.join(root, 'run-state/collector-supervisor.json'), 'utf8'))
        : null,
  };
}

function main() {
  fs.mkdirSync(R1_COMPARISON_ROOT, { recursive: true });
  const baseline = summarizeArm(R1_BASELINE_ROOT, 'baseline');
  const protectedArm = summarizeArm(R1_PROTECTED_ROOT, 'protected');

  const powerCorrelation = {
    baseline_discontinuities: baseline.discontinuities,
    protected_discontinuities: protectedArm.discontinuities,
    baseline_extremes: baseline.extremes,
    protected_extremes: protectedArm.extremes,
    baseline_sync_clusters: baseline.synchronized_clusters.filter((c) => c.all_three_protocols).length,
    protected_sync_clusters: protectedArm.synchronized_clusters.filter((c) => c.all_three_protocols).length,
    caffeinate: fs.existsSync(path.join(R1_PROTECTED_ROOT, 'power/caffeinate-assertion.json'))
      ? JSON.parse(fs.readFileSync(path.join(R1_PROTECTED_ROOT, 'power/caffeinate-assertion.json'), 'utf8'))
      : null,
  };

  const verdict = decideRootCause(baseline, protectedArm);
  const comparison = {
    generated_at: new Date().toISOString(),
    baseline,
    protected: protectedArm,
    verdict,
    production_enablement: 'NOT APPROVED',
  };

  const paths = {
    baseline_summary: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-baseline-summary.json'),
    protected_summary: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-protected-summary.json'),
    power_correlation: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-power-correlation.json'),
    process_correlation: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-process-correlation.json'),
    pcap_correlation: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-pcap-correlation.json'),
    ab_comparison: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-ab-comparison.json'),
    root_cause_verdict: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-root-cause-verdict.json'),
    final_report: path.join(R1_COMPARISON_ROOT, 'phase32h-r1-final-report.md'),
  };

  fs.writeFileSync(paths.baseline_summary, `${JSON.stringify(baseline, null, 2)}\n`);
  fs.writeFileSync(paths.protected_summary, `${JSON.stringify(protectedArm, null, 2)}\n`);
  fs.writeFileSync(paths.power_correlation, `${JSON.stringify(powerCorrelation, null, 2)}\n`);
  fs.writeFileSync(paths.process_correlation, `${JSON.stringify({ baseline: baseline.collector_coverage, protected: protectedArm.collector_coverage }, null, 2)}\n`);
  fs.writeFileSync(
    paths.pcap_correlation,
    `${JSON.stringify({
      baseline_pcap: path.join(R1_BASELINE_ROOT, 'pcap/pcap-sha256-manifest.json'),
      protected_pcap: path.join(R1_PROTECTED_ROOT, 'pcap/pcap-sha256-manifest.json'),
    }, null, 2)}\n`,
  );
  fs.writeFileSync(paths.ab_comparison, `${JSON.stringify(comparison, null, 2)}\n`);
  fs.writeFileSync(
    paths.root_cause_verdict,
    `${JSON.stringify({ ...verdict, production_enablement: 'NOT APPROVED' }, null, 2)}\n`,
  );
  fs.writeFileSync(
    paths.final_report,
    [
      '# Phase 32H-R1 Host Suspension Validation',
      '',
      `Generated: ${comparison.generated_at}`,
      '',
      `## Verdict: ${verdict.label} (${verdict.status})`,
      '',
      verdict.reason,
      '',
      'Production enablement: NOT APPROVED',
      '',
    ].join('\n'),
  );

  console.log(JSON.stringify({ paths, verdict }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
