/**
 * Durable in-flight cell/phase state for Gate-3 supervisor stall and retry.
 * Observational execution state — not a benchmark result checkpoint.
 */
import { writeJsonAtomic } from "./pgbench_run_watchdog.mjs";

export const IN_FLIGHT_SCHEMA = "record-platform-pgbench-in-flight/v1";

export const IN_FLIGHT_PHASES = Object.freeze([
  "IDLE",
  "SEEDING",
  "WARMUP_CONNECTING",
  "WARMUP_RUNNING",
  "MEASURE_CONNECTING",
  "MEASURE_RUNNING",
  "CHECKPOINTING",
  "CLEANUP",
]);

/** Documented from observed c256 PASS connect times (984s, 710s). */
export const CONNECTION_ALLOWANCE_MS = 1_100_000;
const SLACK_MS = 60_000;
const WARMUP_MS = 30_000;
const MEASURED_MS = 120_000;

export const PHASE_STALL_AFTER_MS = Object.freeze({
  IDLE: null,
  SEEDING: 15 * 60 * 1000,
  WARMUP_CONNECTING: CONNECTION_ALLOWANCE_MS + SLACK_MS,
  WARMUP_RUNNING: WARMUP_MS + SLACK_MS,
  MEASURE_CONNECTING: CONNECTION_ALLOWANCE_MS + MEASURED_MS + SLACK_MS,
  MEASURE_RUNNING: MEASURED_MS + SLACK_MS,
  CHECKPOINTING: 120 * 1000,
  CLEANUP: 15 * 60 * 1000,
});

export const TERMINAL_SUPERVISOR_ACTIONS = Object.freeze([
  "CELL_REPEATEDLY_UNEXECUTABLE",
  "CONTROL_PLANE_PROVENANCE_MISMATCH",
  "SOURCE_PROVENANCE_MISMATCH",
  "FROZEN_RUN_IDENTITY_MISMATCH",
]);

export function phaseStallAfterMs(phase) {
  if (phase == null || !Object.prototype.hasOwnProperty.call(PHASE_STALL_AFTER_MS, phase)) {
    return null;
  }
  return PHASE_STALL_AFTER_MS[phase];
}

export function actualInFlightCellId(opts = {}) {
  const inflight = opts.in_flight || opts.inFlight;
  if (inflight?.cell_id && inflight.phase && inflight.phase !== "IDLE") {
    return inflight.cell_id;
  }
  return inflight?.cell_id || opts.last_completed_cell_id || opts.lastCompletedCellId || null;
}

export function evaluateInFlightStall(opts) {
  const now = Number(opts.now_ms);
  const inflight = opts.in_flight || null;
  const actual_cell_id = inflight?.cell_id || null;
  if (!opts.runner_alive) {
    return {
      stalled: false,
      actual_cell_id,
      used_last_checkpoint_age: false,
      reason: "runner_dead",
    };
  }
  if (!inflight?.cell_id || inflight.phase === "IDLE") {
    return {
      stalled: false,
      actual_cell_id,
      used_last_checkpoint_age: false,
      reason: "no_in_flight_or_idle",
    };
  }
  void opts.last_progress_at_ms;
  void opts.last_completed_cell_id;
  const expectsPgbench = [
    "WARMUP_CONNECTING",
    "WARMUP_RUNNING",
    "MEASURE_CONNECTING",
    "MEASURE_RUNNING",
  ].includes(inflight.phase);
  if (expectsPgbench && inflight.pgbench_pid && opts.pgbench_alive === false) {
    return {
      stalled: true,
      actual_cell_id: inflight.cell_id,
      used_last_checkpoint_age: false,
      reason: "pgbench_dead_in_active_phase",
    };
  }
  const deadline = phaseStallAfterMs(inflight.phase);
  const progressAt = Number(inflight.last_phase_progress_at ?? inflight.phase_started_at);
  const age = Number.isFinite(progressAt) ? now - progressAt : 0;
  if (deadline != null && age > deadline) {
    return {
      stalled: true,
      actual_cell_id: inflight.cell_id,
      used_last_checkpoint_age: false,
      reason: "phase_deadline",
      age_ms: age,
      deadline_ms: deadline,
    };
  }
  return {
    stalled: false,
    actual_cell_id: inflight.cell_id,
    used_last_checkpoint_age: false,
    reason: null,
    age_ms: age,
    deadline_ms: deadline,
  };
}

