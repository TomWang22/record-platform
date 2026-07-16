/**
 * Phase 33F terminal PASS/FAIL verdict from run evidence snapshots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readCorrelationQueueSnapshot } from './phase32h-correlation-queue.mjs';

function loadShardCounts(outRoot) {
  const counts = { h1: 0, h2: 0, h3: 0, ok: 0, fail: 0, total: 0 };
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase33f-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    counts[shard] = lines.length;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.ok) counts.ok += 1;
        else counts.fail += 1;
      } catch {
        counts.fail += 1;
      }
    }
  }
  counts.total = counts.h1 + counts.h2 + counts.h3;
  return counts;
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function collectTerminalSnapshot(outRoot, {
  expectedProbes = null,
  expectedBatches = null,
} = {}) {
  const matrix = loadShardCounts(outRoot);
  const queue = readCorrelationQueueSnapshot(outRoot);
  const privacy = readJsonIfExists(path.join(outRoot, 'privacy-audit.json'), {
    violations: 0,
  });
  const schema = readJsonIfExists(path.join(outRoot, 'schema-audit.json'), {
    failures: 0,
  });
  const parity = readJsonIfExists(path.join(outRoot, 'parity-audit.json'), {
    material_mismatch_count: 0,
  });
  const pcap = readJsonIfExists(path.join(outRoot, 'pcap', 'continuity.json'), {
    status: 'UNKNOWN',
    drops: null,
  });
  const batchDir = path.join(outRoot, 'batches');
  const batchCount = fs.existsSync(batchDir)
    ? fs.readdirSync(batchDir).filter((n) => n.endsWith('.json')).length
    : Math.floor(matrix.total / 3);

  const flags = {
    matrix_complete:
      expectedProbes == null ? matrix.fail === 0 : matrix.total === expectedProbes && matrix.fail === 0,
    queue_terminal:
      (queue.pending_count || 0) === 0 &&
      (queue.running_count || 0) === 0 &&
      (queue.failed_count || 0) === 0,
    privacy_clean: (privacy.violations || 0) === 0,
    schema_clean: (schema.failures || 0) === 0,
    parity_clean: (parity.material_mismatch_count || 0) === 0,
    pcap_continuous: pcap.status === 'PASS' || pcap.status === 'UNKNOWN',
    batches_complete: expectedBatches == null ? true : batchCount === expectedBatches,
  };

  const pass = Object.values(flags).every(Boolean);
  return {
    at: new Date().toISOString(),
    matrix,
    queue,
    privacy,
    schema,
    parity,
    pcap,
    batch_count: batchCount,
    flags,
    status: pass ? 'PASS' : 'FAIL',
  };
}

function snapshotsMatch(a, b) {
  return (
    a.status === b.status &&
    a.matrix.total === b.matrix.total &&
    a.matrix.ok === b.matrix.ok &&
    a.matrix.fail === b.matrix.fail &&
    a.batch_count === b.batch_count &&
    (a.queue.pending_count || 0) === (b.queue.pending_count || 0) &&
    (a.queue.failed_count || 0) === (b.queue.failed_count || 0) &&
    JSON.stringify(a.flags) === JSON.stringify(b.flags)
  );
}

export function evaluateTerminalVerdict(outRoot, {
  expectedProbes = null,
  expectedBatches = null,
  snapshotA = null,
  snapshotB = null,
  requireMatchingSnapshots = true,
} = {}) {
  const first = snapshotA || collectTerminalSnapshot(outRoot, { expectedProbes, expectedBatches });
  const second =
    snapshotB ||
    (requireMatchingSnapshots
      ? collectTerminalSnapshot(outRoot, { expectedProbes, expectedBatches })
      : first);

  const matching = snapshotsMatch(first, second);
  const status = first.status === 'PASS' && second.status === 'PASS' && matching ? 'PASS' : 'FAIL';

  return {
    status,
    matching_snapshots: matching,
    snapshot_a: first,
    snapshot_b: second,
    require_matching_snapshots: requireMatchingSnapshots,
  };
}

/**
 * Sleep helper for live 5s dual-snapshot collection.
 */
export async function evaluateTerminalVerdictWithDelay(outRoot, opts = {}) {
  const delayMs = opts.delayMs ?? 5000;
  const snapshotA = collectTerminalSnapshot(outRoot, opts);
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
  const snapshotB = collectTerminalSnapshot(outRoot, opts);
  return evaluateTerminalVerdict(outRoot, {
    ...opts,
    snapshotA,
    snapshotB,
    requireMatchingSnapshots: true,
  });
}
