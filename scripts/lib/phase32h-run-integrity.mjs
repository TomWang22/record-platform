/**
 * Phase 32H-R1 — atomic run locks, probe index, and append guards.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gitSha } from './phase22-full-replay-common.mjs';
import { R1_FORBIDDEN_BASELINE_ROOTS } from './phase32h-r1-config.mjs';
import {
  countJsonlRowsStreamingSync,
  detectTruncatedJsonlStreaming,
} from './phase32h-jsonl-stream.mjs';

export const RUN_STATE_DIR = 'run-state';
export const BLOCKED_MARKER = 'COLLECTOR_COVERAGE_BLOCKED';
export const FOREIGN_COLLECTOR_MARKER = 'PHASE32H_FOREIGN_COLLECTOR_BLOCKED';
export const DUPLICATE_COLLECTOR_MARKER = 'PHASE32H_DUPLICATE_COLLECTOR_BLOCKED';
export const FROZEN_BLOCKED_MARKER = 'FROZEN_BLOCKED_EVIDENCE';
export const INVALID_BASELINE_ROOTS = new Set(R1_FORBIDDEN_BASELINE_ROOTS);

export function isEvidenceRootFrozen(outRoot) {
  return fs.existsSync(path.join(outRoot, FROZEN_BLOCKED_MARKER));
}

export function assertLaunchableEvidenceRoot(outRoot) {
  if (!outRoot.startsWith('/tmp/')) {
    throw new Error(`evidence root must be under /tmp: ${outRoot}`);
  }
  if (INVALID_BASELINE_ROOTS.has(outRoot)) {
    throw new Error(`evidence root is frozen invalid baseline: ${outRoot}`);
  }
  if (isEvidenceRootFrozen(outRoot)) {
    throw new Error(`evidence root is frozen: ${outRoot}`);
  }
  if (isCoverageBlocked(outRoot)) {
    throw new Error(`evidence root has immutable collector coverage block: ${outRoot}`);
  }
}

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
    completedProbeIds: path.join(base, 'completed-probe-ids.jsonl'),
    completedCoordinates: path.join(base, 'completed-coordinates.jsonl'),
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
      `${JSON.stringify(
        {
          evidence_label: evidenceLabel,
          probe_count: 0,
          coordinate_count: 0,
          last_probe_id: null,
          last_completed_at: null,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
  return paths;
}

/** @type {Map<string, { probeIds: Set<number|string>, coordinates: Set<string>, loaded: boolean }>} */
const probeIndexCache = new Map();

function streamJsonlValues(filePath, onValue) {
  if (!fs.existsSync(filePath)) return;
  const fd = fs.openSync(filePath, 'r');
  try {
    let carry = '';
    const buf = Buffer.alloc(64 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      carry += buf.toString('utf8', 0, bytes);
      let idx;
      while ((idx = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, idx);
        carry = carry.slice(idx + 1);
        if (!line.trim()) continue;
        onValue(JSON.parse(line));
      }
    }
    if (carry.trim()) onValue(JSON.parse(carry));
  } finally {
    fs.closeSync(fd);
  }
}

