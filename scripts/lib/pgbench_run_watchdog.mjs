/**
 * Lightweight read-only progress / stall watchdog for Gate-3 sequential runs.
 * Observes logs + process liveness only — never mutates benchmarks or auth flags.
 * Watchdog persistence is crash-safe (temp file + rename) and limited to
 * watchdog/latest.json and watchdog/history.json.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @param {string} text
 * @returns {Array<{ executed: number, pending_remaining?: number, status?: string, cell_id?: string, tps?: number, raw: string }>}
 */
export function parseProgressLog(text) {
  /** @type {any[]} */
  const events = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"progress"')) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.progress !== true) continue;
      events.push({
        executed: Number(obj.executed),
        pending_remaining: obj.pending_remaining != null ? Number(obj.pending_remaining) : undefined,
        status: obj.status,
        cell_id: obj.cell_id,
        tps: obj.tps != null ? Number(obj.tps) : undefined,
        at_ms: obj.at_ms != null ? Number(obj.at_ms) : undefined,
        raw: trimmed,
      });
    } catch {
      // skip non-json
    }
  }
  return events;
}

/**
 * Timestamp of last *real* progress (new cell or owner_valid_cells increase).
 * Unrelated log mtime, warnings, and repeated same executed/cell_id MUST NOT win.
 *
 * @param {{
 *   now_ms: number,
 *   log_mtime_ms?: number | null,
 *   events?: Array<{ executed?: number, cell_id?: string, at_ms?: number }>,
 *   history_samples?: Array<{ at_ms?: number, owner_valid_cells?: number, executed?: number, cell_id?: string }>,
 *   owner_valid_cells?: number,
 * }} opts
 * @returns {number | null}
 */
export function resolveLastProgressAtMs(opts) {
  void opts.log_mtime_ms;
  const events = opts.events || [];
  const hist = [...(opts.history_samples || [])].sort(
    (a, b) => Number(a.at_ms) - Number(b.at_ms),
  );
  /** @type {number | null} */
  let ts = null;
  const consider = (ms) => {
    if (ms == null || !Number.isFinite(Number(ms))) return;
    const n = Number(ms);
    if (ts == null || n > ts) ts = n;
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const prev = i > 0 ? events[i - 1] : null;
    const isNew =
      !prev ||
      Number(ev.executed) !== Number(prev.executed) ||
      String(ev.cell_id ?? "") !== String(prev.cell_id ?? "");
    if (isNew) consider(ev.at_ms);
  }

  for (let i = 0; i < hist.length; i++) {
    const s = hist[i];
    const prev = i > 0 ? hist[i - 1] : null;
    const isNew =
      !prev ||
      Number(s.owner_valid_cells) > Number(prev.owner_valid_cells) ||
      Number(s.executed) !== Number(prev.executed) ||
      String(s.cell_id ?? "") !== String(prev.cell_id ?? "");
    if (isNew) consider(s.at_ms);
  }

  const lastHist = hist[hist.length - 1];
  const lastEv = events[events.length - 1];
  const validNow = opts.owner_valid_cells;
  const validIncreased =
    lastHist &&
    validNow != null &&
    Number(validNow) > Number(lastHist.owner_valid_cells);
  const cellIncreasedVsHist =
    lastHist &&
    lastEv &&
    (Number(lastEv.executed) !== Number(lastHist.executed) ||
      String(lastEv.cell_id ?? "") !== String(lastHist.cell_id ?? ""));

  if (validIncreased || cellIncreasedVsHist) {
    if (lastEv?.at_ms != null) consider(lastEv.at_ms);
    else consider(opts.now_ms);
  }

  if (ts == null && events.length > 0 && hist.length === 0) {
    consider(opts.now_ms);
  }

  return ts;
}

/**
 * @param {{
 *   now_ms: number,
 *   runner_alive: boolean,
 *   pgbench_alive: boolean,
 *   last_progress_at_ms: number | null,
 *   stall_after_ms: number,
 *   expected_cell_seconds?: number,
 *   last_progress?: { executed?: number, cell_id?: string, status?: string } | null,
 *   owner_valid_cells?: number,
 *   owner_expected_cells?: number,
 *   owner_complete?: boolean,
 * }} snap
 */
