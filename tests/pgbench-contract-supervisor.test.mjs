/**
 * Active Gate-3 completion supervisor (distinct from the read-only watchdog).
 * RED→GREEN coverage for S1–S24. Does not weaken evaluateOwnerComplete.
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { evaluateOwnerComplete } from "../scripts/lib/pgbench_owner_review.mjs";
import { PER_OWNER_OPERATIONAL_ORDER } from "../scripts/lib/pgbench_resume.mjs";
import { writeJsonAtomic } from "../scripts/lib/pgbench_run_watchdog.mjs";
import {
  MAX_RESTARTS_PER_CELL,
  assertFrozenRunIdentity,
  countCellRestarts,
  countReusableCells,
  decideSupervisorAction,
  evaluateGlobalCeiling,
  evaluateSupervisorLock,
  frozenOwnerSequence,
  prepareIsolatedShardLaunch,
  resolveSupervisorProgressAtMs,
  planSupervisorShutdown,
  releaseSupervisorLock,
  nextRequiredFromCatalog,
  catalogCountInvariant,
  buildSupervisorStatus,
} from "../scripts/lib/pgbench_contract_supervisor.mjs";
import { enumerateExpectedPgbenchCells } from "../scripts/lib/pgbench_completeness.mjs";
import { cellsPerOwner } from "../scripts/lib/pgbench_shard.mjs";

const FROZEN = {
  resume_dir: "reports/performance/pgbench/pgbench-contract-20260812-011924-ef21a35e",
  git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
  catalog_sha: "f8a8ab2c341760e75e4d26d59df0255b5a64769b439842809abcc198e48b3782",
  environment_fingerprint: "colima-shared-domain|colima-or-host:a11a196ec67c0ccd|0af70b02ac57e041093b6ee867b21f2a",
  warmup_seconds: 30,
  measured_seconds: 120,
  expected_cell_count: 14616,
  expected_owner_cells: 1218,
  workload_revision: "gate3-v1-domain-touch",
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

function snap(overrides = {}) {
  const now = 1_700_000_000_000;
  return {
    now_ms: now,
    frozen_identity: FROZEN,
    observed_identity: { ...FROZEN },
    runner_alive: true,
    pgbench_alive: true,
    runner_pids: [31927],
    pgbench_pids: [61529],
    concurrent_runner_count: 1,
    last_progress_at_ms: now - 60_000,
    stall_after_ms: 20 * 60_000,
    owner: "records",
    cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
    executed: 28,
    owner_valid_cells: 28,
    owner_expected_cells: 1218,
    owner_complete: false,
    owner_reviews_written: [],
    restarts_for_current_cell: 0,
    max_restarts_per_cell: MAX_RESTARTS_PER_CELL,
    resume_dir: FROZEN.resume_dir,
    global_valid_cells: 28,
    all_owners_concurrent_complete: false,
    owners_complete: Object.fromEntries(PER_OWNER_OPERATIONAL_ORDER.map((o) => [o, false])),
    authorization: { ...AUTH_BLOCKED },
    ...overrides,
  };
}

function zeroAnomalies(extra = {}) {
  return {
    expected_cell_count: 14616,
    valid_cell_count: 14616,
    missing: 0,
    duplicates: 0,
    invalid_environment: 0,
    interference: 0,
    legacy_checkpoint_cells_used: 0,
    cross_environment_w1_w2_pairs: 0,
    execution_failures: 0,
    unresolved_cells: 0,
    every_required_owner_complete: true,
    all_owners_concurrent_complete: true,
    required_30_120_present: true,
    required_repetitions_present: true,
    required_distributions_present: true,
    required_batches_present: true,
    required_client_thread_pairs_present: true,
    required_latency_stat_samples_present: true,
    merge_validation_pass: true,
    ...extra,
  };
}

describe("S1–S3 runner liveness", () => {
  it("S1 healthy runner is never restarted", () => {
    const d = decideSupervisorAction(snap());
    assert.equal(d.action, "WAIT");
    assert.equal(d.launch, false);
    assert.equal(d.terminate, false);
  });

  it("S2 dead incomplete runner is resumed", () => {
    const d = decideSupervisorAction(
      snap({
        runner_alive: false,
        pgbench_alive: false,
        runner_pids: [],
        pgbench_pids: [],
        concurrent_runner_count: 0,
      }),
    );
    assert.equal(d.action, "LAUNCH");
    assert.equal(d.launch, true);
    assert.equal(d.resume_dir, FROZEN.resume_dir);
  });

  it("S3 completed contract is never relaunched", () => {
    const d = decideSupervisorAction(
      snap({
        runner_alive: false,
        pgbench_alive: false,
        concurrent_runner_count: 0,
        owner_complete: true,
        owner_valid_cells: 1218,
        global_valid_cells: 14616,
        all_owners_concurrent_complete: true,
        owners_complete: Object.fromEntries(PER_OWNER_OPERATIONAL_ORDER.map((o) => [o, true])),
        global_ceiling: evaluateGlobalCeiling(zeroAnomalies()),
      }),
    );
    assert.equal(d.launch, false);
    assert.equal(d.action, "COMPLETE");
    assert.equal(d.pgbench_ceiling_complete, true);
  });
});

describe("S4–S7 stall clock (logical progress only)", () => {
  const stallAfter = 20 * 60_000;
  const t0 = 1_700_000_000_000;

  it("S4 unrelated log writes do not reset stall timer", () => {
    const last = resolveSupervisorProgressAtMs({
      now_ms: t0 + 25 * 60_000,
      log_mtime_ms: t0 + 5 * 60_000,
      events: [{ executed: 21, cell_id: "cell-a", at_ms: t0 }],
      history_samples: [{ at_ms: t0, owner_valid_cells: 21, executed: 21, cell_id: "cell-a" }],
      owner_valid_cells: 21,
    });
    assert.equal(last, t0);
    const d = decideSupervisorAction(
      snap({ now_ms: t0 + 25 * 60_000, last_progress_at_ms: last, executed: 21, owner_valid_cells: 21 }),
    );
    assert.equal(d.action, "WAIT");
  });

  it("S5 repeated same cell/executed value does not reset stall", () => {
    const last = resolveSupervisorProgressAtMs({
      now_ms: t0 + 25 * 60_000,
      log_mtime_ms: t0 + 25 * 60_000,
      events: [
        { executed: 21, cell_id: "cell-a", at_ms: t0 },
        { executed: 21, cell_id: "cell-a", at_ms: t0 + 25 * 60_000 },
      ],
      history_samples: [{ at_ms: t0, owner_valid_cells: 21, executed: 21, cell_id: "cell-a" }],
      owner_valid_cells: 21,
    });
    assert.equal(last, t0);
  });

  it("S6 new completed cell resets stall", () => {
    const newAt = t0 + 3 * 60_000;
    const last = resolveSupervisorProgressAtMs({
      now_ms: t0 + 4 * 60_000,
      events: [
        { executed: 21, cell_id: "cell-a", at_ms: t0 },
        { executed: 22, cell_id: "cell-b", at_ms: newAt },
      ],
      history_samples: [{ at_ms: t0, owner_valid_cells: 21, executed: 21, cell_id: "cell-a" }],
      owner_valid_cells: 22,
    });
    assert.equal(last, newAt);
    const d = decideSupervisorAction(snap({ now_ms: t0 + 4 * 60_000, last_progress_at_ms: last }));
    assert.equal(d.action, "WAIT");
  });

  it("S7 owner_valid_cells increase resets stall", () => {
    const increaseAt = t0 + 2 * 60_000;
    const last = resolveSupervisorProgressAtMs({
      now_ms: t0 + 3 * 60_000,
      events: [{ executed: 21, cell_id: "cell-a", at_ms: t0 }],
      history_samples: [
        { at_ms: t0, owner_valid_cells: 21, executed: 21, cell_id: "cell-a" },
        { at_ms: increaseAt, owner_valid_cells: 22, executed: 21, cell_id: "cell-a" },
      ],
      owner_valid_cells: 22,
    });
    assert.equal(last, increaseAt);
    void stallAfter;
  });
});

describe("S8–S10 stall restart + resume identity", () => {
  it("S8 stalled in-flight phase gets incident + controlled termination + resume", () => {
    const now = 1_700_000_000_000;
    const d = decideSupervisorAction(
      snap({
        now_ms: now,
        last_progress_at_ms: now - 45 * 60_000,
        in_flight: {
          cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
          phase: "MEASURE_RUNNING",
          phase_started_at: now - 10 * 60_000,
          last_phase_progress_at: now - 10 * 60_000,
          pgbench_pid: 61529,
          pgbench_argv: ["pgbench", "-T", "120"],
        },
      }),
    );
    assert.equal(d.action, "STALL_RESTART");
    assert.equal(d.write_incident, true);
    assert.equal(d.terminate, true);
    assert.deepEqual(d.terminate_targets.sort(), ["pgbench", "runner"].sort());
    assert.equal(d.terminate_targets.includes("postgres"), false);
    assert.equal(d.terminate_targets.includes("kafka"), false);
    assert.equal(d.launch, true);
    assert.equal(d.count_interrupted_cell, false);
    assert.equal(d.resume_dir, FROZEN.resume_dir);
  });

  it("S9 partial/stalled cell is not counted as valid", () => {
    const partial = {
      cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
      status: "PASS",
      warmup_seconds: 5,
      measured_seconds: 20,
      owner: "records",
      mode: "PER_OWNER_CEILING",
    };
    const missingEnv = {
      cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r2",
      status: "PASS",
      warmup_seconds: 30,
      measured_seconds: 120,
      owner: "records",
      mode: "PER_OWNER_CEILING",
      workload: "W1_DOMAIN_ONLY",
      distribution: "UNIFORM",
      clients: 8,
      threads: 1,
      batch: null,
      repetition: 2,
      random_seed: 1,
      workload_revision: "gate3-v1-domain-touch",
      database_target: "127.0.0.1:5433/records",
      postgres_config_hash: "cfg",
      tps: 1,
      avg_latency_ms: 1,
    };
    assert.equal(countReusableCells([partial, missingEnv]), 0);
  });

  it("S10 same resume directory is reused exactly", () => {
    const d = decideSupervisorAction(
      snap({
        runner_alive: false,
        pgbench_alive: false,
        concurrent_runner_count: 0,
      }),
    );
    assert.equal(d.resume_dir, FROZEN.resume_dir);
    assert.equal(d.launch_env.GATE3_RESUME_DIR, FROZEN.resume_dir);
    assert.equal(d.launch_env.GATE3_CONTRACT, "1");
    assert.equal(d.launch_env.GATE3_SHARD_ID, "sequential-shared-colima");
    assert.equal(d.launch_env.GATE3_ENVIRONMENT_ID, "colima-shared-domain");
  });
});

describe("S11–S13 identity and lock", () => {
  it("S11 config/catalog/environment mismatch blocks restart", () => {
    const id = assertFrozenRunIdentity(FROZEN, { ...FROZEN, catalog_sha: "deadbeef" });
    assert.equal(id.ok, false);
    assert.equal(id.code, "FROZEN_RUN_IDENTITY_MISMATCH");
    const d = decideSupervisorAction(
      snap({
        observed_identity: { ...FROZEN, catalog_sha: "deadbeef" },
        runner_alive: false,
        concurrent_runner_count: 0,
      }),
    );
    assert.equal(d.action, "FROZEN_RUN_IDENTITY_MISMATCH");
    assert.equal(d.launch, false);
    assert.equal(d.exit_code, 2);
  });

  it("S12 second supervisor cannot acquire active lock", () => {
    const lock = evaluateSupervisorLock({
      existing: { pid: 111, run_dir: FROZEN.resume_dir },
      self_pid: 222,
      isPidAlive: (pid) => pid === 111,
    });
    assert.equal(lock.acquire, false);
    assert.match(lock.reason, /LOCK/);
  });

  it("S13 stale lock can be recovered only when PID is proven dead", () => {
    const live = evaluateSupervisorLock({
      existing: { pid: 111, run_dir: FROZEN.resume_dir },
      self_pid: 222,
      isPidAlive: () => true,
    });
    assert.equal(live.acquire, false);
    const dead = evaluateSupervisorLock({
      existing: { pid: 111, run_dir: FROZEN.resume_dir },
      self_pid: 222,
      isPidAlive: () => false,
    });
    assert.equal(dead.acquire, true);
    assert.equal(dead.recover_stale, true);
  });
});

describe("S14–S15 per-cell restart budget", () => {
  it("S14 restart budget is per-cell and fail-closed", () => {
    assert.equal(MAX_RESTARTS_PER_CELL, 3);
    assert.equal(countCellRestarts([{ cell_id: "a" }, { cell_id: "a" }, { cell_id: "b" }], "a"), 2);
    const d = decideSupervisorAction(
      snap({
        last_progress_at_ms: 1_700_000_000_000 - 45 * 60_000,
        restarts_for_current_cell: 3,
        cell_id: "cell-stuck",
      }),
    );
    assert.equal(d.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    assert.equal(d.launch, false);
    assert.equal(d.skip_cell, false);
    assert.equal(d.exit_code, 2);
    assert.equal(d.pgbench_ceiling_complete, false);
  });

  it("S15 exhausted restart budget does not skip the cell", () => {
    const d = decideSupervisorAction(
      snap({
        runner_alive: false,
        concurrent_runner_count: 0,
        restarts_for_current_cell: 3,
        cell_id: "cell-stuck",
      }),
    );
    assert.equal(d.skip_cell, false);
    assert.notEqual(d.action, "LAUNCH");
    assert.equal(d.pgbench_ceiling_complete, false);
  });
});

describe("S16–S18 owner advance and concurrent requirement", () => {
  it("S16 owner 1218/1218 advances automatically", () => {
    assert.deepEqual(frozenOwnerSequence(), PER_OWNER_OPERATIONAL_ORDER);
    const d = decideSupervisorAction(
      snap({
        owner: "records",
        owner_complete: true,
        owner_valid_cells: 1218,
        owner_reviews_written: [],
      }),
    );
    assert.equal(d.action, "GENERATE_OWNER_REVIEW");
    assert.equal(d.generate_owner_review, "records");
    assert.equal(d.next_owner, "shopping");
    assert.equal(d.stop, false);
    assert.equal(d.pgbench_ceiling_complete, false);
  });

  it("S17 owner completion still leaves global ceiling false", () => {
    const ownerPred = evaluateOwnerComplete({
      expected_owner_cells: 1218,
      valid_owner_cells: 1218,
      missing_cells: 0,
      duplicate_cells: 0,
      invalid_environment_cells: 0,
      interference_cells: 0,
      legacy_checkpoint_cells_used: 0,
      cross_environment_w1_w2_pairs: 0,
    });
    assert.equal(ownerPred.owner_complete, true);
    assert.equal(ownerPred.pgbench_ceiling_complete, false);
    const g = evaluateGlobalCeiling(
      zeroAnomalies({
        valid_cell_count: 1218,
        every_required_owner_complete: false,
        all_owners_concurrent_complete: false,
        missing: 14616 - 1218,
      }),
    );
    assert.equal(g.pgbench_ceiling_complete, false);
  });

  it("S18 ALL_OWNERS_CONCURRENT remains required", () => {
    const g = evaluateGlobalCeiling(
      zeroAnomalies({
        every_required_owner_complete: true,
        all_owners_concurrent_complete: false,
        valid_cell_count: 13398,
        missing: 1218,
      }),
    );
    assert.equal(g.pgbench_ceiling_complete, false);
    assert.match(String(g.reason), /ALL_OWNERS_CONCURRENT/);
  });
});

describe("S19–S22 global ceiling and authorization freeze", () => {
  it("S19 14615/14616 cannot set ceiling complete", () => {
    const g = evaluateGlobalCeiling(zeroAnomalies({ valid_cell_count: 14615, missing: 1 }));
    assert.equal(g.pgbench_ceiling_complete, false);
  });

  it("S20 14616/14616 plus any anomaly cannot set ceiling complete", () => {
    const g = evaluateGlobalCeiling(zeroAnomalies({ interference: 1 }));
    assert.equal(g.pgbench_ceiling_complete, false);
  });

  it("S21 exact valid global catalog + all anomaly counters zero may produce the Gate-3 completion candidate", () => {
    const g = evaluateGlobalCeiling(zeroAnomalies());
    assert.equal(g.pgbench_ceiling_complete, true);
    assert.equal(g.protocol_execution_authorized, false);
    assert.equal(g.execution_authorized, false);
    assert.equal(g.end_harness_execution_authorized, false);
    assert.equal(g.track_c_acceptance_pass, false);
    assert.equal(g.platform_pass, false);
  });

  it("S22 supervisor never mutates tuning/protocol/Track-C authorization fields", () => {
    const d = decideSupervisorAction(snap());
    assert.equal(d.authorization.protocol_execution_authorized, false);
    assert.equal(d.authorization.execution_authorized, false);
    assert.equal(d.authorization.end_harness_execution_authorized, false);
    assert.equal(d.authorization.track_c_acceptance_pass, false);
    assert.equal(d.authorization.platform_pass, false);
    assert.equal(d.authorization.tuning, "NO_GO");
    assert.equal(d.authorization.protocol, "NO_GO");
    const complete = decideSupervisorAction(
      snap({
        global_ceiling: evaluateGlobalCeiling(zeroAnomalies()),
        runner_alive: false,
        concurrent_runner_count: 0,
        all_owners_concurrent_complete: true,
        owners_complete: Object.fromEntries(PER_OWNER_OPERATIONAL_ORDER.map((o) => [o, true])),
      }),
    );
    assert.equal(complete.authorization.protocol_execution_authorized, false);
    assert.equal(complete.authorization.track_c_acceptance_pass, false);
  });
});

describe("S23–S24 contention domain and atomic state", () => {
  it("S23 no two pgbench runners are launched concurrently in one contention domain", () => {
    const d = decideSupervisorAction(
      snap({
        runner_alive: true,
        concurrent_runner_count: 1,
        last_progress_at_ms: 1_700_000_000_000 - 45 * 60_000,
      }),
    );
    assert.equal(d.launch && d.terminate === false, false);
    const healthy = decideSupervisorAction(snap({ concurrent_runner_count: 1 }));
    assert.equal(healthy.launch, false);
    const isolated = prepareIsolatedShardLaunch({ isolated_contention_domain_count: 1 });
    assert.equal(isolated.allowed, false);
    assert.equal(isolated.mode, "SEQUENTIAL_SINGLE_CONTENTION_DOMAIN");
  });

  it("S24 atomic state writes survive rename failure and clean temporary files", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-supervisor-atomic-"));
    try {
      const dest = join(dir, "state.json");
      writeFileSync(dest, JSON.stringify({ n: 1 }) + "\n");
      assert.throws(() => {
        writeJsonAtomic(dest, { n: 2 }, {
          renameSync: () => {
            throw new Error("simulated crash before rename");
          },
        });
      });
      assert.deepEqual(JSON.parse(readFileSync(dest, "utf8")), { n: 1 });
      assert.equal(readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
      writeJsonAtomic(dest, { n: 3 }, {
        renameSync: (from, to) => {
          assert.equal(dirname(from), dir);
          renameSync(from, to);
        },
      });
      assert.equal(JSON.parse(readFileSync(dest, "utf8")).n, 3);
      assert.equal(readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("D1–D5 supervisor SIGTERM and replacement adoption", () => {
  it("D1 SIGTERM supervisor does not terminate adopted benchmark", () => {
    const plan = planSupervisorShutdown({
      runner_pids: [31927],
      pgbench_pids: [74254],
      adopted_runner_alive: true,
    });
    assert.equal(plan.terminate_runner, false);
    assert.equal(plan.terminate_pgbench, false);
    assert.equal(plan.mutate_checkpoints, false);
    assert.deepEqual(plan.kill_pids, []);
  });

  it("D2 SIGTERM does not delete/modify valid benchmark cells", () => {
    const plan = planSupervisorShutdown({ adopted_runner_alive: true, runner_pids: [31927] });
    assert.equal(plan.mutate_checkpoints, false);
    assert.equal(plan.persist_state, true);
    assert.equal(plan.release_lock, true);
  });

  it("D3 replacement supervisor can recover stale lock only when old PID dead", () => {
    const live = evaluateSupervisorLock({
      existing: { pid: 66952, run_dir: FROZEN.resume_dir },
      self_pid: 90001,
      isPidAlive: (pid) => pid === 66952,
    });
    assert.equal(live.acquire, false);
    const dead = evaluateSupervisorLock({
      existing: { pid: 66952, run_dir: FROZEN.resume_dir },
      self_pid: 90001,
      isPidAlive: () => false,
    });
    assert.equal(dead.acquire, true);
    assert.equal(dead.recover_stale, true);
    const released = releaseSupervisorLock({
      existing: { pid: 66952 },
      self_pid: 66952,
    });
    assert.equal(released.release, true);
  });

  it("D4 replacement supervisor adopts existing runner and returns WAIT", () => {
    const d = decideSupervisorAction(
      snap({
        runner_alive: true,
        concurrent_runner_count: 1,
        runner_pids: [31927],
      }),
    );
    assert.equal(d.action, "WAIT");
    assert.equal(d.launch, false);
    assert.equal(d.terminate, false);
  });

  it("D5 replacement supervisor never spawns runner when healthy one already exists", () => {
    const d = decideSupervisorAction(
      snap({
        runner_alive: true,
        concurrent_runner_count: 1,
        runner_pids: [31927],
        last_progress_at_ms: 1_700_000_000_000 - 60_000,
      }),
    );
    assert.equal(d.launch, false);
    assert.equal(d.concurrent_safe, true);
  });
});

describe("catalog-driven progression invariant", () => {
  it("expected_cell_count === 14616 and canonical + concurrent sum to it", () => {
    const inv = catalogCountInvariant(enumerateExpectedPgbenchCells());
    assert.equal(inv.expected_cell_count, 14616);
    assert.equal(inv.canonical_cells, 11 * cellsPerOwner());
    assert.equal(inv.all_owner_cells, cellsPerOwner());
    assert.equal(inv.canonical_cells, 13398);
    assert.equal(inv.all_owner_cells, 1218);
    assert.equal(inv.canonical_cells + inv.all_owner_cells, inv.expected_cell_count);
    assert.equal(inv.ok, true);
  });

  it("derives next required cell from catalog/checkpoints, not prose owner lists", () => {
    const pending = [
      { mode: "PER_OWNER_CEILING", owner: "shopping", cell_id: "PER_OWNER_CEILING|shopping|x" },
      { mode: "ALL_OWNERS_CONCURRENT", owner: "ALL", cell_id: "ALL_OWNERS_CONCURRENT|ALL|x" },
    ];
    const prog = nextRequiredFromCatalog(pending);
    assert.equal(prog.next_cell.cell_id, "PER_OWNER_CEILING|shopping|x");
    assert.deepEqual(prog.incomplete_owners, ["shopping"]);
    assert.equal(prog.next_owner, "shopping");
    assert.equal(prog.concurrent_remaining, 1);
  });

  it("13398/13398 canonical completion cannot promote the global ceiling", () => {
    const g = evaluateGlobalCeiling(
      zeroAnomalies({
        valid_cell_count: 13398,
        missing: 1218,
        every_required_owner_complete: true,
        all_owners_concurrent_complete: false,
      }),
    );
    assert.equal(g.pgbench_ceiling_complete, false);
  });

  it("buildSupervisorStatus pins global_expected=14616 and ceiling false until evaluator passes", () => {
    const status = buildSupervisorStatus({
      supervisor_pid: 9,
      runner_pid: 31927,
      owner: "records",
      current_cell: "cell-a",
      owner_valid: 446,
      owner_expected: 1218,
      global_valid: 446,
      last_logical_progress_at: 1,
      seconds_per_cell_observed: null,
      eta_owner: 1,
      eta_global: 2,
      restart_count: 0,
      incident_count: 0,
      action: "WAIT",
      pgbench_ceiling_complete: false,
    });
    assert.equal(status.global_expected, 14616);
    assert.equal(status.runner_pid, 31927);
    assert.equal(status.action, "WAIT");
    assert.equal(status.pgbench_ceiling_complete, false);
  });
});