function migrateLegacyProbeIndex(outRoot, paths) {
  const raw = JSON.parse(fs.readFileSync(paths.probeIndex, 'utf8'));
  if (!Array.isArray(raw.probe_ids) && !Array.isArray(raw.coordinates)) return raw;
  fs.mkdirSync(paths.base, { recursive: true });
  for (const probeId of raw.probe_ids || []) {
    fs.appendFileSync(paths.completedProbeIds, `${JSON.stringify({ probe_id: probeId })}\n`, 'utf8');
  }
  for (const coord of raw.coordinates || []) {
    fs.appendFileSync(paths.completedCoordinates, `${JSON.stringify({ coordinate: coord })}\n`, 'utf8');
  }
  const metadata = {
    evidence_label: raw.evidence_label ?? null,
    probe_count: (raw.probe_ids || []).length,
    coordinate_count: (raw.coordinates || []).length,
    last_probe_id: raw.last_probe_id ?? null,
    last_completed_at: raw.last_completed_at ?? null,
  };
  const tmp = `${paths.probeIndex}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, paths.probeIndex);
  return metadata;
}

export function clearProbeIndexCache(outRoot = null) {
  if (outRoot == null) {
    probeIndexCache.clear();
    return;
  }
  probeIndexCache.delete(outRoot);
}

export function ensureProbeIndexCache(outRoot) {
  let cache = probeIndexCache.get(outRoot);
  if (cache?.loaded) return cache;
  const paths = runStatePaths(outRoot);
  let metadata = fs.existsSync(paths.probeIndex)
    ? JSON.parse(fs.readFileSync(paths.probeIndex, 'utf8'))
    : { evidence_label: null, probe_count: 0, coordinate_count: 0 };
  if (Array.isArray(metadata.probe_ids) || Array.isArray(metadata.coordinates)) {
    metadata = migrateLegacyProbeIndex(outRoot, paths);
  }
  cache = {
    probeIds: new Set(),
    coordinates: new Set(),
    loaded: true,
    metadata,
  };
  streamJsonlValues(paths.completedProbeIds, (row) => {
    if (row.probe_id != null) cache.probeIds.add(row.probe_id);
  });
  streamJsonlValues(paths.completedCoordinates, (row) => {
    if (row.coordinate != null) cache.coordinates.add(row.coordinate);
  });
  probeIndexCache.set(outRoot, cache);
  return cache;
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
    return { probe_ids: [], coordinates: [], probe_count: 0, coordinate_count: 0 };
  }
  const cache = ensureProbeIndexCache(outRoot);
  return {
    ...cache.metadata,
    probe_ids: [...cache.probeIds],
    coordinates: [...cache.coordinates],
    probe_count: cache.probeIds.size,
    coordinate_count: cache.coordinates.size,
  };
}

export function saveProbeIndex(outRoot, index) {
  const paths = runStatePaths(outRoot);
  const metadata = {
    evidence_label: index.evidence_label ?? null,
    probe_count: index.probe_count ?? (index.probe_ids?.length || 0),
    coordinate_count: index.coordinate_count ?? (index.coordinates?.length || 0),
    last_probe_id: index.last_probe_id ?? null,
    last_completed_at: index.last_completed_at ?? null,
  };
  const tmp = `${paths.probeIndex}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, paths.probeIndex);
  const cache = probeIndexCache.get(outRoot);
  if (cache) cache.metadata = metadata;
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
  return detectTruncatedJsonlStreaming(jsonlPath);
}

export function countJsonlRows(jsonlPath) {
  return countJsonlRowsStreamingSync(jsonlPath);
}

export function isCoverageBlocked(outRoot) {
  const paths = runStatePaths(outRoot);
  return (
    fs.existsSync(paths.blockedMarker) ||
    fs.existsSync(path.join(outRoot, FOREIGN_COLLECTOR_MARKER)) ||
    fs.existsSync(path.join(outRoot, DUPLICATE_COLLECTOR_MARKER)) ||
    isEvidenceRootFrozen(outRoot)
  );
}

export function markCoverageBlocked(outRoot, reason) {
  const paths = runStatePaths(outRoot);
  if (fs.existsSync(paths.blockedMarker)) {
    const error = new Error('collector coverage block is immutable for this evidence generation');
    error.code = 'BLOCKED_MARKER_IMMUTABLE';
    throw error;
  }
  fs.writeFileSync(
    paths.blockedMarker,
    `${JSON.stringify({ at: new Date().toISOString(), reason, status: 'BLOCKED', immutable: true }, null, 2)}\n`,
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

  const cache = ensureProbeIndexCache(outRoot);
  const probeIds = cache.probeIds;
  const coordinates = cache.coordinates;
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
  const paths = runStatePaths(outRoot);
  const cache = ensureProbeIndexCache(outRoot);
  const coord = matrixCoordinateKey(probe);
  fs.mkdirSync(paths.base, { recursive: true });
  if (!cache.probeIds.has(probe.probe_id)) {
    cache.probeIds.add(probe.probe_id);
    fs.appendFileSync(paths.completedProbeIds, `${JSON.stringify({ probe_id: probe.probe_id })}\n`, 'utf8');
  }
  if (!cache.coordinates.has(coord)) {
    cache.coordinates.add(coord);
    fs.appendFileSync(paths.completedCoordinates, `${JSON.stringify({ coordinate: coord })}\n`, 'utf8');
  }
  saveProbeIndex(outRoot, {
    ...cache.metadata,
    probe_count: cache.probeIds.size,
    coordinate_count: cache.coordinates.size,
    last_probe_id: probe.probe_id,
    last_completed_at: row.timing?.probe_finished_at || new Date().toISOString(),
  });
}

export function shardLockIsActive(outRoot, protocolKey) {
  const paths = runStatePaths(outRoot);
  const lockPath = paths[`${protocolKey}Lock`];
  if (!lockPath || !fs.existsSync(lockPath)) return false;
  const owner = readLockOwner(lockPath);
  return owner ? isPidAlive(owner.pid) : false;
}