export function evaluateRunWatchdog(snap) {
  const owner_expected = Number(snap.owner_expected_cells ?? 1218);
  const owner_valid = Number(snap.owner_valid_cells ?? 0);
  const owner_complete =
    snap.owner_complete != null
      ? Boolean(snap.owner_complete)
      : owner_valid === owner_expected && owner_expected > 0;
  const lastAt = snap.last_progress_at_ms;
  const age_ms = lastAt == null ? null : Math.max(0, snap.now_ms - lastAt);
  const stall_after = Number(snap.stall_after_ms);

  if (!snap.runner_alive) {
    return {
      state: "STOPPED",
      stalled: false,
      reason: "runner process not found",
      age_ms,
      owner_valid_cells: owner_valid,
      owner_expected_cells: owner_expected,
      owner_complete,
      last_progress: snap.last_progress || null,
      pgbench_ceiling_complete: false,
    };
  }

  if (lastAt == null) {
    return {
      state: "WAITING_FOR_FIRST_PROGRESS",
      stalled: age_ms != null ? false : true,
      reason: "no progress events observed yet",
      age_ms,
      owner_valid_cells: owner_valid,
      owner_expected_cells: owner_expected,
      owner_complete,
      last_progress: null,
      pgbench_ceiling_complete: false,
    };
  }

  if (age_ms != null && age_ms > stall_after) {
    return {
      state: "STALLED",
      stalled: true,
      reason: `no progress for ${Math.round(age_ms / 1000)}s (threshold ${Math.round(stall_after / 1000)}s); pgbench_alive=${snap.pgbench_alive}`,
      age_ms,
      owner_valid_cells: owner_valid,
      owner_expected_cells: owner_expected,
      owner_complete,
      last_progress: snap.last_progress || null,
      pgbench_ceiling_complete: false,
    };
  }

  return {
    state: "RUNNING",
    stalled: false,
    reason: null,
    age_ms,
    owner_valid_cells: owner_valid,
    owner_expected_cells: owner_expected,
    owner_complete,
    last_progress: snap.last_progress || null,
    pgbench_alive: snap.pgbench_alive,
    expected_cell_seconds: snap.expected_cell_seconds ?? 150,
    pgbench_ceiling_complete: false,
  };
}

/**
 * Monotonic history: returns a new document with one added sample.
 * Logical append only — callers rewrite the whole JSON file; this is not
 * filesystem append-only.
 * @param {{ samples?: any[] } | null | undefined} history
 * @param {Record<string, unknown>} sample
 * @param {{ max_samples?: number }} [opts]
 */
export function appendWatchdogHistory(history, sample, opts = {}) {
  const max = Number(opts.max_samples || 500);
  const prev = Array.isArray(history?.samples) ? history.samples : [];
  const samples = [...prev, { ...sample }];
  const trimmed = samples.length > max ? samples.slice(samples.length - max) : samples;
  return {
    schema: "record-platform-pgbench-watchdog-history/v1",
    samples: trimmed,
  };
}

/**
 * ETA from observed valid-cell rate; also report contract floor (150s/cell).
 * Never sets owner_complete/ceiling from ETA alone beyond reporting remaining=0.
 *
 * @param {{
 *   owner_valid_cells: number,
 *   owner_expected_cells: number,
 *   samples: Array<{ at_ms: number, owner_valid_cells: number }>,
 *   fallback_seconds_per_cell?: number,
 * }} opts
 */
export function estimateOwnerEta(opts) {
  const expected = Number(opts.owner_expected_cells);
  const valid = Number(opts.owner_valid_cells);
  const remaining = Math.max(0, expected - valid);
  const floorSec = Number(opts.fallback_seconds_per_cell ?? 150);
  const samples = (opts.samples || [])
    .filter((s) => s && Number.isFinite(s.at_ms) && Number.isFinite(s.owner_valid_cells))
    .sort((a, b) => a.at_ms - b.at_ms);

  let seconds_per_cell_observed = null;
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dCells = last.owner_valid_cells - first.owner_valid_cells;
    const dSec = (last.at_ms - first.at_ms) / 1000;
    if (dCells > 0 && dSec > 0) {
      seconds_per_cell_observed = dSec / dCells;
    }
  }

  const rate = seconds_per_cell_observed ?? floorSec;
  return {
    remaining_cells: remaining,
    seconds_per_cell_observed,
    seconds_per_cell_contract_floor: floorSec,
    eta_seconds_observed: remaining * rate,
    eta_hours_observed: (remaining * rate) / 3600,
    eta_seconds_contract_floor: remaining * floorSec,
    eta_hours_contract_floor: (remaining * floorSec) / 3600,
    owner_complete: false,
    pgbench_ceiling_complete: false,
    note:
      "ETA is observational only (observed rate and/or theoretical 150s/cell floor); does not authorize completion, tuning, or protocol",
  };
}

/**
 * Crash-safe JSON write: same-directory temp file, fsync(file), rename,
 * then fsync(parent directory) so the rename is durable across power loss.
 * Does not change benchmark/completion semantics. Allowed watchdog writes only.
 *
 * @param {string} targetPath
 * @param {unknown} value
 * @param {{
 *   renameSync?: (from: string, to: string) => void,
 *   fsyncDirSync?: (dir: string) => void,
 * }} [hooks]
 */
export function writeJsonAtomic(targetPath, value, hooks = {}) {
  const renameFn = hooks.renameSync ?? renameSync;
  const fsyncDirFn = hooks.fsyncDirSync ?? fsyncDirectory;
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(value, null, 2) + "\n";
  try {
    const fd = openSync(tmpPath, "w");
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameFn(tmpPath, targetPath);
    fsyncDirFn(dirname(targetPath));
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // tmp already renamed away, or never created
    }
    throw err;
  }
}

/**
 * @param {string} dir
 */
function fsyncDirectory(dir) {
  const dirFd = openSync(dir, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}
