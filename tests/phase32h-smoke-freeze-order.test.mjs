import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  FREEZE_INTEGRITY_BLOCKED,
  executeFreezeIntegrity,
  listProcesses,
  listRootScopedProcesses,
  stopWritersForRoot,
  verifyZeroWriters,
} from '../scripts/lib/phase32h-freeze-integrity.mjs';
import {
  finalizeSmokeWithFreeze,
  stopSmokeCollectors,
  withSmokeCollectorCleanup,
} from '../scripts/lib/phase32h-smoke-collector-cleanup.mjs';
import { FROZEN_BLOCKED_MARKER } from '../scripts/lib/phase32h-run-integrity.mjs';
import { CORRELATION_QUEUE_SCHEMA_VERSION } from '../scripts/lib/phase32h-correlation-queue.mjs';

const REPO_ROOT = path.resolve('scripts/..');

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-smoke-freeze-'));
  fs.mkdirSync(path.join(root, 'shard-h1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shard-h1', 'phase32h-matrix.jsonl'), '{"probe_id":1}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'phase32h-monitor.log'), 'seed\n', 'utf8');
  return root;
}

function killRootProcs(root) {
  for (const proc of listProcesses()) {
    if (!proc.command || !proc.command.includes(root)) continue;
    if (proc.pid === process.pid) continue;
    try {
      process.kill(proc.pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  // Also clear known-writer classification path for coverage.
  for (const proc of listRootScopedProcesses(root)) {
    try {
      process.kill(proc.pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

describe('phase32h smoke freeze order', () => {
  let root;

  beforeEach(() => {
    root = mkRoot();
  });

  afterEach(() => {
    killRootProcs(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finalizeSmokeWithFreeze stops collectors before freeze integrity begins', () => {
    const result = finalizeSmokeWithFreeze(root, {
      repoRoot: REPO_ROOT,
      pass: true,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
      markerName: 'FROZEN_PASS_EVIDENCE',
      markerContent: 'pass\n',
      jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
      quietPeriodMs: 50,
      gracefulMs: 500,
    });
    assert.equal(result.cleanup.zero_root_scoped, true);
    assert.equal(result.freeze?.status, 'PASS');
    assert.equal(result.freeze?.hash_manifest_written, true);
    assert.equal(result.freeze?.marker_written_last, true);
  });

  it('monitor still alive causes freeze to fail when pass=true but cleanup incomplete', () => {
    const child = spawn('bash', ['-c', `while true; do echo tick >> "${root}/phase32h-monitor.log"; sleep 0.01; done`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    assert.throws(
      () =>
        executeFreezeIntegrity({
          outRoot: root,
          quietPeriodMs: 200,
          hashManifestName: 'freeze-sha256.txt',
          hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
          markerName: 'FROZEN_PASS_EVIDENCE',
          markerContent: 'pass\n',
          jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
          writersAlreadyStopped: true,
        }),
      (err) => err.code === FREEZE_INTEGRITY_BLOCKED,
    );
    killRootProcs(root);
  });

  it('zero root-scoped processes are required before freeze', () => {
    const result = stopSmokeCollectors(root, { repoRoot: REPO_ROOT, gracefulMs: 200 });
    assert.equal(result.zero_root_scoped, true);
    const writers = verifyZeroWriters(root);
    assert.equal(writers.pass, true);
  });

  it('quiet-period mutation causes freeze failure', () => {
    const checkpoint = path.join(root, 'run-state', 'checkpoint.json');
    fs.writeFileSync(checkpoint, '{}\n', 'utf8');
    const child = spawn('bash', ['-c', `while true; do date >> "${checkpoint}"; sleep 0.02; done`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
    let blocked = false;
    for (let attempt = 0; attempt < 3 && !blocked; attempt += 1) {
      try {
        executeFreezeIntegrity({
          outRoot: root,
          quietPeriodMs: 400,
          hashManifestName: 'freeze-sha256.txt',
          hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
          markerName: 'FROZEN_PASS_EVIDENCE',
          markerContent: 'pass\n',
          jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
          writersAlreadyStopped: true,
        });
      } catch (err) {
        blocked = err.code === FREEZE_INTEGRITY_BLOCKED;
      }
    }
    assert.equal(blocked, true);
    killRootProcs(root);
  });

  it('SHA manifest is written only after collectors stop', () => {
    const result = finalizeSmokeWithFreeze(root, {
      repoRoot: REPO_ROOT,
      pass: true,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
      markerName: 'FROZEN_PASS_EVIDENCE',
      markerContent: 'pass\n',
      jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
      quietPeriodMs: 50,
      gracefulMs: 300,
    });
    assert.equal(result.freeze.hash_manifest_written, true);
    assert.ok(fs.existsSync(path.join(root, 'freeze-sha256.txt')));
  });

  it('frozen marker is the final root mutation', () => {
    const result = finalizeSmokeWithFreeze(root, {
      repoRoot: REPO_ROOT,
      pass: true,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
      markerName: 'FROZEN_PASS_EVIDENCE',
      markerContent: 'pass\n',
      jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
      quietPeriodMs: 50,
      gracefulMs: 300,
    });
    assert.equal(result.freeze.marker_written_last, true);
    assert.ok(fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE')));
  });

  it('withSmokeCollectorCleanup executes stopSmokeCollectors through finally on success', async () => {
    let cleaned = false;
    await withSmokeCollectorCleanup(
      root,
      async () => {
        fs.appendFileSync(path.join(root, 'phase32h-monitor.log'), 'during\n');
        cleaned = false;
      },
      { repoRoot: REPO_ROOT, gracefulMs: 200 },
    );
    cleaned = verifyZeroWriters(root).pass;
    assert.equal(cleaned, true);
  });

  it('withSmokeCollectorCleanup executes stopSmokeCollectors through finally on failure', async () => {
    await assert.rejects(
      withSmokeCollectorCleanup(
        root,
        async () => {
          throw new Error('smoke failed');
        },
        { repoRoot: REPO_ROOT, gracefulMs: 200 },
      ),
    );
    assert.equal(verifyZeroWriters(root).pass, true);
  });

  it('skipCleanup prevents duplicate cleanup in finally', async () => {
    await withSmokeCollectorCleanup(
      root,
      async () => {
        stopSmokeCollectors(root, { repoRoot: REPO_ROOT, gracefulMs: 200 });
        assert.equal(verifyZeroWriters(root).pass, true);
      },
      { repoRoot: REPO_ROOT, skipCleanup: true },
    );
    assert.equal(verifyZeroWriters(root).pass, true);
  });

  it('SIGTERM is attempted before SIGKILL in stop ledger', () => {
    // Perl reliably ignores SIGTERM; short argv keeps dumpcap + outRoot visible in `ps`.
    const child = spawn(
      'perl',
      ['-e', '$SIG{TERM}="IGNORE"; sleep 1 while 1', '--', 'dumpcap', '-w', `${root}/pcap/ring.pcap`],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    const ledger = stopWritersForRoot(root, { gracefulMs: 400 });
    const term = ledger.find((e) => e.signal === 'SIGTERM' && e.pid === child.pid);
    const kill = ledger.find((e) => e.signal === 'SIGKILL' && e.pid === child.pid);
    assert.ok(term, 'SIGTERM must be attempted first');
    assert.ok(kill, 'ignoring SIGTERM should escalate to SIGKILL');
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
  });

  it('immutable frozen evidence is not modified during cleanup', () => {
    fs.writeFileSync(path.join(root, FROZEN_BLOCKED_MARKER), 'blocked\n');
    const before = fs.readFileSync(path.join(root, FROZEN_BLOCKED_MARKER), 'utf8');
    stopSmokeCollectors(root, { repoRoot: REPO_ROOT, gracefulMs: 200 });
    const after = fs.readFileSync(path.join(root, FROZEN_BLOCKED_MARKER), 'utf8');
    assert.equal(before, after);
  });

  it('queue must be terminal before hashing when jobs are pending', () => {
    fs.writeFileSync(
      path.join(root, 'run-state', 'correlation-queue.json'),
      `${JSON.stringify({
        schema_version: CORRELATION_QUEUE_SCHEMA_VERSION,
        run_id: 'test-run',
        launch_head: 'test-head',
        manifest_sha: 'abc',
        jobs: [{ job_id: 'j1', status: 'PENDING', batch_id: 'b1', enqueued_at: new Date().toISOString(), run_id: 'test-run', launch_head: 'test-head', manifest_sha: 'abc' }],
        stats: { pending_count: 1, running_count: 0, complete_count: 0, failed_count: 0, unresolved_count: 1 },
      })}\n`,
    );
    const result = finalizeSmokeWithFreeze(root, {
      repoRoot: REPO_ROOT,
      pass: true,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
      markerName: 'FROZEN_PASS_EVIDENCE',
      markerContent: 'pass\n',
      jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
      quietPeriodMs: 50,
      gracefulMs: 300,
    });
    assert.equal(result.freezeReady, false);
    assert.equal(result.queue_terminal, false);
  });
});
