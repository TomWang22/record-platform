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
import { R1_EVIDENCE_LABEL_BASELINE, R1_EVIDENCE_LABEL_PROTECTED, R1_PER_PROTOCOL, R1_TOTAL } from './phase32h-r1-config.mjs';
import { assertRedactedInflightRecord } from './phase32h-inflight-probe-registry.mjs';
import {
  extractCurlTotalMs,
  extractProtocol,
  extractServerRagTotalMs,
  extractWallTotalMs,
} from './phase32h-matrix-row-fields.mjs';

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

function resolveSummaryTargets(outRoot, rows) {
  const launchPath = path.join(outRoot, 'phase32h-r1-launch.json');
  if (fs.existsSync(launchPath)) {
    try {
      const launch = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
      if (Number(launch.target_total) > 0 && Number(launch.target_per_protocol) > 0) {
        return {
          targetTotal: Number(launch.target_total),
          targetPerProtocol: Number(launch.target_per_protocol),
          evidenceLabel: launch.evidence_label || rows[0]?.evidence_label || PHASE32H_EVIDENCE_LABEL,
          kind: 'r1_launch',
        };
      }
    } catch {
      // fall through
    }
  }
  const label = rows[0]?.evidence_label || '';
  if (
    label.includes(R1_EVIDENCE_LABEL_BASELINE) ||
    label.includes(R1_EVIDENCE_LABEL_PROTECTED) ||
    /Phase 32H-R1/.test(label)
  ) {
    return {
      targetTotal: R1_TOTAL,
      targetPerProtocol: R1_PER_PROTOCOL,
      evidenceLabel: label || R1_EVIDENCE_LABEL_BASELINE,
      kind: 'r1_label',
    };
  }
  return {
    targetTotal: TARGET_TOTAL,
    targetPerProtocol: TARGET_PER_PROTOCOL,
    evidenceLabel: PHASE32H_EVIDENCE_LABEL,
    kind: 'targeted_17280',
  };
}

function freezeState(outRoot) {
  const pass = fs.existsSync(path.join(outRoot, 'FROZEN_PASS_EVIDENCE'));
  const blocked = fs.existsSync(path.join(outRoot, 'FROZEN_BLOCKED_EVIDENCE'));
  return {
    freeze_complete: pass || blocked,
    frozen_evidence: pass ? 'FROZEN_PASS_EVIDENCE' : blocked ? 'FROZEN_BLOCKED_EVIDENCE' : null,
    frozen_pass: pass,
    frozen_blocked: blocked,
  };
}

export function buildPhase32hSummary(outRoot, rows = loadShardRows(outRoot)) {
  const targets = resolveSummaryTargets(outRoot, rows);
  const freeze = freezeState(outRoot);
  const gates = summarizeMatrixRows(rows, {
    targetTotal: targets.targetTotal,
    targetPerProtocol: targets.targetPerProtocol,
    evidenceLabel: targets.evidenceLabel,
  });
  const byProtocol = {};
  for (const proto of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const subset = rows.filter((r) => extractProtocol(r) === proto);
    byProtocol[proto] = {
      count: subset.length,
      wall_total_ms: timingStats(subset.map((r) => extractWallTotalMs(r))),
      curl_time_total_ms: timingStats(subset.map((r) => extractCurlTotalMs(r))),
      server_timing_rag_total_ms: timingStats(subset.map((r) => extractServerRagTotalMs(r))),
    };
  }
  const extremes = rows.filter((r) => (extractWallTotalMs(r) ?? 0) >= EXTREME_THRESHOLD_MS);
  const matrixComplete = gates.matrix_total === `${targets.targetTotal}/${targets.targetTotal}`;
  let status = 'IN_PROGRESS';
  if (freeze.frozen_pass && matrixComplete && gates.status === 'PASS') {
    status = extremes.length ? 'PASS_WITH_EXTREMES' : 'PASS';
  } else if (matrixComplete && gates.status === 'PASS') {
    status = extremes.length ? 'PASS_WITH_EXTREMES' : 'PASS';
  } else if (rows.length >= targets.targetTotal && gates.status !== 'PASS') {
    status = 'BLOCKED';
  } else if (freeze.frozen_blocked) {
    status = 'BLOCKED';
  }

  // Frozen PASS evidence must never retain IN_PROGRESS in final artifacts.
  if (freeze.frozen_pass && status === 'IN_PROGRESS' && matrixComplete) {
    status = 'PASS';
  }

  const phaseStatus = freeze.frozen_pass
    ? 'PASS'
    : freeze.frozen_blocked
      ? 'BLOCKED'
      : status;

  return {
    status,
    phase: '32H',
    phase_status: phaseStatus,
    summary_status_note: status,
    matrix_complete: matrixComplete,
    freeze_complete: freeze.freeze_complete,
    frozen_evidence: freeze.frozen_evidence,
    protected_arm: 'NOT_LAUNCHED',
    evidence_label: targets.evidenceLabel,
    matrix_total: gates.matrix_total,
    target_total: targets.targetTotal,
    target_kind: targets.kind,
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
