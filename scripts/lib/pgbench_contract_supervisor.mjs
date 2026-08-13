/**
 * Active Gate-3 completion supervisor (not the read-only watchdog).
 * Keeps exactly one contract runner alive on a single contention domain.
 * Does not modify evaluateOwnerComplete or benchmark checkpoint writers.
 */
import { PER_OWNER_OPERATIONAL_ORDER, isReusableContractCell } from "./pgbench_resume.mjs";
import { resolveLastProgressAtMs } from "./pgbench_run_watchdog.mjs";
import { prepareIsolatedShardLaunch } from "./pgbench_isolated_shard_launcher.mjs";

export { prepareIsolatedShardLaunch };

export const MAX_RESTARTS_PER_CELL = 3;

export const FROZEN_LAUNCH_ENV = {
  GATE3_CONTRACT: "1",
  GATE3_SHARD_ID: "sequential-shared-colima",
  GATE3_ENVIRONMENT_ID: "colima-shared-domain",
};

const AUTH_BLOCKED = {
  protocol_execution_authorized: false,
  execution_authorized: false,
  end_harness_execution_authorized: false,
  track_c_acceptance_pass: false,
  platform_pass: false,
  tuning: "NO_GO",
  protocol: "NO_GO",
};

export function frozenOwnerSequence() {
  return [...PER_OWNER_OPERATIONAL_ORDER];
}

/**
 * Catalog coverage invariant. Canonical PER_OWNER_CEILING + ALL_OWNERS_CONCURRENT = 14616.
 * @param {any[] | { cells?: any[] }} catalogOrCells
 */
export function catalogCountInvariant(catalogOrCells) {
  const cells = Array.isArray(catalogOrCells) ? catalogOrCells : catalogOrCells?.cells || [];
  const canonical_cells = cells.filter((c) => c.mode === "PER_OWNER_CEILING").length;
  const all_owner_cells = cells.filter((c) => c.mode === "ALL_OWNERS_CONCURRENT").length;
  const expected_cell_count = cells.length;
  return {
    expected_cell_count,
    canonical_cells,
    all_owner_cells,
    ok:
      expected_cell_count === 14616 &&
      canonical_cells + all_owner_cells === expected_cell_count &&
      canonical_cells === 13398 &&
      all_owner_cells === 1218,
  };
}

/**
 * Next required work from frozen catalog pending cells (checkpoint-derived), not prose lists.
 * @param {any[]} pendingCells
 */
export function nextRequiredFromCatalog(pendingCells) {
  const pending = pendingCells || [];
  const incomplete_owners = [
    ...new Set(
      pending.filter((c) => c.mode === "PER_OWNER_CEILING" && c.owner).map((c) => c.owner),
    ),
  ];
  const concurrent = pending.filter((c) => c.mode === "ALL_OWNERS_CONCURRENT");
  return {
    next_cell: pending[0] || null,
    incomplete_owners,
    next_owner: incomplete_owners[0] || (concurrent.length ? "ALL_OWNERS_CONCURRENT" : null),
    concurrent_remaining: concurrent.length,
  };
}

export function planSupervisorShutdown(_opts = {}) {
  return {
    terminate_runner: false,
    terminate_pgbench: false,
    mutate_checkpoints: false,
    persist_state: true,
    release_lock: true,
    kill_pids: [],
  };
}

/**
 * Release lock only if it belongs to this supervisor PID.
 * @param {{ existing?: { pid?: number } | null, self_pid: number }} opts
 */
export function releaseSupervisorLock(opts) {
  if (!opts.existing || Number(opts.existing.pid) !== Number(opts.self_pid)) {
    return { release: false };
  }
  return { release: true };
}