export function buildRestartIncident(opts) {
  const inflight = opts.in_flight || {};
  const pins = opts.pins || {};
  const actual =
    opts.decision?.incident_cell_id || inflight.cell_id || opts.last_completed_cell_id || null;
  return {
    schema: "record-platform-pgbench-supervisor-incident/v2",
    at: opts.at || new Date().toISOString(),
    action: opts.decision?.action || "STALL_RESTART",
    actual_cell_id: actual,
    last_completed_cell_id: opts.last_completed_cell_id || null,
    cell_id: actual,
    phase: inflight.phase || null,
    phase_started_at: inflight.phase_started_at || null,
    last_phase_progress_at: inflight.last_phase_progress_at || null,
    runner_pid: opts.runner_pid ?? inflight.runner_pid ?? null,
    pgbench_pid: opts.pgbench_pid ?? inflight.pgbench_pid ?? null,
    pgbench_argv: inflight.pgbench_argv || opts.pgbench_argv || null,
    signal: opts.signal ?? null,
    exit_code: opts.exit_code ?? null,
    retry_count_for_actual_cell: Number(opts.retry_count_for_actual_cell || 0),
    git_sha: pins.git_sha || null,
    control_plane_bundle_sha: pins.control_plane_bundle_sha || null,
    catalog_sha: pins.catalog_sha || null,
    source_bundle_sha: pins.source_bundle_sha || pins.workload_source_bundle_sha || null,
    run_id: pins.run_id || inflight.run_id || null,
  };
}

export function reconstructAdoptionRetryState(opts) {
  const inflight = opts.in_flight;
  const actual = actualInFlightCellId({
    in_flight: inflight,
    last_completed_cell_id: opts.last_completed_cell_id,
  });
  const { countCellRestarts } = opts;
  const countFn =
    countCellRestarts ||
    ((incidents, cellId) =>
      (incidents || []).filter((i) => i && (i.actual_cell_id || i.cell_id) === cellId).length);
  let retries = countFn(opts.incidents || [], actual);
  const term = opts.previous_terminal_state;
  const terminalForActual =
    term?.action === "CELL_REPEATEDLY_UNEXECUTABLE" &&
    (term.actual_cell_id === actual || term.cell_id === actual);
  const max = Number(opts.max_restarts_per_cell ?? 3);
  if (terminalForActual) retries = Math.max(retries, max);
  return {
    actual_cell_id: actual,
    retries_for_actual_cell: retries,
    exhausted: retries >= max,
  };
}

export function classifyMonitorHealth(opts) {
  const runner = Boolean(opts.runner_alive);
  const supervisor = Boolean(opts.supervisor_alive);
  const incomplete = Boolean(opts.run_incomplete);
  if (runner && supervisor) return { healthy: true, incident: null };
  if (runner && !supervisor && incomplete) {
    return { healthy: false, incident: "UNSUPERVISED_RUNNER" };
  }
  if (!runner && supervisor) {
    return { healthy: true, incident: null, note: "supervisor_recovery" };
  }
  if (!runner && !supervisor && incomplete) {
    return { healthy: false, incident: "RUN_STOPPED_INCOMPLETE" };
  }
  return { healthy: true, incident: null };
}

export function writeInFlightAtomic(path, doc) {
  writeJsonAtomic(path, { schema: IN_FLIGHT_SCHEMA, ...doc });
}

export function terminalProcessSafety(action) {
  const terminal = TERMINAL_SUPERVISOR_ACTIONS.includes(action);
  return {
    terminal,
    terminate: terminal,
    terminate_targets: terminal ? ["runner", "pgbench"] : [],
    launch: false,
  };
}

export function verifyTerminalCleanup(opts = {}) {
  const runner_process_count = Number(opts.runner_process_count || 0);
  const pgbench_process_count = Number(opts.pgbench_process_count || 0);
  return {
    ok: runner_process_count === 0 && pgbench_process_count === 0,
    runner_process_count,
    pgbench_process_count,
  };
}
