/**
 * Phase 32H — deterministic smoke collector teardown (finally/trap equivalent).
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
import { readCollectorRegistry } from './phase32h-collector-registry.mjs';
import { readCorrelationQueueSnapshot } from './phase32h-correlation-queue.mjs';

export function stopSmokeCollectors(outRoot, { repoRoot, gracefulMs = 10_000 } = {}) {
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

export function finalizeSmokeWithFreeze(outRoot, {
  repoRoot,
  pass = false,
  hashManifestName,
  hashExcludeSuffixes = [],
  markerName = 'FROZEN_PASS_EVIDENCE',
  markerContent,
  jsonlPaths = [],
  gracefulMs = 10_000,
  quietPeriodMs = Number(process.env.PHASE32H_FREEZE_QUIET_MS || 5000),
} = {}) {
  const registry = readCollectorRegistry(outRoot);
  const queue = readCorrelationQueueSnapshot(outRoot);
  const cleanup = stopSmokeCollectors(outRoot, { repoRoot, gracefulMs });
  const queueTerminal =
    queue.pending_count === 0 && queue.running_count === 0 && queue.failed_count === 0;
  // Freeze both PASS and BLOCKED terminal outcomes once writers are stopped.
  // Marker is derived solely from pass — never FROZEN_PASS for a failed run.
  const resolvedMarker = pass ? 'FROZEN_PASS_EVIDENCE' : 'FROZEN_BLOCKED_EVIDENCE';
  if (markerName && markerName !== resolvedMarker) {
    // Prefer pass-derived marker; caller mismatch is ignored for fail-closed safety.
  }
  const freezeReady = Boolean(cleanup.zero_root_scoped && queueTerminal);
  let freeze = null;
  if (freezeReady) {
    freeze = executeFreezeIntegrity({
      outRoot,
      repoRoot,
      quietPeriodMs,
      gracefulMs,
      hashManifestName,
      hashExcludeSuffixes,
      markerName: resolvedMarker,
      markerContent,
      jsonlPaths,
      writersAlreadyStopped: true,
    });
  }
  return {
    cleanup,
    freeze,
    freezeReady,
    queue_terminal: queueTerminal,
    collector_registry_present: Boolean(registry?.collectors?.pcap_collector),
    post_smoke_processes: cleanup.remaining_processes.length,
    marker_name: freezeReady ? resolvedMarker : null,
    status: pass ? 'PASS' : 'BLOCKED',
  };
}

export async function withSmokeCollectorCleanup(outRoot, fn, opts = {}) {
  try {
    return await fn();
  } finally {
    if (!opts.skipCleanup) {
      stopSmokeCollectors(outRoot, opts);
    }
  }
}