export function buildSupervisorStatus(fields) {
  return {
    schema: "record-platform-pgbench-supervisor-status/v1",
    checked_at: fields.checked_at || new Date().toISOString(),
    supervisor_pid: fields.supervisor_pid,
    runner_pid: fields.runner_pid ?? null,
    current_owner: fields.owner ?? fields.current_owner ?? null,
    current_cell: fields.current_cell ?? null,
    owner_valid: fields.owner_valid ?? 0,
    owner_expected: fields.owner_expected ?? 1218,
    global_valid: fields.global_valid ?? 0,
    global_expected: 14616,
    last_logical_progress_at: fields.last_logical_progress_at ?? null,
    seconds_per_cell_observed: fields.seconds_per_cell_observed ?? null,
    eta_owner: fields.eta_owner ?? null,
    eta_global: fields.eta_global ?? null,
    restart_count: fields.restart_count ?? 0,
    incident_count: fields.incident_count ?? 0,
    action: fields.action,
    pgbench_ceiling_complete: fields.pgbench_ceiling_complete === true,
    tuning: "NO_GO",
    protocol: "NO_GO",
  };
}

export function resolveSupervisorProgressAtMs(opts) {
  return resolveLastProgressAtMs(opts);
}

export function countReusableCells(results) {
  return (results || []).filter((row) => isReusableContractCell(row)).length;
}

export function countCellRestarts(incidents, cellId) {
  return (incidents || []).filter((i) => i && i.cell_id === cellId).length;
}

/**
 * @param {Record<string, unknown>} frozen
 * @param {Record<string, unknown>} observed
 */
export function assertFrozenRunIdentity(frozen, observed) {
  const keys = [
    "resume_dir",
    "git_sha",
    "catalog_sha",
    "environment_fingerprint",
    "warmup_seconds",
    "measured_seconds",
    "expected_cell_count",
    "expected_owner_cells",
    "workload_revision",
  ];
  for (const key of keys) {
    if (frozen?.[key] !== observed?.[key]) {
      return {
        ok: false,
        code: "FROZEN_RUN_IDENTITY_MISMATCH",
        field: key,
        frozen: frozen?.[key],
        observed: observed?.[key],
      };
    }
  }
  return { ok: true, code: null };
}

/**
 * @param {{
 *   existing?: { pid: number, run_dir?: string } | null,
 *   self_pid: number,
 *   isPidAlive: (pid: number) => boolean,
 * }} opts
 */
export function evaluateSupervisorLock(opts) {
  const existing = opts.existing;
  if (!existing || existing.pid == null) {
    return { acquire: true, recover_stale: false, reason: null };
  }
  if (Number(existing.pid) === Number(opts.self_pid)) {
    return { acquire: true, recover_stale: false, held_by_self: true, reason: null };
  }
  if (opts.isPidAlive(Number(existing.pid))) {
    return { acquire: false, recover_stale: false, reason: "SUPERVISOR_LOCK_HELD" };
  }
  return { acquire: true, recover_stale: true, reason: null };
}

function nextOwner(owner) {
  const seq = frozenOwnerSequence();
  const idx = seq.indexOf(owner);
  if (idx < 0 || idx >= seq.length - 1) return "ALL_OWNERS_CONCURRENT";
  return seq[idx + 1];
}

export function frozenLaunchEnv(identity) {
  return {
    ...FROZEN_LAUNCH_ENV,
    GATE3_RESUME_DIR: identity?.resume_dir || FROZEN_LAUNCH_ENV.GATE3_RESUME_DIR,
  };
}

/**
 * Explicit global Gate-3 ceiling evaluator.
 * Owner completion alone must never set pgbench_ceiling_complete.
 *
 * @param {Record<string, unknown>} input
 */
export function evaluateGlobalCeiling(input) {
  const authorization = { ...AUTH_BLOCKED };
  const reasons = [];
  const expected = Number(input.expected_cell_count);
  const valid = Number(input.valid_cell_count);
  if (expected !== 14616) reasons.push(`expected_cell_count=${expected}`);
  if (valid !== 14616) reasons.push(`valid_cell_count=${valid}`);
  if (valid > expected) reasons.push("over_count");
  const counters = [
    "missing",
    "duplicates",
    "invalid_environment",
    "interference",
    "legacy_checkpoint_cells_used",
    "cross_environment_w1_w2_pairs",
    "execution_failures",
    "unresolved_cells",
  ];
  for (const key of counters) {
    if (Number(input[key] || 0) !== 0) reasons.push(`${key}=${input[key]}`);
  }
  if (input.every_required_owner_complete !== true) reasons.push("owners_incomplete");
  if (input.all_owners_concurrent_complete !== true) {
    reasons.push("ALL_OWNERS_CONCURRENT incomplete");
  }
  if (input.required_30_120_present !== true) reasons.push("required_30_120_missing");
  if (input.required_repetitions_present !== true) reasons.push("required_repetitions_missing");
  if (input.required_distributions_present !== true) reasons.push("required_distributions_missing");
  if (input.required_batches_present !== true) reasons.push("required_batches_missing");
  if (input.required_client_thread_pairs_present !== true) {
    reasons.push("required_client_thread_pairs_missing");
  }
  if (input.required_latency_stat_samples_present !== true) {
    reasons.push("required_latency_stat_samples_missing");
  }
  if (input.merge_validation_pass !== true) reasons.push("merge_validation_not_pass");

  return {
    pgbench_ceiling_complete: reasons.length === 0,
    reason: reasons.length ? reasons.join("; ") : null,
    expected_cell_count: expected,
    valid_cell_count: valid,
    ...authorization,
  };
}

