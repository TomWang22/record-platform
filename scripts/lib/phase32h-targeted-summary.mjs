/**
 * Phase 32H — targeted reproduction summary helpers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { percentile, summarizeMatrixRows } from './phase31-controlled-matrix-summary.mjs';
import {
  PHASE32H_EVIDENCE_LABEL,
  TARGET_PER_PROTOCOL,
  TARGET_TOTAL,
  EXTREME_THRESHOLD_MS,
} from './phase32h-targeted-reproduction-config.mjs';
import { assertRedactedInflightRecord } from './phase32h-inflight-probe-registry.mjs';

export function loadShardRows(outRoot) {
  const rows = [];
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase32h-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

export function timingStats(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return {
    count: xs.length,
    p50: percentile(xs, 50),
    p75: percentile(xs, 75),
    p90: percentile(xs, 90),
    p95: percentile(xs, 95),
    p99: percentile(xs, 99),
    p999: xs.length >= 1000 ? percentile(xs, 99.9) : null,
    p9999: xs.length >= 10000 ? percentile(xs, 99.99) : null,
    max: xs.length ? Math.max(...xs) : null,
  };
}

export function buildPhase32hSummary(outRoot, rows = loadShardRows(outRoot)) {
  const gates = summarizeMatrixRows(rows, {
    targetTotal: TARGET_TOTAL,
    targetPerProtocol: TARGET_PER_PROTOCOL,
    evidenceLabel: PHASE32H_EVIDENCE_LABEL,
  });
  const byProtocol = {};
  for (const proto of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const subset = rows.filter((r) => r.protocol_label === proto);
    byProtocol[proto] = {
      count: subset.length,
      wall_total_ms: timingStats(subset.map((r) => r.timing?.wall_total_ms)),
      curl_time_total_ms: timingStats(subset.map((r) => r.timing?.curl_time_total_ms)),
      server_timing_rag_total_ms: timingStats(
        subset.map((r) => r.timing?.server_timing_rag_total_ms),
      ),
    };
  }
  const extremes = rows.filter(
    (r) => (r.timing?.wall_total_ms ?? 0) >= EXTREME_THRESHOLD_MS,
  );
  let status = 'IN_PROGRESS';
  if (gates.matrix_total === `${TARGET_TOTAL}/${TARGET_TOTAL}` && gates.status === 'PASS') {
    status = extremes.length ? 'PASS_WITH_EXTREMES' : 'PASS';
  } else if (rows.length >= TARGET_TOTAL && gates.status !== 'PASS') {
    status = 'BLOCKED';
  }
  return {
    status,
    phase: '32H',
    evidence_label: PHASE32H_EVIDENCE_LABEL,
    matrix_total: gates.matrix_total,
    gates,
    per_protocol: byProtocol,
    extreme_count: extremes.length,
    production_enablement: 'NOT APPROVED',
  };
}

export function writePhase32hSummary(outRoot, summary) {
  const jsonPath = path.join(outRoot, 'phase32h-targeted-summary.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return jsonPath;
}

export function scanPrivateFields(rows) {
  let violations = 0;
  for (const row of rows) {
    try {
      assertRedactedInflightRecord(row);
    } catch {
      violations += 1;
    }
  }
  return { pass: violations === 0, violations };
}
