/**
 * Phase 31L — shared preview window coordinator for parallel h1/h2/h3 matrix shards.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  expectedGate,
  previewApi,
  previewEnroll,
  previewRevoke,
  ragGateReason,
  jwtSub,
  sleepMs,
} from './phase22-full-replay-common.mjs';

export const DEFAULT_EXPECTED_PROTOCOLS = ['h1', 'h2', 'h3'];

export function defaultWindowStatus() {
  return {
    lifecycle_reset_done: false,
    gate_verified: false,
    started_protocols: [],
    completed_protocols: [],
    reset_count: 0,
    updated_at: null,
  };
}

export function defaultCoordinatorState(matrixId = 'phase31', expectedProtocols = DEFAULT_EXPECTED_PROTOCOLS) {
  return {
    matrix_id: matrixId,
    active_window: 0,
    expected_protocols: [...expectedProtocols],
    window_status: {},
  };
}

export function validateParticipantIdentity(user, token) {
  const subject = jwtSub(token);
  if (subject !== user.uid) {
    throw new Error(
      `participant identity mismatch: email=${user.email} jwt_sub=${subject} artifact_uid=${user.uid}`,
    );
  }
  return true;
}

export function readParticipantGate(token, userId, cfg) {
  const statusGate = previewApi('GET', 'status', token, userId, cfg).body?.gate_reason;
  const ragGate = ragGateReason(token, userId, cfg);
  return { statusGate, ragGate };
}

export function resetAndVerifyWindowGates(users, getToken, cfg) {
  for (const user of users) {
    if (user.role === 'allowlist') continue;
    previewRevoke(getToken(user.email), user.uid, cfg);
  }
  for (const user of users) {
    if (user.role === 'allowlist') continue;
    previewEnroll(getToken(user.email), user.uid, cfg);
  }

  const failures = [];
  for (const user of users) {
    const expected = expectedGate(user);
    const token = getToken(user.email);
    let { statusGate, ragGate } = readParticipantGate(token, user.uid, cfg);
    let observed = statusGate === ragGate ? statusGate : ragGate;

    if (observed !== expected) {
      previewEnroll(token, user.uid, cfg);
      ({ statusGate, ragGate } = readParticipantGate(token, user.uid, cfg));
      observed = statusGate === ragGate ? statusGate : ragGate;
    }

    if (observed !== expected) {
      failures.push({
        user_class: user.user_class,
        role: user.role,
        uid_prefix: `${user.uid.slice(0, 8)}…`,
        expected_gate_reason: expected,
        observed_gate_reason: observed,
        status_gate: statusGate,
        rag_gate: ragGate,
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

export class PreviewWindowCoordinator {
  constructor(matrixRoot, options = {}) {
    this.matrixRoot = matrixRoot;
    this.matrixId = options.matrixId || 'phase31';
    this.expectedProtocols = options.expectedProtocols || DEFAULT_EXPECTED_PROTOCOLS;
    this.windowSequence = options.windowSequence || null;
    this.staleLockMs = options.staleLockMs ?? 10 * 60 * 1000;
    this.pollMs = options.pollMs ?? 50;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 30 * 60 * 1000;
    this.coordinatorDir = path.join(matrixRoot, 'window-coordinator');
    this.statePath = path.join(this.coordinatorDir, 'state.json');
    this.lockDir = path.join(this.coordinatorDir, 'lock');
    this.lockMetaPath = path.join(this.lockDir, 'meta.json');
    fs.mkdirSync(this.coordinatorDir, { recursive: true });
    if (!fs.existsSync(this.statePath)) {
      this.writeState(defaultCoordinatorState(this.matrixId, this.expectedProtocols));
    }
  }

  readState() {
    return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
  }

  writeState(state) {
    fs.writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  isLockStale() {
    if (!fs.existsSync(this.lockMetaPath)) return true;
    try {
      const meta = JSON.parse(fs.readFileSync(this.lockMetaPath, 'utf8'));
      const age = Date.now() - Date.parse(meta.acquired_at);
      return age > this.staleLockMs;
    } catch {
      return true;
    }
  }

  acquireLock(protocol = null) {
    let staleLockRecovered = false;
    let lockOwnerProtocol = null;
    let lockOwnerPid = null;
    const lockWaitStart = Date.now();
    const deadline = Date.now() + this.waitTimeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(this.lockMetaPath)) {
        try {
          const prior = JSON.parse(fs.readFileSync(this.lockMetaPath, 'utf8'));
          lockOwnerProtocol = prior.protocol ?? null;
          lockOwnerPid = Number.isFinite(Number(prior.pid)) ? Number(prior.pid) : null;
        } catch {
          /* ignore unreadable lock meta */
        }
      }
      try {
        fs.mkdirSync(this.lockDir, { recursive: false });
        fs.writeFileSync(
          this.lockMetaPath,
          `${JSON.stringify(
            { pid: process.pid, protocol, acquired_at: new Date().toISOString() },
            null,
            2,
          )}\n`,
          'utf8',
        );
        return {
          coordinator_lock_wait_ms: Date.now() - lockWaitStart,
          coordinator_stale_lock_recovered: staleLockRecovered,
          coordinator_lock_owner_protocol: lockOwnerProtocol,
          coordinator_lock_owner_pid: lockOwnerPid,
        };
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
        if (this.isLockStale()) {
          staleLockRecovered = true;
          this.forceReleaseLock();
          continue;
        }
        sleepMs(this.pollMs);
      }
    }
    throw new Error(`coordinator lock timeout: ${this.lockDir}`);
  }

  forceReleaseLock() {
    try {
      if (fs.existsSync(this.lockMetaPath)) fs.unlinkSync(this.lockMetaPath);
      if (fs.existsSync(this.lockDir)) fs.rmdirSync(this.lockDir);
    } catch {
      /* best effort stale recovery */
    }
  }

  releaseLock() {
    try {
      if (fs.existsSync(this.lockMetaPath)) fs.unlinkSync(this.lockMetaPath);
      if (fs.existsSync(this.lockDir)) fs.rmdirSync(this.lockDir);
    } catch (err) {
      throw new Error(`failed to release coordinator lock: ${err.message}`);
    }
  }

  withLock(fn, protocol = null) {
    const lockMeta = this.acquireLock(protocol);
    try {
      return fn(lockMeta);
    } finally {
      this.releaseLock();
    }
  }

  waitForCondition(label, predicate) {
    const deadline = Date.now() + this.waitTimeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      sleepMs(this.pollMs);
    }
    throw new Error(`coordinator wait timeout: ${label}`);
  }

  windowComplete(window, state = this.readState()) {
    const ws = state.window_status[String(window)];
    if (!ws) return false;
    return this.expectedProtocols.every((p) => ws.completed_protocols.includes(p));
  }

  previousWindowInSequence(window) {
    if (!this.windowSequence?.length) {
      return window > 1 ? window - 1 : null;
    }
    const idx = this.windowSequence.indexOf(window);
    if (idx <= 0) return null;
    return this.windowSequence[idx - 1];
  }

  waitForPreviousWindowComplete(window) {
    const prev = this.previousWindowInSequence(window);
    if (prev == null) return;
    this.waitForCondition(`window ${prev} complete before ${window}`, () =>
      this.windowComplete(prev),
    );
  }

  enterWindow(window, protocol, { resetAndVerify }) {
    if (!this.expectedProtocols.includes(protocol)) {
      throw new Error(`unexpected protocol for coordinator: ${protocol}`);
    }

    const timing = {
      coordinator_wait_ms: 0,
      window_reset_ms: 0,
      coordinator_lock_wait_ms: 0,
      coordinator_stale_lock_recovered: false,
      coordinator_lock_owner_protocol: null,
      coordinator_lock_owner_pid: null,
    };
    const waitStart = Date.now();
    this.waitForPreviousWindowComplete(window);
    timing.coordinator_wait_ms = Date.now() - waitStart;

    return this.withLock((lockMeta) => {
      timing.coordinator_lock_wait_ms = lockMeta.coordinator_lock_wait_ms ?? 0;
      timing.coordinator_stale_lock_recovered = lockMeta.coordinator_stale_lock_recovered === true;
      timing.coordinator_lock_owner_protocol = lockMeta.coordinator_lock_owner_protocol ?? null;
      timing.coordinator_lock_owner_pid = lockMeta.coordinator_lock_owner_pid ?? null;
      const state = this.readState();
      const key = String(window);
      const ws = state.window_status[key] || defaultWindowStatus();

      if (!ws.lifecycle_reset_done) {
        const resetStart = Date.now();
        const verify = resetAndVerify();
        timing.window_reset_ms = Date.now() - resetStart;
        if (!verify.ok) {
          const err = new Error(
            `preview gate verification failed for window ${window}: ${JSON.stringify(verify.failures)}`,
          );
          err.code = 'PHASE31_GATE_VERIFY_BLOCKED';
          err.failures = verify.failures;
          throw err;
        }
        ws.lifecycle_reset_done = true;
        ws.gate_verified = true;
        ws.reset_count = (ws.reset_count || 0) + 1;
      } else if (!ws.gate_verified) {
        throw new Error(`window ${window} lifecycle_reset_done without gate_verified`);
      }

      if (!ws.started_protocols.includes(protocol)) {
        ws.started_protocols.push(protocol);
      }
      ws.updated_at = new Date().toISOString();
      state.active_window = window;
      state.window_status[key] = ws;
      this.writeState(state);
      return { reset_count: ws.reset_count, gate_verified: ws.gate_verified, timing };
    }, protocol);
  }

  completeWindowProtocol(window, protocol) {
    return this.withLock(() => {
      const state = this.readState();
      const key = String(window);
      const ws = state.window_status[key] || defaultWindowStatus();
      if (!ws.completed_protocols.includes(protocol)) {
        ws.completed_protocols.push(protocol);
      }
      ws.updated_at = new Date().toISOString();
      state.window_status[key] = ws;
      this.writeState(state);
      return { completed_protocols: [...ws.completed_protocols] };
    });
  }

  getWindowStatus(window) {
    return this.readState().window_status[String(window)] || defaultWindowStatus();
  }

  getResetCount(window) {
    return this.getWindowStatus(window).reset_count || 0;
  }
}

export function coordinatorRootFromRunnerOut(outDir) {
  const base = path.basename(outDir);
  if (base.startsWith('shard-')) return path.dirname(outDir);
  return outDir;
}