function blockedAuth(snap) {
  return {
    ...AUTH_BLOCKED,
    ...(snap.authorization || {}),
    ...AUTH_BLOCKED,
  };
}

/**
 * Pure supervisor decision. Side effects belong in the CLI.
 * @param {Record<string, any>} s
 */
export function decideSupervisorAction(s) {
  const authorization = blockedAuth(s);
  const resume_dir = s.resume_dir || s.frozen_identity?.resume_dir;
  const launch_env = frozenLaunchEnv(s.frozen_identity || { resume_dir });
  /** @type {Record<string, unknown>} */
  const base = {
    authorization,
    resume_dir,
    launch_env,
    skip_cell: false,
    pgbench_ceiling_complete: false,
    stop: false,
    launch: false,
    terminate: false,
    write_incident: false,
    count_interrupted_cell: false,
    exit_code: 0,
    generate_owner_review: null,
    next_owner: nextRequiredFromCatalog(s.pending_cells).next_owner || nextOwner(s.owner),
    terminate_targets: [],
    concurrent_safe: Number(s.concurrent_runner_count || 0) <= 1,
  };

  const identity = assertFrozenRunIdentity(s.frozen_identity, s.observed_identity);
  if (!identity.ok) {
    return {
      ...base,
      action: "FROZEN_RUN_IDENTITY_MISMATCH",
      reason: identity.code,
      field: identity.field,
      launch: false,
      exit_code: 2,
      stop: true,
    };
  }

  if (s.global_ceiling?.pgbench_ceiling_complete === true) {
    return {
      ...base,
      action: "COMPLETE",
      pgbench_ceiling_complete: true,
      stop: true,
      launch: false,
    };
  }

  const max = Number(s.max_restarts_per_cell ?? MAX_RESTARTS_PER_CELL);
  if (Number(s.restarts_for_current_cell || 0) >= max) {
    return {
      ...base,
      action: "CELL_REPEATEDLY_UNEXECUTABLE",
      skip_cell: false,
      launch: false,
      exit_code: 2,
      stop: true,
      pgbench_ceiling_complete: false,
    };
  }

  const written = s.owner_reviews_written || [];
  if (s.owner_complete === true && s.owner && !written.includes(s.owner)) {
    return {
      ...base,
      action: "GENERATE_OWNER_REVIEW",
      generate_owner_review: s.owner,
      next_owner:
        nextRequiredFromCatalog(s.pending_cells).next_owner || nextOwner(s.owner),
      stop: false,
      pgbench_ceiling_complete: false,
    };
  }

  const stalled =
    Boolean(s.runner_alive) &&
    s.last_progress_at_ms != null &&
    s.now_ms - s.last_progress_at_ms > Number(s.stall_after_ms);

  if (stalled) {
    return {
      ...base,
      action: "STALL_RESTART",
      write_incident: true,
      terminate: true,
      terminate_targets: ["runner", "pgbench"],
      launch: true,
      count_interrupted_cell: false,
      resume_dir,
    };
  }

  if (!s.runner_alive && Number(s.concurrent_runner_count || 0) === 0) {
    return {
      ...base,
      action: "LAUNCH",
      launch: true,
      resume_dir,
    };
  }

  return {
    ...base,
    action: "WAIT",
    launch: false,
    terminate: false,
  };
}
