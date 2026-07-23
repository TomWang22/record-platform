/**
 * Launcher-owned exclusive evidence-root lock for Phase 34 evaluation runs.
 * External monitors are not sufficient to guarantee a single writer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WRITER_LOCK_SCHEMA = 'phase34-writer-lock-v1';
export const CHECKPOINT_SCHEMA = 'phase34-runner-checkpoint-v1';

export const LEDGER_FILES = Object.freeze([
  'sessions.jsonl',
  'turns.jsonl',
  'model-invocations.jsonl',
  'protocol.jsonl',
  'claims.jsonl',
  'failures.jsonl',
]);

export const ROOT_SUBDIRS = Object.freeze([
  'ledgers',
  'reports',
  'telemetry',
  'run-state',
  'model',
  'protocol',
  'failures',
  'locks',
]);

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

/**
 * Resolve to a canonical absolute path. Rejects symlink escape of ownership
 * by resolving the final realpath before lock creation.
 */
export function canonicalEvidenceRoot(rootPath) {
  const absolute = path.resolve(String(rootPath || ''));
  const parent = path.dirname(absolute);
  if (!fs.existsSync(parent)) {
    const err = new Error(`EVIDENCE_ROOT_PARENT_MISSING:${parent}`);
    err.code = 'EVIDENCE_ROOT_PARENT_MISSING';
    throw err;
  }
  const realParent = fs.realpathSync(parent);
  const leaf = path.basename(absolute);
  const candidate = path.join(realParent, leaf);
  if (fs.existsSync(candidate)) {
    return fs.realpathSync(candidate);
  }
  return candidate;
}

export function precreateEvidenceLayout(root) {
  for (const d of ROOT_SUBDIRS) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  for (const name of LEDGER_FILES) {
    const p = path.join(root, 'ledgers', name);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, '');
    }
  }
  return {
    ledgers: LEDGER_FILES.map((name) => path.join(root, 'ledgers', name)),
  };
}

export function writeAtomicJson(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  const body = `${JSON.stringify(obj, null, 2)}\n`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  return filePath;
}

/**
 * Acquire exclusive writer ownership of an evidence root.
 * Uses O_CREAT|O_EXCL semantics via fs.open(..., 'wx').
 * Does not delete stale locks — caller must use a new versioned root.
 */
export function acquireEvidenceRootLock({
  evidenceRoot,
  sourceSha = null,
  launcherPath = null,
  runId = null,
} = {}) {
  const root = canonicalEvidenceRoot(evidenceRoot);

  if (
    fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE')) ||
    fs.existsSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE'))
  ) {
    const err = new Error(`EVIDENCE_ROOT_FROZEN:${root}`);
    err.code = 'EVIDENCE_ROOT_FROZEN';
    throw err;
  }
  const finalizedNames = [
    'real-model-full-eval.json',
    'real-model-pilot.json',
    'real-model-canary.json',
    'gateway-smoke.json',
  ];
  for (const name of finalizedNames) {
    if (fs.existsSync(path.join(root, name))) {
      const err = new Error(`EVIDENCE_ROOT_ALREADY_FINALIZED:${root}`);
      err.code = 'EVIDENCE_ROOT_ALREADY_FINALIZED';
      throw err;
    }
  }

  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  precreateEvidenceLayout(root);

  const lockPath = path.join(root, 'locks', 'writer-lock.json');
  const resolvedLauncher =
    launcherPath ||
    (typeof process !== 'undefined' && process.argv?.[1] ? path.resolve(process.argv[1]) : null);
  const launcherSha =
    resolvedLauncher && fs.existsSync(resolvedLauncher) ? sha256File(resolvedLauncher) : null;
  const payload = {
    schema_version: WRITER_LOCK_SCHEMA,
    run_id: runId || crypto.randomUUID(),
    pid: process.pid,
    process_start_time: new Date().toISOString(),
    hostname: os.hostname(),
    source_sha: sourceSha,
    launcher_path: resolvedLauncher,
    launcher_sha256: launcherSha,
    evidence_root: root,
    created_at: new Date().toISOString(),
  };

  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      const err = new Error(`EVIDENCE_ROOT_ALREADY_OWNED:${root}`);
      err.code = 'EVIDENCE_ROOT_ALREADY_OWNED';
      err.lock_path = lockPath;
      try {
        err.existing_lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch {
        err.existing_lock = null;
      }
      throw err;
    }
    throw e;
  }

  const body = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(lockFd, body);
  fs.fsyncSync(lockFd);

  const heartbeatPath = path.join(root, 'run-state', 'writer-heartbeat.json');
  const checkpointPath = path.join(root, 'run-state', 'checkpoint.json');

  const handle = {
    root,
    lockPath,
    lockFd,
    payload,
    heartbeatPath,
    checkpointPath,
    writeHeartbeat(extra = {}) {
      writeAtomicJson(heartbeatPath, {
        schema_version: 'phase34-writer-heartbeat-v1',
        run_id: payload.run_id,
        pid: process.pid,
        evidence_root: root,
        at: new Date().toISOString(),
        ...extra,
      });
    },
    writeCheckpoint(state) {
      writeAtomicJson(checkpointPath, {
        schema_version: CHECKPOINT_SCHEMA,
        run_id: payload.run_id,
        pid: process.pid,
        evidence_root: root,
        at: new Date().toISOString(),
        ...state,
      });
    },
    release({ unlinkLock = false } = {}) {
      try {
        if (handle.lockFd != null) fs.closeSync(handle.lockFd);
      } catch {
        /* ignore */
      }
      handle.lockFd = null;
      // Default: do NOT unlink — stale/incomplete roots refuse reuse.
      if (unlinkLock && fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    },
  };

  handle.writeHeartbeat({ phase: 'acquired' });
  handle.writeCheckpoint({
    state: 'INITIALIZED_NO_ROWS',
    sessions_completed: 0,
    model_eligible_turns: 0,
    model_invoked_turns: 0,
    model_success_turns: 0,
    unexpected_rule_fallbacks: 0,
    hard_failure_count: 0,
    writer_count: 1,
  });

  return handle;
}

/**
 * Count Node Stage-D writers from a ps snapshot for a specific evidence root.
 * Excludes bash/monitor processes that merely mention the script string.
 * Only counts lines that reference the canonical root path (env-only writers
 * must be detected via the launcher lock / lsof, not this heuristic).
 */
export function countNodeWritersForRoot(evidenceRoot, { psOutput = null } = {}) {
  const target = canonicalEvidenceRoot(evidenceRoot);
  const text =
    psOutput != null
      ? String(psOutput)
      : execSync('ps -ax -o pid= -o command=', { encoding: 'utf8' });
  let n = 0;
  for (const line of text.split('\n')) {
    if (!/\bnode\b/.test(line)) continue;
    if (!line.includes('phase34-runtime-real-model-full-eval')) continue;
    if (!line.includes('.mjs')) continue;
    // Monitor false-positive: bash -c '...phase34-runtime-real-model-full-eval...'
    if (/^\s*\d+\s+(bash|sh|zsh)\b/.test(line)) continue;
    if (!(line.includes(target) || line.includes(String(evidenceRoot)))) continue;
    n += 1;
  }
  return n;
}

export function launcherFilePathFromMeta(importMetaUrl) {
  return fileURLToPath(importMetaUrl);
}
