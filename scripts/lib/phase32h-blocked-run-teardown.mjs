/**
 * Phase 32H — automatic fail-closed teardown when an immutable runtime block occurs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  executeFreezeIntegrity,
  listRootScopedProcesses,
  stopWritersForRoot,
  waitForOpenFilesQuiescence,
} from './phase32h-freeze-integrity.mjs';
import { isCoverageBlocked } from './phase32h-run-integrity.mjs';

const DEFAULT_GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);

export function stopRootScopedCollectors(outRoot, { repoRoot, gracefulMs = DEFAULT_GRACEFUL_MS } = {}) {
  const ledger = stopWritersForRoot(outRoot, { gracefulMs });
  if (repoRoot) {
    spawnSync('bash', [path.join(repoRoot, 'scripts/phase32h-stop-pcap-capture.sh'), outRoot], {
      cwd: repoRoot,
    });
  }
  const deadline = Date.now() + gracefulMs;
  let remaining = listRootScopedProcesses(outRoot).filter((p) => p.pid !== process.pid);
  while (remaining.length > 0 && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    remaining = listRootScopedProcesses(outRoot).filter((p) => p.pid !== process.pid);
  }
  waitForOpenFilesQuiescence(outRoot, { maxWaitMs: gracefulMs * 2 });
  remaining = listRootScopedProcesses(outRoot).filter((p) => p.pid !== process.pid);
  return {
    stopped_at: new Date().toISOString(),
    ledger,
    remaining_processes: remaining,
    zero_root_scoped: remaining.length === 0,
  };
}

export function teardownBlockedRun(outRoot, {
  repoRoot,
  reason = 'COLLECTOR_COVERAGE_BLOCKED',
  classification = 'BLOCKED',
  hashManifestName = 'phase32h-blocked-sha256.txt',
  markerName = 'FROZEN_BLOCKED_EVIDENCE',
} = {}) {
  if (!outRoot) throw new Error('outRoot required');
  const blockedMarkerPath = path.join(outRoot, 'COLLECTOR_COVERAGE_BLOCKED');
  const blockedMarkerExists = fs.existsSync(blockedMarkerPath);
  const cleanup = stopRootScopedCollectors(outRoot, { repoRoot });
  const alreadyFrozen = fs.existsSync(path.join(outRoot, markerName));
  let freeze = null;
  if (!alreadyFrozen && blockedMarkerExists) {
    freeze = executeFreezeIntegrity({
      outRoot,
      repoRoot,
      quietPeriodMs: Number(process.env.PHASE32H_FREEZE_QUIET_MS || 5000),
      gracefulMs: DEFAULT_GRACEFUL_MS,
      hashManifestName,
      hashExcludeSuffixes: [hashManifestName, markerName, 'FROZEN_PASS_EVIDENCE'],
      markerName,
      markerContent: `${new Date().toISOString()}\n${reason}\n${classification}\n`,
      jsonlPaths: ['h1', 'h2', 'h3'].map((s) => path.join(outRoot, `shard-${s}`, 'phase32h-matrix.jsonl')),
      writersAlreadyStopped: true,
    });
  }
  const report = {
    status: 'BLOCKED',
    reason,
    classification,
    blocked_marker_preserved: blockedMarkerExists,
    blocked_marker_cleared: false,
    cleanup,
    freeze,
    post_teardown_processes: cleanup.remaining_processes.length,
    coverage_blocked: isCoverageBlocked(outRoot),
  };
  const reportPath = path.join(outRoot, 'run-state', 'blocked-run-teardown.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
