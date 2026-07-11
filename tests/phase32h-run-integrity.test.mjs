import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  acquireLauncherLock,
  acquireShardLock,
  assertAppendAllowed,
  detectTruncatedJsonl,
  initRunState,
  isCoverageBlocked,
  loadProbeIndex,
  markCoverageBlocked,
  matrixCoordinateKey,
  recordCompletedProbe,
  releaseLock,
  runStatePaths,
  shardLockIsActive,
} from '../scripts/lib/phase32h-run-integrity.mjs';
import { gitSha } from '../scripts/lib/phase22-full-replay-common.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-integrity-'));
}

const LAUNCH_HEAD = gitSha();

describe('phase32h run integrity', () => {
  let root;
  beforeEach(() => {
    root = tempRoot();
    initRunState(root, {
      runId: 'run-test-1',
      launchHead: LAUNCH_HEAD,
      evidenceLabel: 'test-label',
    });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('matrix coordinate includes protocol window user_class user_hash run case_id', () => {
    const key = matrixCoordinateKey({
      matrix_protocol: 'h1',
      window: 3,
      user_class: 'contract_control',
      user_uid: 'uid-1',
      run: 2,
      case_id: 'final_tagged_plan',
    });
    assert.match(key, /^h1\|3\|contract_control\|[a-f0-9]{16}\|2\|final_tagged_plan$/);
  });

  it('rejects second launcher when live lock exists', () => {
    acquireLauncherLock(root, { pid: process.pid, run_id: 'run-test-1', role: 'launcher' });
    assert.throws(
      () => acquireLauncherLock(root, { pid: process.pid + 99999, run_id: 'run-test-2', role: 'launcher' }, { allowStaleRecovery: false }),
      /lock held/,
    );
  });

  it('rejects duplicate protocol runner lock', () => {
    acquireShardLock(root, 'h1', { pid: process.pid, run_id: 'run-test-1', protocol: 'h1' });
    assert.equal(shardLockIsActive(root, 'h1'), true);
    assert.throws(
      () => acquireShardLock(root, 'h1', { pid: process.pid + 1, run_id: 'run-test-1', protocol: 'h1' }, { allowStaleRecovery: false }),
      /lock held/,
    );
  });

  it('recovers stale lock with ledger entry', () => {
    const paths = runStatePaths(root);
    acquireShardLock(root, 'h2', { pid: 999999, run_id: 'stale', protocol: 'h2' });
    const result = acquireShardLock(root, 'h2', { pid: process.pid, run_id: 'run-test-1', protocol: 'h2' });
    assert.equal(result.recovered, true);
    assert.ok(fs.existsSync(paths.staleRecoveryLedger));
    releaseLock(paths.h2Lock);
  });

  it('rejects duplicate probe_id before append', () => {
    const probe = {
      probe_id: 42,
      matrix_protocol: 'h1',
      window: 1,
      user_class: 'contract_control',
      user_uid: 'u1',
      run: 1,
      case_id: 'final_tagged_plan',
    };
    const row = {
      run_id: 'run-test-1',
      git_sha: LAUNCH_HEAD,
      evidence_label: 'test-label',
      timing: { probe_finished_at: new Date().toISOString() },
    };
    recordCompletedProbe(root, probe, row);
    assert.throws(
      () => assertAppendAllowed(root, probe, row, { evidenceLabel: 'test-label', launchHead: LAUNCH_HEAD, protocolKey: 'h1', completedCount: 1 }),
      /duplicate probe_id/,
    );
  });

  it('rejects duplicate coordinate before append', () => {
    const probeA = {
      probe_id: 1,
      matrix_protocol: 'h1',
      window: 1,
      user_class: 'contract_control',
      user_uid: 'u1',
      run: 1,
      case_id: 'final_tagged_plan',
    };
    const probeB = { ...probeA, probe_id: 2 };
    const row = {
      run_id: 'run-test-1',
      git_sha: LAUNCH_HEAD,
      evidence_label: 'test-label',
      timing: { probe_finished_at: new Date().toISOString() },
    };
    recordCompletedProbe(root, probeA, row);
    assert.throws(
      () => assertAppendAllowed(root, probeB, row, { evidenceLabel: 'test-label', launchHead: LAUNCH_HEAD, protocolKey: 'h1', completedCount: 1 }),
      /duplicate matrix coordinate/,
    );
  });

  it('rejects wrong run_id', () => {
    const probe = {
      probe_id: 10,
      matrix_protocol: 'h1',
      window: 1,
      user_class: 'contract_control',
      user_uid: 'u1',
      run: 1,
      case_id: 'pricing_strategy',
    };
    const row = {
      run_id: 'wrong-run',
      git_sha: LAUNCH_HEAD,
      evidence_label: 'test-label',
    };
    assert.throws(
      () => assertAppendAllowed(root, probe, row, { evidenceLabel: 'test-label', launchHead: LAUNCH_HEAD, protocolKey: 'h1', completedCount: 0 }),
      /run_id mismatch/,
    );
  });

  it('rejects wrong git SHA', () => {
    const probe = {
      probe_id: 11,
      matrix_protocol: 'h1',
      window: 1,
      user_class: 'contract_control',
      user_uid: 'u1',
      run: 1,
      case_id: 'pricing_strategy',
    };
    const row = {
      run_id: 'run-test-1',
      git_sha: 'deadbeef',
      evidence_label: 'test-label',
    };
    assert.throws(
      () => assertAppendAllowed(root, probe, row, { evidenceLabel: 'test-label', launchHead: LAUNCH_HEAD, protocolKey: 'h1', completedCount: 0 }),
      /git SHA mismatch/,
    );
  });

  it('detects truncated JSONL final line', () => {
    const file = path.join(root, 'trunc.jsonl');
    fs.writeFileSync(file, '{"ok":true}\n{"trunc\n', 'utf8');
    assert.equal(detectTruncatedJsonl(file), true);
  });

  it('marks coverage blocked and refuses append', () => {
    markCoverageBlocked(root, 'pcap gap');
    assert.equal(isCoverageBlocked(root), true);
    const probe = {
      probe_id: 12,
      matrix_protocol: 'h1',
      window: 1,
      user_class: 'contract_control',
      user_uid: 'u1',
      run: 1,
      case_id: 'pricing_strategy',
    };
    const row = { run_id: 'run-test-1', git_sha: 'abc123', evidence_label: 'test-label' };
    assert.throws(() => assertAppendAllowed(root, probe, row, { launchHead: LAUNCH_HEAD, protocolKey: 'h1', completedCount: 0 }), /coverage blocked/);
  });

  it('persists probe index atomically', () => {
    const probe = {
      probe_id: 99,
      matrix_protocol: 'h3',
      window: 2,
      user_class: 'real_participant',
      user_uid: 'u9',
      run: 3,
      case_id: 'auction_pressure',
    };
    const row = {
      run_id: 'run-test-1',
      git_sha: LAUNCH_HEAD,
      evidence_label: 'test-label',
      timing: { probe_finished_at: new Date().toISOString() },
    };
    recordCompletedProbe(root, probe, row);
    const index = loadProbeIndex(root);
    assert.ok(index.probe_ids.includes(99));
    assert.equal(index.coordinates.length, 1);
  });
});
