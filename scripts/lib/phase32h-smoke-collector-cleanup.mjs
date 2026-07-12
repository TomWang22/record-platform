/**
 * Phase 32H — deterministic smoke collector teardown (finally/trap equivalent).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { listRootScopedProcesses, stopWritersForRoot } from './phase32h-freeze-integrity.mjs';

export function stopSmokeCollectors(outRoot, { repoRoot, gracefulMs = 10_000 } = {}) {
  const ledger = stopWritersForRoot(outRoot, { gracefulMs });
  if (repoRoot) {
    spawnSync('bash', [path.join(repoRoot, 'scripts/phase32h-stop-pcap-capture.sh'), outRoot], {
      cwd: repoRoot,
    });
  }
  const remaining = listRootScopedProcesses(outRoot).filter((p) => p.pid !== process.pid);
  return {
    stopped_at: new Date().toISOString(),
    ledger,
    remaining_processes: remaining,
    zero_root_scoped: remaining.length === 0,
  };
}

export async function withSmokeCollectorCleanup(outRoot, fn, opts = {}) {
  try {
    return await fn();
  } finally {
    stopSmokeCollectors(outRoot, opts);
  }
}
