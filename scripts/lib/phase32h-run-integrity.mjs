/**
 * Phase 32H-R1 — atomic run locks, probe index, and append guards.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gitSha } from './phase22-full-replay-common.mjs';

export const RUN_STATE_DIR = 'run-state';
export const BLOCKED_MARKER = 'COLLECTOR_COVERAGE_BLOCKED';

export function matrixCoordinateKey(row) {
  const userHash =
    row.user_hash ||
    crypto.createHash('sha256').update(String(row.user_uid || '')).digest('hex').slice(0, 16);
  return [
    row.matrix_protocol,
    row.window,
    row.user_class,
    userHash,
    row.run,
    row.case_id,
  ].join('|');
}

export function runStatePaths(outRoot) {
  const base = path.join(outRoot, RUN_STATE_DIR);
  return {
    base,
    runId: path.join(base, 'run-id'),
    launchHead: path.join(base, 'launch-head'),
    manifestSha: path.join(base, 'manifest-sha256'),
    matrixLock: path.join(base, 'matrix.lock'),
    h1Lock: path.join(base, 'h1.lock'),
    h2Lock: path.join(base, 'h2.lock'),
    h3Lock: path.join(base, 'h3.lock'),
    supervisor: path.join(base, 'collector-supervisor.json'),
    probeIndex: path.join(base, 'completed-probes.json'),
    staleRecoveryLedger: path.join(base, 'stale-lock-recovery.jsonl'),
    blockedMarker: path.join(outRoot, BLOCKED_MARKER),
  };
}

export function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

export function generateRunId() {
  return `phase32h-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function initRunState(outRoot, { runId, launchHead, evidenceLabel, manifestPath }) {
  const paths = runStatePaths(outRoot);
  fs.mkdirSync(paths.base, { recursive: true });
  if (!fs.existsSync(paths.runId)) {
    fs.writeFileSync(paths.runId, `${runId}\n`, 'utf8');
  }
  if (!fs.existsSync(paths.launchHead)) {
    fs.writeFileSync(paths.launchHead, `${launchHead}\n`, 'utf8');
  }
  if (manifestPath && fs.existsSync(manifestPath) && !fs.existsSync(paths.manifestSha)) {
    fs.writeFileSync(paths.manifestSha, `${sha256File(manifestPath)}\n`, 'utf8');
  }
  if (!fs.existsSync(paths.probeIndex)) {
    fs.writeFileSync(
      paths.probeIndex,
      `${JSON.stringify({ probe_ids: [], coordinates: [], evidence_label: evidenceLabel }, null, 2)}\n`,
      'utf8',
    );
  }
  return paths;
}

function readLockOwner(lockPath) {
  const ownerPath = path.join(lockPath, 'owner.json');
  if (!fs.existsSync(ownerPath)) return null;
  return JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
}

function isPidAlive(pid) {
  if (!pid || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(lockPath, owner, { allowStaleRecovery = true, ledgerPath = null } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
      path.join(lockPath, 'owner.json'),
      `${JSON.stringify({ ...owner, acquired_at: new Date().toISOString() })}\n`,
      'utf8',
    );
    return { acquired: true, recovered: false };
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    const existing = readLockOwner(lockPath);
    if (existing && isPidAlive(existing.pid)) {
      const error = new Error(`lock held by live pid ${existing.pid} at ${lockPath}`);
      error.code = 'LOCK_HELD';
      error.owner = existing;
      throw error;
    }
    if (!allowStaleRecovery) {
      const error = new Error(`stale lock at ${lockPath} without recovery permission`);
      error.code = 'STALE_LOCK';
      error.owner = existing;
      throw error;
    }
    fs.rmSync(lockPath, { recursive: true, force: true });
    if (ledgerPath) {
      fs.appendFileSync(
        ledgerPath,
        `${JSON.stringify({
          at: new Date().toISOString(),
          lock_path: lockPath,
          stale_owner: existing,
          new_owner: owner,
        })}\n`,
      );
    }
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
      path.join(lockPath, 'owner.json'),
      `${JSON.stringify({ ...owner, acquired_at: new Date().toISOString(), recovered_from: existing })}\n`,
      'utf8',
    );
    return { acquired: true, recovered: true, stale_owner: existing };
  }
}

export function releaseLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

export function acquireLauncherLock(outRoot, owner) {
  const paths = runStatePaths(outRoot);
  return acquireLock(paths.matrixLock, owner, { ledgerPath: paths.staleRecoveryLedger });
}

export function acquireShardLock(outRoot, protocolKey, owner) {
  const paths = runStatePaths(outRoot);
  const lockPath = paths[`${protocolKey}Lock`];
  if (!lockPath) throw new Error(`unknown protocol lock: ${protocolKey}`);
  return acquireLock(lockPath, owner, { ledgerPath: paths.staleRecoveryLedger });
}

export function loadProbeIndex(outRoot) {
  const paths = runStatePaths(outRoot);
  if (!fs.existsSync(paths.probeIndex)) {
    return { probe_ids: [], coordinates: [] };
  }
  return JSON.parse(fs.readFileSync(paths.probeIndex, 'utf8'));
}

export function saveProbeIndex(outRoot, index) {
  const paths = runStatePaths(outRoot);
  const tmp = `${paths.probeIndex}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, paths.probeIndex);
}

export function readLaunchHead(outRoot) {
  const paths = runStatePaths(outRoot);
  if (!fs.existsSync(paths.launchHead)) return null;
  return fs.readFileSync(paths.launchHead, 'utf8').trim();
}

export function readRunId(outRoot) {
  const paths = runStatePaths(outRoot);
  if (!fs.existsSync(paths.runId)) return null;
  return fs.readFileSync(paths.runId, 'utf8').trim();
}

export function readManifestSha(outRoot) {
  const paths = runStatePaths(outRoot);
  if (!fs.existsSync(paths.manifestSha)) return null;
  return fs.readFileSync(paths.manifestSha, 'utf8').trim();
}

export function assertHeadUnchanged(outRoot) {
  const launchHead = readLaunchHead(outRoot);
  const current = gitSha();
  if (launchHead && launchHead !== current) {
    const error = new Error(`repository HEAD changed during run: launch=${launchHead} current=${current}`);
    error.code = 'HEAD_CHANGED';
    throw error;
  }
  return current;
}

export function assertManifestUnchanged(outRoot, manifestPath) {
  const expected = readManifestSha(outRoot);
  if (!expected) return sha256File(manifestPath);
  const current = sha256File(manifestPath);
  if (current !== expected) {
    const error = new Error(`manifest SHA changed during run: expected=${expected} current=${current}`);
    error.code = 'MANIFEST_CHANGED';
    throw error;
  }
  return current;
}

export function detectTruncatedJsonl(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return false;
  const content = fs.readFileSync(jsonlPath, 'utf8');
  if (!content) return false;
  const lines = content.split('\n');
  const last = lines[lines.length - 1] === '' ? lines[lines.length - 2] : lines[lines.length - 1];
  if (!last) return false;
  try {
    JSON.parse(last);
    return false;
  } catch {
    return true;
  }
}

export function countJsonlRows(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return 0;
  return fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).length;
}

export function isCoverageBlocked(outRoot) {
  const paths = runStatePaths(outRoot);
  return fs.existsSync(paths.blockedMarker);
}

export function markCoverageBlocked(outRoot, reason) {
  const paths = runStatePaths(outRoot);
  fs.writeFileSync(
    paths.blockedMarker,
    `${JSON.stringify({ at: new Date().toISOString(), reason, status: 'BLOCKED' }, null, 2)}\n`,
    'utf8',
  );
}

export function assertAppendAllowed(outRoot, probe, row, ctx = {}) {
  if (isCoverageBlocked(outRoot)) {
    const error = new Error('collector coverage blocked; refusing append');
    error.code = 'COVERAGE_BLOCKED';
    throw error;
  }
  assertHeadUnchanged(outRoot);
  if (ctx.manifestPath) assertManifestUnchanged(outRoot, ctx.manifestPath);

  const runId = readRunId(outRoot);
  if (runId && row.run_id && row.run_id !== runId) {
    const error = new Error(`run_id mismatch: expected=${runId} row=${row.run_id}`);
    error.code = 'WRONG_RUN_ID';
    throw error;
  }
  if (ctx.evidenceLabel && row.evidence_label !== ctx.evidenceLabel) {
    const error = new Error(`evidence label mismatch: ${row.evidence_label}`);
    error.code = 'WRONG_EVIDENCE_LABEL';
    throw error;
  }
  if (ctx.launchHead && row.git_sha !== ctx.launchHead) {
    const error = new Error(`git SHA mismatch: row=${row.git_sha} launch=${ctx.launchHead}`);
    error.code = 'WRONG_GIT_SHA';
    throw error;
  }
  if (ctx.protocolKey && probe.matrix_protocol !== ctx.protocolKey) {
    const error = new Error(`protocol shard mismatch: probe=${probe.matrix_protocol} runner=${ctx.protocolKey}`);
    error.code = 'WRONG_PROTOCOL_SHARD';
    throw error;
  }
  if (ctx.expectedOffset != null && ctx.expectedOffset !== ctx.completedCount) {
    const error = new Error(
      `manifest offset mismatch: expected=${ctx.expectedOffset} completed=${ctx.completedCount}`,
    );
    error.code = 'OFFSET_MISMATCH';
    throw error;
  }

  const index = loadProbeIndex(outRoot);
  const probeIds = new Set(index.probe_ids);
  const coordinates = new Set(index.coordinates);
  const coord = matrixCoordinateKey(probe);

  if (probeIds.has(probe.probe_id)) {
    const error = new Error(`duplicate probe_id before append: ${probe.probe_id}`);
    error.code = 'DUPLICATE_PROBE_ID';
    throw error;
  }
  if (coordinates.has(coord)) {
    const error = new Error(`duplicate matrix coordinate before append: ${coord}`);
    error.code = 'DUPLICATE_COORDINATE';
    throw error;
  }
  return { coord, runId, launchHead: readLaunchHead(outRoot) };
}

export function recordCompletedProbe(outRoot, probe, row) {
  const index = loadProbeIndex(outRoot);
  const coord = matrixCoordinateKey(probe);
  if (!index.probe_ids.includes(probe.probe_id)) index.probe_ids.push(probe.probe_id);
  if (!index.coordinates.includes(coord)) index.coordinates.push(coord);
  index.last_probe_id = probe.probe_id;
  index.last_completed_at = row.timing?.probe_finished_at || new Date().toISOString();
  saveProbeIndex(outRoot, index);
}

export function shardLockIsActive(outRoot, protocolKey) {
  const paths = runStatePaths(outRoot);
  const lockPath = paths[`${protocolKey}Lock`];
  if (!lockPath || !fs.existsSync(lockPath)) return false;
  const owner = readLockOwner(lockPath);
  return owner ? isPidAlive(owner.pid) : false;
}
