import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { spawn } from 'node:child_process';
import {
  FREEZE_INTEGRITY_BLOCKED,
  assertWritableEvidenceRoot,
  buildHistoricalFreezeMismatchReport,
  classifyProcessForFreeze,
  diffSnapshots,
  executeFreezeIntegrity,
  isFrozenRoot,
  listRootScopedProcesses,
  roleForCommand,
  snapshotFileMetadata,
  stopWritersForRoot,
  verifyZeroWriters,
  waitForOpenFilesQuiescence,
  waitQuietPeriod,
} from '../scripts/lib/phase32h-freeze-integrity.mjs';

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-freeze-'));
  fs.mkdirSync(path.join(root, 'shard-h1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shard-h1', 'phase32h-matrix.jsonl'), '{"probe_id":1}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'phase32h-monitor.log'), 'seed\n', 'utf8');
  return root;
}

describe('phase32h freeze integrity', () => {
  let root;

  beforeEach(() => {
    root = mkRoot();
  });

  afterEach(() => {
    try {
      for (const proc of listRootScopedProcesses(root)) {
        try {
          process.kill(proc.pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('classifies matrix monitor bash loop as matrix_monitor', () => {
    const cmd = `bash -c 'exec >>"${root}/phase32h-monitor.log" 2>&1; while true; do scripts/phase32h-monitor-targeted-reproduction.sh; sleep 5; done'`;
    assert.equal(roleForCommand(cmd), 'matrix_monitor');
  });

  it('freeze CLI argv containing root is not a writer', () => {
    const cmd = `node scripts/phase32h-freeze-baseline-r7-blocked.mjs --out ${root}`;
    assert.equal(roleForCommand(cmd), null);
    assert.equal(classifyProcessForFreeze(root, { pid: 1, command: cmd }).is_known_writer, false);
  });

  it('shell echo with root path is not a writer', () => {
    const cmd = `bash -c 'echo hello ${root}/shard-h1/phase32h-matrix.jsonl'`;
    assert.equal(roleForCommand(cmd), null);
    assert.equal(listRootScopedProcesses(root).length, 0);
  });

  it('node status CLI with root is not a writer', () => {
    const cmd = `node scripts/phase32h-runtime-status-readonly.mjs --out ${root}`;
    assert.equal(roleForCommand(cmd), null);
    assert.equal(classifyProcessForFreeze(root, { pid: 2, command: cmd }).is_known_writer, false);
  });

  it('dumpcap command is classified as pcap_collector writer', () => {
    const cmd = `dumpcap -i en0 -w ${root}/pcap/segment-001.pcapng`;
    assert.equal(roleForCommand(cmd), 'pcap_collector');
    assert.equal(classifyProcessForFreeze(root, { pid: 3, command: cmd }).is_known_writer, true);
  });

  it('monitor still writing blocks freeze via quiet period', async () => {
    const child = spawn('bash', ['-c', `while true; do echo tick >> "${root}/phase32h-monitor.log"; sleep 0.02; done`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      assert.throws(
        () =>
          executeFreezeIntegrity({
            outRoot: root,
            quietPeriodMs: 300,
            hashManifestName: 'freeze-sha256.txt',
            hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE'],
            markerName: 'FROZEN_BLOCKED_EVIDENCE',
            markerContent: 'blocked\n',
            jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
            writersAlreadyStopped: true,
          }),
        (err) => err.code === FREEZE_INTEGRITY_BLOCKED,
      );
    } finally {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  });

  it('checkpoint loop mutation during quiet period blocks freeze', async () => {
    const checkpoint = path.join(root, 'run-state', 'checkpoint.json');
    fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
    fs.writeFileSync(checkpoint, '{}\n', 'utf8');
    const child = spawn('bash', ['-c', `while true; do date >> "${checkpoint}"; sleep 0.01; done`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      let quiet = waitQuietPeriod(root, { quietPeriodMs: 400 });
      if (quiet.pass) {
        // Retry once under load — writer must still be mutating.
        await new Promise((resolve) => setTimeout(resolve, 50));
        quiet = waitQuietPeriod(root, { quietPeriodMs: 400 });
      }
      assert.equal(quiet.pass, false);
      assert.ok(quiet.files_changed_during_quiet_period.length > 0);
    } finally {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  });

  it('launcher processes are not treated as stoppable writers', () => {
    const cmd = `node scripts/phase32h-r1-collector-exclusivity-smoke.mjs --out ${root}`;
    assert.equal(roleForCommand(cmd), null);
  });

  it('waitForOpenFilesQuiescence passes when no handles remain', () => {
    const check = waitForOpenFilesQuiescence(root, { maxWaitMs: 500 });
    assert.equal(check.pass, true);
  });

  it('hash manifest is written after writers stop on clean root', () => {
    const result = executeFreezeIntegrity({
      outRoot: root,
      quietPeriodMs: 50,
      gracefulMs: 500,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE'],
      markerName: 'FROZEN_BLOCKED_EVIDENCE',
      markerContent: 'blocked\n',
      jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.hash_manifest_written, true);
    assert.equal(result.marker_written_last, true);
    assert.equal(result.writers_remaining, 0);
    assert.ok(fs.existsSync(path.join(root, 'freeze-sha256.txt')));
    assert.ok(isFrozenRoot(root));
  });

  it('frozen marker is the final filesystem mutation', () => {
    const result = executeFreezeIntegrity({
      outRoot: root,
      quietPeriodMs: 50,
      gracefulMs: 500,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE'],
      markerName: 'FROZEN_BLOCKED_EVIDENCE',
      markerContent: 'blocked\n',
      jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
    });
    assert.equal(result.marker_written_last, true);
  });

  it('post-marker append is rejected', () => {
    executeFreezeIntegrity({
      outRoot: root,
      quietPeriodMs: 50,
      gracefulMs: 500,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE'],
      markerName: 'FROZEN_BLOCKED_EVIDENCE',
      markerContent: 'blocked\n',
      jsonlPaths: [path.join(root, 'shard-h1', 'phase32h-matrix.jsonl')],
    });
    assert.throws(
      () => assertWritableEvidenceRoot(root, path.join(root, 'phase32h-monitor.log')),
      (err) => err.code === FREEZE_INTEGRITY_BLOCKED,
    );
  });

  it('JSONL is never modified by freeze on clean shutdown', () => {
    const jsonl = path.join(root, 'shard-h1', 'phase32h-matrix.jsonl');
    const before = fs.readFileSync(jsonl, 'utf8');
    const result = executeFreezeIntegrity({
      outRoot: root,
      quietPeriodMs: 50,
      gracefulMs: 500,
      hashManifestName: 'freeze-sha256.txt',
      hashExcludeSuffixes: ['freeze-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE'],
      markerName: 'FROZEN_BLOCKED_EVIDENCE',
      markerContent: 'blocked\n',
      jsonlPaths: [jsonl],
    });
    const after = fs.readFileSync(jsonl, 'utf8');
    assert.equal(before, after);
    assert.equal(result.jsonl_modified, false);
  });

  it('historical mismatch is reported, not repaired', () => {
    const report = buildHistoricalFreezeMismatchReport({
      root: '/tmp/phase32h-r1-baseline-r2',
      mismatchedPath: '/tmp/phase32h-r1-baseline-r2/phase32h-monitor.log',
      expectedSha: 'a4c3497877caf7a935cf42f74a27b55838eff4fd750ff6e8830c575b47ee4270',
      observedSha: '681e76bfb417768a214b58b69bb0055fc1795bacdcecd7a9858e27246226c2b4',
      freezeTimestamp: '2026-07-12T16:44:46.005Z',
      finalMtime: '2026-07-12T17:15:16.000Z',
      writerResponsible: 'matrix_monitor bash loop (phase32h-monitor.log redirect)',
      jsonlHashStatus: 'ALL_JSONL_OK',
    });
    assert.equal(report.historical_evidence_modified, false);
    assert.equal(report.classification, 'FREEZE_INTEGRITY_PARTIAL');
    assert.match(report.statement, /not repaired/i);
  });

  it('diffSnapshots detects size and mtime changes', () => {
    const file = path.join(root, 'phase32h-monitor.log');
    const before = snapshotFileMetadata(root);
    fs.appendFileSync(file, 'more\n', 'utf8');
    const after = snapshotFileMetadata(root);
    const changed = diffSnapshots(before, after);
    assert.ok(changed.includes(file));
  });

  it('verifyZeroWriters passes on clean root', () => {
    const check = verifyZeroWriters(root);
    assert.equal(check.pass, true);
    assert.equal(check.writers_remaining, 0);
  });

  it('stopWritersForRoot is idempotent on empty root', () => {
    const ledger = stopWritersForRoot(root, { gracefulMs: 200 });
    assert.ok(Array.isArray(ledger));
  });
});

describe('phase32h esm readiness incident metadata', () => {
  it('records redacted ESM incident metadata', async () => {
    const { ESM_INCIDENT } = await import('../scripts/phase32h-record-readiness-esm-incident.mjs');
    assert.equal(ESM_INCIDENT.replacement_cli, 'scripts/phase32h-launch-package-readonly.mjs');
    assert.equal(ESM_INCIDENT.output_consumed, false);
    assert.equal(ESM_INCIDENT.failure_ignored, false);
    assert.match(ESM_INCIDENT.stderr_signature, /ERR_EVAL_ESM_CANNOT_PRINT/);
  });
});
