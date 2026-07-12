/**
 * Phase 32H — deterministic evidence freeze state machine.
 * Writers must be fully quiesced before hashing; frozen marker is written last.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const FREEZE_INTEGRITY_BLOCKED = 'PHASE32H_FREEZE_INTEGRITY_BLOCKED';
export const DEFAULT_QUIET_PERIOD_MS = Number(process.env.PHASE32H_FREEZE_QUIET_MS || 5000);
export const DEFAULT_GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);

export const WRITER_SHUTDOWN_ORDER = [
  'triplet_runner',
  'matrix_monitor',
  'collector_supervisor',
  'extreme_watchdog',
  'gateway_log_collector',
  'application_log_collector',
  'host_power_telemetry',
  'pcap_collector',
  'other',
];

const FREEZE_MARKER_NAMES = new Set([
  'FROZEN_BLOCKED_EVIDENCE',
  'FROZEN_PASS_EVIDENCE',
]);

export function roleForCommand(command, outRoot) {
  if (!command.includes(outRoot)) return null;
  if (command.includes('phase32h-r1-triplet-runner.mjs')) return 'triplet_runner';
  if (command.includes('phase32h-monitor-targeted-reproduction.sh') || command.includes('phase32h-monitor.log')) {
    return 'matrix_monitor';
  }
  if (command.includes('phase32h-collector-supervisor.mjs')) return 'collector_supervisor';
  if (command.includes('phase32h-extreme-watchdog.mjs')) return 'extreme_watchdog';
  if (command.includes('phase32h-start-gateway-log-capture.sh')) return 'gateway_log_collector';
  if (command.includes('phase32h-start-application-log-capture.sh')) return 'application_log_collector';
  if (command.includes('phase32h-capture-host-telemetry.sh')) return 'host_power_telemetry';
  if (command.includes('dumpcap') && command.includes(outRoot)) return 'pcap_collector';
  if (command.includes('phase32h-runtime-hygiene-checkpoint.mjs')) return 'checkpoint_loop';
  if (command.includes(outRoot)) return 'other';
  return null;
}

export function listProcesses() {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  const rows = [];
  for (const line of (ps.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
}

export function listRootScopedProcesses(outRoot) {
  return listProcesses().filter((proc) => roleForCommand(proc.command, outRoot));
}

export function isFrozenRoot(outRoot) {
  for (const name of FREEZE_MARKER_NAMES) {
    if (fs.existsSync(path.join(outRoot, name))) return true;
  }
  return false;
}

export function assertWritableEvidenceRoot(outRoot, targetPath) {
  if (!outRoot || !targetPath.startsWith(outRoot)) return;
  if (isFrozenRoot(outRoot)) {
    const err = new Error(`post-freeze write rejected: ${targetPath}`);
    err.code = FREEZE_INTEGRITY_BLOCKED;
    throw err;
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function signalProcess(proc, signal, ledger, seen) {
  const key = `${proc.pid}:${signal}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const role = roleForCommand(proc.command, proc.outRoot) || 'other';
  const entry = {
    pid: proc.pid,
    role,
    command: proc.command,
    signal,
    signal_at: new Date().toISOString(),
    exit_at: null,
    exit_code: null,
    sigkill_required: false,
  };
  try {
    process.kill(proc.pid, signal);
    ledger.push(entry);
    return entry;
  } catch (err) {
    entry.exit_at = new Date().toISOString();
    entry.exit_code = err.code === 'ESRCH' ? 0 : null;
    entry.note = err.message;
    ledger.push(entry);
    return entry;
  }
}

export function stopWritersForRoot(outRoot, { gracefulMs = DEFAULT_GRACEFUL_MS } = {}) {
  const ledger = [];
  const seen = new Set();
  const procs = () =>
    listProcesses()
      .filter((p) => roleForCommand(p.command, outRoot))
      .map((p) => ({ ...p, outRoot }));

  for (const proc of procs()) {
    signalProcess(proc, 'SIGTERM', ledger, seen);
  }

  const deadline = Date.now() + gracefulMs;
  while (Date.now() < deadline) {
    const alive = ledger
      .filter((e) => e.signal === 'SIGTERM' && e.exit_at == null)
      .some((e) => {
        try {
          process.kill(e.pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    if (!alive) break;
    sleepMs(250);
  }

  for (const entry of ledger.filter((e) => e.signal === 'SIGTERM' && e.exit_at == null)) {
    try {
      process.kill(entry.pid, 0);
      const proc = procs().find((p) => p.pid === entry.pid);
      if (proc) {
        signalProcess(proc, 'SIGKILL', ledger, seen);
        const killEntry = ledger[ledger.length - 1];
        if (killEntry) {
          killEntry.sigkill_required = true;
          entry.sigkill_required = true;
        }
      }
    } catch {
      entry.exit_at = new Date().toISOString();
      entry.exit_code = 0;
    }
  }

  for (const entry of ledger) {
    if (entry.exit_at) continue;
    try {
      process.kill(entry.pid, 0);
    } catch {
      entry.exit_at = new Date().toISOString();
      entry.exit_code = 0;
    }
  }

  return ledger;
}

export function verifyZeroWriters(outRoot) {
  const remaining = listRootScopedProcesses(outRoot);
  return {
    writers_remaining: remaining.length,
    remaining,
    pass: remaining.length === 0,
  };
}

export function verifyOpenFiles(outRoot) {
  if (spawnSync('which', ['lsof']).status !== 0) {
    return { open_files_remaining: null, open_files: [], pass: true, skipped: true };
  }
  const result = spawnSync('lsof', ['+D', outRoot], { encoding: 'utf8' });
  const lines = (result.stdout || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
  const writers = lines
    .map((line) => {
      const parts = line.split(/\s+/);
      return { command: parts[0], pid: Number(parts[1]), file: parts[parts.length - 1] };
    })
    .filter((row) => Number.isFinite(row.pid) && row.pid !== process.pid);
  return {
    open_files_remaining: writers.length,
    open_files: writers,
    pass: writers.length === 0,
    skipped: false,
  };
}

export function walkEvidenceFiles(root, { excludeSuffixes = [] } = {}) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkEvidenceFiles(full, { excludeSuffixes }));
      continue;
    }
    if (!excludeSuffixes.some((suffix) => full.endsWith(suffix))) files.push(full);
  }
  return files;
}

export function snapshotFileMetadata(outRoot, { excludeSuffixes = [] } = {}) {
  const snapshot = new Map();
  for (const file of walkEvidenceFiles(outRoot, { excludeSuffixes })) {
    const stat = fs.statSync(file);
    snapshot.set(file, { size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return snapshot;
}

export function diffSnapshots(before, after) {
  const changed = [];
  for (const [file, meta] of after.entries()) {
    const prev = before.get(file);
    if (!prev || prev.size !== meta.size || prev.mtimeMs !== meta.mtimeMs) {
      changed.push(file);
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(file);
  }
  return [...new Set(changed)];
}

export function waitQuietPeriod(outRoot, {
  quietPeriodMs = DEFAULT_QUIET_PERIOD_MS,
  excludeSuffixes = [],
} = {}) {
  const before = snapshotFileMetadata(outRoot, { excludeSuffixes });
  sleepMs(quietPeriodMs);
  const after = snapshotFileMetadata(outRoot, { excludeSuffixes });
  const changed = diffSnapshots(before, after);
  return {
    quiet_period_ms: quietPeriodMs,
    files_changed_during_quiet_period: changed,
    pass: changed.length === 0,
  };
}

export function sha256FileSync(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

export function hashEvidenceFiles(outRoot, { excludeSuffixes = [] } = {}) {
  const files = walkEvidenceFiles(outRoot, { excludeSuffixes }).sort();
  const lines = files.map((file) => `${sha256FileSync(file)}  ${file}`);
  return { files, lines };
}

export function writeHashManifest(outRoot, lines, manifestName) {
  const manifestPath = path.join(outRoot, manifestName);
  fs.writeFileSync(manifestPath, `${lines.join('\n')}\n`, 'utf8');
  return manifestPath;
}

export function writeFreezeMarkerLast(outRoot, markerName, content) {
  const markerPath = path.join(outRoot, markerName);
  fs.writeFileSync(markerPath, content, 'utf8');
  const after = snapshotFileMetadata(outRoot, { excludeSuffixes: [] });
  const markerStat = after.get(markerPath);
  const latestMtime = Math.max(...[...after.values()].map((v) => v.mtimeMs));
  return {
    marker_path: markerPath,
    marker_written_last: markerStat?.mtimeMs === latestMtime,
  };
}

export function buildHistoricalFreezeMismatchReport({
  root,
  mismatchedPath,
  expectedSha,
  observedSha,
  freezeTimestamp,
  finalMtime,
  writerResponsible,
  jsonlHashStatus,
}) {
  return {
    classification: 'FREEZE_INTEGRITY_PARTIAL',
    root,
    mismatched_path: mismatchedPath,
    expected_sha256: expectedSha,
    observed_sha256: observedSha,
    freeze_timestamp: freezeTimestamp,
    final_file_mtime: finalMtime,
    writer_believed_responsible: writerResponsible,
    jsonl_hash_status: jsonlHashStatus,
    historical_evidence_modified: false,
    statement:
      'Historical freeze hashed evidence before every writer was fully quiesced. Evidence was not repaired.',
    terminal_classification: 'PRELAUNCH_POLICY_VIOLATION',
    evidence_admissibility: 'NO',
    never_resume: true,
  };
}

export function finalizeFreezeIntegrity({
  outRoot,
  quietPeriodMs = DEFAULT_QUIET_PERIOD_MS,
  hashManifestName,
  hashExcludeSuffixes = [],
  markerName,
  markerContent,
  jsonlPaths = [],
  jsonlHashesBefore = null,
} = {}) {
  if (!outRoot) {
    const err = new Error('outRoot required');
    err.code = FREEZE_INTEGRITY_BLOCKED;
    throw err;
  }
  if (isFrozenRoot(outRoot)) {
    const err = new Error(`root already frozen: ${outRoot}`);
    err.code = FREEZE_INTEGRITY_BLOCKED;
    throw err;
  }

  const before =
    jsonlHashesBefore ||
    Object.fromEntries(jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]));

  const writerCheck = verifyZeroWriters(outRoot);
  const openFileCheck = verifyOpenFiles(outRoot);
  const quietCheck = waitQuietPeriod(outRoot, {
    quietPeriodMs,
    excludeSuffixes: hashExcludeSuffixes,
  });

  const jsonlHashesAfter = Object.fromEntries(
    jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]),
  );
  const jsonlModified = Object.keys(before).some((p) => before[p] !== jsonlHashesAfter[p]);

  const violations = [];
  if (writerCheck.writers_remaining > 0) {
    violations.push(`writers_remaining=${writerCheck.writers_remaining}`);
  }
  if (!openFileCheck.skipped && openFileCheck.open_files_remaining > 0) {
    violations.push(`open_files_remaining=${openFileCheck.open_files_remaining}`);
  }
  if (!quietCheck.pass) {
    violations.push(`files_changed_during_quiet_period=${quietCheck.files_changed_during_quiet_period.length}`);
  }
  if (jsonlModified) {
    violations.push('jsonl_modified_during_freeze');
  }

  if (violations.length) {
    const err = new Error(`freeze integrity blocked: ${violations.join('; ')}`);
    err.code = FREEZE_INTEGRITY_BLOCKED;
    err.details = {
      status: 'BLOCKED',
      writers_remaining: writerCheck.writers_remaining,
      open_files_remaining: openFileCheck.open_files_remaining,
      quiet_period_ms: quietCheck.quiet_period_ms,
      files_changed_during_quiet_period: quietCheck.files_changed_during_quiet_period,
      hash_manifest_written: false,
      marker_written_last: false,
      jsonl_modified: jsonlModified,
      violations,
    };
    throw err;
  }

  const { lines } = hashEvidenceFiles(outRoot, { excludeSuffixes: hashExcludeSuffixes });
  const manifestPath = writeHashManifest(outRoot, lines, hashManifestName);
  const markerResult = writeFreezeMarkerLast(outRoot, markerName, markerContent);

  if (!markerResult.marker_written_last) {
    const err = new Error('freeze marker was not the final filesystem mutation');
    err.code = FREEZE_INTEGRITY_BLOCKED;
    throw err;
  }

  return {
    status: 'PASS',
    writers_remaining: 0,
    open_files_remaining: openFileCheck.open_files_remaining ?? 0,
    quiet_period_ms: quietCheck.quiet_period_ms,
    files_changed_during_quiet_period: [],
    hash_manifest_written: true,
    hash_manifest_path: manifestPath,
    marker_written_last: true,
    marker_path: markerResult.marker_path,
    jsonl_hashes_before: before,
    jsonl_hashes_after: jsonlHashesAfter,
    jsonl_modified: false,
  };
}

export function executeFreezeIntegrity({
  outRoot,
  repoRoot,
  stopPcapScript,
  quietPeriodMs = DEFAULT_QUIET_PERIOD_MS,
  gracefulMs = DEFAULT_GRACEFUL_MS,
  hashManifestName,
  hashExcludeSuffixes = [],
  markerName,
  markerContent,
  jsonlPaths = [],
  preStopHook = null,
  postStopHook = null,
  writersAlreadyStopped = false,
} = {}) {
  if (!outRoot) {
    const err = new Error('outRoot required');
    err.code = FREEZE_INTEGRITY_BLOCKED;
    throw err;
  }
  if (isFrozenRoot(outRoot)) {
    const err = new Error(`root already frozen: ${outRoot}`);
    err.code = FREEZE_INTEGRITY_BLOCKED;
    throw err;
  }

  const jsonlHashesBefore = Object.fromEntries(
    jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]),
  );

  let stopLedger = [];
  if (!writersAlreadyStopped) {
    if (typeof preStopHook === 'function') preStopHook();
    stopLedger = stopWritersForRoot(outRoot, { gracefulMs });
    if (stopPcapScript && repoRoot) {
      spawnSync('bash', [stopPcapScript, outRoot], { cwd: repoRoot });
    }
    if (typeof postStopHook === 'function') postStopHook();
  }

  const finalized = finalizeFreezeIntegrity({
    outRoot,
    quietPeriodMs,
    hashManifestName,
    hashExcludeSuffixes,
    markerName,
    markerContent,
    jsonlPaths,
    jsonlHashesBefore,
  });

  return {
    ...finalized,
    stop_ledger: stopLedger,
  };
}
