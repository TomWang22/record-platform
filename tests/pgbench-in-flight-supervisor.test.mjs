/**
 * Regression for Gate-3 supervisor wrong-cell stall / orphan runner.
 * Fixture: PASS A (c256 t4 r3) → long-running B (c256 t8 r1) → must not charge A.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONNECTION_ALLOWANCE_MS,
  IN_FLIGHT_PHASES,
  actualInFlightCellId,
  buildRestartIncident,
  classifyMonitorHealth,
  evaluateInFlightStall,
  phaseStallAfterMs,
  reconstructAdoptionRetryState,
  verifyTerminalCleanup,
  writeInFlightAtomic,
} from "../scripts/lib/pgbench_in_flight.mjs";
import {
  MAX_RESTARTS_PER_CELL,
  countCellRestarts,
  decideSupervisorAction,
  planSupervisorSideEffects,
} from "../scripts/lib/pgbench_contract_supervisor.mjs";
import { writeRunIdentityOnce } from "../scripts/lib/pgbench_run_identity.mjs";

const CELL_A = "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c256|t4|bNA|r3";
const CELL_B = "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c256|t8|bNA|r1";
const CELL_C = "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c256|t8|bNA|r2";
const T0 = 1_700_000_000_000;
const FROZEN = {
  resume_dir: "reports/performance/pgbench/pgbench-contract-test-inflight",
  git_sha: "deadbeef",
  catalog_sha: "catalog",
  environment_fingerprint: "colima-shared-domain|colima-or-host:a11a196ec67c0ccd|hash",
  warmup_seconds: 30,
  measured_seconds: 120,
  expected_cell_count: 14616,
  expected_owner_cells: 1218,
  workload_revision: "gate3-v1-domain-touch",
  source_bundle_sha: "wl",
  control_plane_bundle_sha: "cp",
  run_id: "pgbench-contract-test-inflight",
};

function snap(overrides = {}) {
  return {
    now_ms: T0 + 25 * 60_000,
    frozen_identity: FROZEN,
    observed_identity: { ...FROZEN },
    runner_alive: true,
    pgbench_alive: true,
    runner_pids: [41476],
    pgbench_pids: [8953],
    concurrent_runner_count: 1,
    last_progress_at_ms: T0,
    last_completed_cell_id: CELL_A,
    cell_id: CELL_A,
    stall_after_ms: 20 * 60_000,
    owner: "records",
    executed: 81,
    owner_valid_cells: 81,
    owner_expected_cells: 1218,
    owner_complete: false,
    owner_reviews_written: [],
    restarts_for_current_cell: 0,
    max_restarts_per_cell: MAX_RESTARTS_PER_CELL,
    resume_dir: FROZEN.resume_dir,
    incidents: [],
    authorization: {
      protocol_execution_authorized: false,
      execution_authorized: false,
      end_harness_execution_authorized: false,
      track_c_acceptance_pass: false,
      platform_pass: false,
      tuning: "NO_GO",
      protocol: "NO_GO",
    },
    ...overrides,
  };
}

function inFlightB(overrides = {}) {
  return {
    schema: "record-platform-pgbench-in-flight/v1",
    run_id: FROZEN.run_id,
    cell_id: CELL_B,
    owner: "records",
    mode: "PER_OWNER_CEILING",
    workload: "W1_DOMAIN_ONLY",
    distribution: "UNIFORM",
    clients: 256,
    threads: 8,
    batch: null,
    repetition: 1,
    phase: "MEASURE_CONNECTING",
    phase_started_at: T0 + 60_000,
    last_phase_progress_at: T0 + 10 * 60_000,
    runner_pid: 41476,
    pgbench_pid: 8953,
    pgbench_argv: ["pgbench", "-c", "256", "-j", "8", "-T", "120"],
    ...overrides,
  };
}

describe("in-flight phases and deadlines", () => {
  it("enumerates explicit runner phases", () => {
    assert.deepEqual(IN_FLIGHT_PHASES, [
      "IDLE",
      "SEEDING",
      "WARMUP_CONNECTING",
      "WARMUP_RUNNING",
      "MEASURE_CONNECTING",
      "MEASURE_RUNNING",
      "CHECKPOINTING",
      "CLEANUP",
    ]);
  });

  it("connection allowance covers observed 984s c256 connect", () => {
    assert.ok(CONNECTION_ALLOWANCE_MS >= 984_000);
    const connectDeadline = phaseStallAfterMs("MEASURE_CONNECTING");
    assert.ok(connectDeadline >= CONNECTION_ALLOWANCE_MS + 120_000);
    assert.ok(connectDeadline > 20 * 60_000 || connectDeadline >= 984_000 + 120_000);
  });
});

describe("A/B historical fixture: stall keys to in-flight B, never A", () => {
  it("does not stall a live B connection using A's checkpoint age", () => {
    const stall = evaluateInFlightStall({
      now_ms: T0 + 25 * 60_000,
      runner_alive: true,
      pgbench_alive: true,
      last_completed_cell_id: CELL_A,
      last_progress_at_ms: T0,
      in_flight: inFlightB(),
    });
    assert.equal(stall.stalled, false);
    assert.equal(stall.actual_cell_id, CELL_B);
    const d = decideSupervisorAction(
      snap({
        in_flight: inFlightB(),
        last_completed_cell_id: CELL_A,
        cell_id: CELL_A,
        last_progress_at_ms: T0,
        now_ms: T0 + 25 * 60_000,
      }),
    );
    assert.equal(d.action, "WAIT");
    assert.notEqual(d.incident_cell_id, CELL_A);
  });

  it("STALL_RESTART incident is keyed to B and does not increment A's retry count", () => {
    const connectingTooLong = inFlightB({
      phase_started_at: T0,
      last_phase_progress_at: T0,
    });
    const now = T0 + phaseStallAfterMs("MEASURE_CONNECTING") + 1;
    const d = decideSupervisorAction(
      snap({
        now_ms: now,
        in_flight: connectingTooLong,
        last_completed_cell_id: CELL_A,
        cell_id: CELL_A,
        last_progress_at_ms: T0,
        incidents: [],
      }),
    );
    assert.equal(d.action, "STALL_RESTART");
    assert.equal(d.incident_cell_id, CELL_B);
    assert.notEqual(d.incident_cell_id, CELL_A);
    const incident = buildRestartIncident({
      decision: d,
      in_flight: connectingTooLong,
      last_completed_cell_id: CELL_A,
      runner_pid: 41476,
      pgbench_pid: 8953,
      signal: "SIGTERM",
      retry_count_for_actual_cell: 1,
      pins: FROZEN,
    });
    assert.equal(incident.actual_cell_id, CELL_B);
    assert.equal(incident.last_completed_cell_id, CELL_A);
    assert.equal(incident.phase, "MEASURE_CONNECTING");
    assert.ok(Array.isArray(incident.pgbench_argv));
    assert.equal(incident.signal, "SIGTERM");
    assert.equal(countCellRestarts([incident], CELL_A), 0);
    assert.equal(countCellRestarts([incident], CELL_B), 1);
  });

  it("three failed attempts for B exhaust B only; A remains untouched", () => {
    const incidents = [1, 2, 3].map((n) =>
      buildRestartIncident({
        decision: { action: "STALL_RESTART", incident_cell_id: CELL_B },
        in_flight: inFlightB(),
        last_completed_cell_id: CELL_A,
        runner_pid: 1,
        pgbench_pid: 2,
        signal: "SIGTERM",
        retry_count_for_actual_cell: n,
        pins: FROZEN,
      }),
    );
    assert.equal(countCellRestarts(incidents, CELL_B), 3);
    assert.equal(countCellRestarts(incidents, CELL_A), 0);
    const d = decideSupervisorAction(
      snap({
        in_flight: inFlightB(),
        last_completed_cell_id: CELL_A,
        cell_id: CELL_A,
        incidents,
        restarts_for_current_cell: countCellRestarts(incidents, CELL_B),
      }),
    );
    assert.equal(d.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    assert.equal(d.incident_cell_id, CELL_B);
    assert.equal(d.terminate, true);
    assert.deepEqual(d.terminate_targets.sort(), ["pgbench", "runner"].sort());
    assert.equal(d.launch, false);
  });
});

describe("phase-aware liveness", () => {
  it("forbids classifying stall from previous PASS timestamp alone", () => {
    const stall = evaluateInFlightStall({
      now_ms: T0 + 45 * 60_000,
      runner_alive: true,
      pgbench_alive: true,
      last_completed_cell_id: CELL_A,
      last_progress_at_ms: T0,
      in_flight: inFlightB({
        phase_started_at: T0 + 40 * 60_000,
        last_phase_progress_at: T0 + 44 * 60_000,
      }),
    });
    assert.equal(stall.stalled, false);
    assert.equal(stall.used_last_checkpoint_age, false);
  });

  it("child liveness participates: dead pgbench in MEASURE_RUNNING is a stall", () => {
    const stall = evaluateInFlightStall({
      now_ms: T0 + 5 * 60_000,
      runner_alive: true,
      pgbench_alive: false,
      in_flight: inFlightB({
        phase: "MEASURE_RUNNING",
        phase_started_at: T0 + 4 * 60_000,
        last_phase_progress_at: T0 + 4 * 60_000,
        pgbench_pid: 8953,
      }),
    });
    assert.equal(stall.stalled, true);
    assert.equal(stall.actual_cell_id, CELL_B);
  });
});

describe("success does not leak retry state onto the next cell", () => {
  it("B PASS leaves B incidents historical; C starts at zero retries", () => {
    const bIncidents = [
      buildRestartIncident({
        decision: { action: "STALL_RESTART", incident_cell_id: CELL_B },
        in_flight: inFlightB(),
        last_completed_cell_id: CELL_A,
        retry_count_for_actual_cell: 1,
        pins: FROZEN,
      }),
    ];
    const adopted = reconstructAdoptionRetryState({
      incidents: bIncidents,
      in_flight: { cell_id: CELL_C, phase: "SEEDING" },
      last_completed_cell_id: CELL_B,
      previous_terminal_state: null,
    });
    assert.equal(adopted.actual_cell_id, CELL_C);
    assert.equal(adopted.retries_for_actual_cell, 0);
    assert.equal(adopted.exhausted, false);
    assert.equal(countCellRestarts(bIncidents, CELL_B), 1);
  });
});

describe("terminal process safety", () => {
  it("CELL_REPEATEDLY_UNEXECUTABLE terminates runner and pgbench and does not launch", () => {
    const d = decideSupervisorAction(
      snap({
        in_flight: inFlightB(),
        restarts_for_current_cell: 3,
        runner_alive: true,
        pgbench_alive: true,
      }),
    );
    assert.equal(d.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    assert.equal(d.terminate, true);
    assert.ok(d.terminate_targets.includes("runner"));
    assert.ok(d.terminate_targets.includes("pgbench"));
    assert.equal(d.launch, false);
    assert.equal(d.stop, true);
  });

  it("historical launch-then-exhaust cannot leave an orphan replacement", () => {
    const incidents = [1, 2, 3].map((n) =>
      buildRestartIncident({
        decision: { action: "STALL_RESTART", incident_cell_id: CELL_B },
        in_flight: inFlightB(),
        last_completed_cell_id: CELL_A,
        retry_count_for_actual_cell: n,
        pins: FROZEN,
      }),
    );
    const afterLaunch = decideSupervisorAction(
      snap({
        in_flight: inFlightB(),
        incidents,
        restarts_for_current_cell: 3,
        runner_alive: true,
        runner_pids: [39992],
        pgbench_pids: [48127],
      }),
    );
    assert.equal(afterLaunch.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    assert.equal(afterLaunch.launch, false);
    assert.equal(afterLaunch.terminate, true);
  });

  it("identity mismatch is fail-closed and terminates owned processes", () => {
    const d = decideSupervisorAction(
      snap({
        observed_identity: { ...FROZEN, catalog_sha: "other" },
        runner_alive: true,
        pgbench_alive: true,
      }),
    );
    assert.equal(d.stop, true);
    assert.equal(d.exit_code, 2);
    assert.equal(d.terminate, true);
    assert.ok(d.terminate_targets.includes("runner"));
    assert.ok(d.terminate_targets.includes("pgbench"));
  });
});

describe("supervisor adoption reconstructs retries for the actual cell", () => {
  it("does not reset retries=3 to 0 because last_completed is still A", () => {
    const incidents = [1, 2, 3].map((n) =>
      buildRestartIncident({
        decision: { action: "STALL_RESTART", incident_cell_id: CELL_B },
        in_flight: inFlightB(),
        last_completed_cell_id: CELL_A,
        retry_count_for_actual_cell: n,
        pins: FROZEN,
      }),
    );
    const adopted = reconstructAdoptionRetryState({
      incidents,
      in_flight: inFlightB(),
      last_completed_cell_id: CELL_A,
      previous_terminal_state: {
        action: "CELL_REPEATEDLY_UNEXECUTABLE",
        actual_cell_id: CELL_B,
      },
    });
    assert.equal(adopted.actual_cell_id, CELL_B);
    assert.equal(adopted.retries_for_actual_cell, 3);
    assert.equal(adopted.exhausted, true);
    const d = decideSupervisorAction(
      snap({
        in_flight: inFlightB(),
        last_completed_cell_id: CELL_A,
        incidents,
        restarts_for_current_cell: adopted.retries_for_actual_cell,
      }),
    );
    assert.equal(d.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    assert.notEqual(d.action, "LAUNCH");
  });
});

describe("incident evidence", () => {
  it("records actual cell, last completed, phase, argv, signal, and pins", () => {
    const incident = buildRestartIncident({
      decision: { action: "STALL_RESTART", incident_cell_id: CELL_B },
      in_flight: inFlightB(),
      last_completed_cell_id: CELL_A,
      runner_pid: 41476,
      pgbench_pid: 8953,
      signal: "SIGTERM",
      exit_code: null,
      retry_count_for_actual_cell: 1,
      pins: FROZEN,
    });
    for (const key of [
      "actual_cell_id",
      "last_completed_cell_id",
      "phase",
      "phase_started_at",
      "last_phase_progress_at",
      "runner_pid",
      "pgbench_pid",
      "pgbench_argv",
      "signal",
      "exit_code",
      "retry_count_for_actual_cell",
      "git_sha",
      "control_plane_bundle_sha",
      "catalog_sha",
    ]) {
      assert.ok(key in incident, `missing ${key}`);
    }
  });
});

describe("monitor health", () => {
  it("runner_alive && !supervisor_alive && incomplete is UNSUPERVISED_RUNNER", () => {
    const h = classifyMonitorHealth({
      runner_alive: true,
      supervisor_alive: false,
      run_incomplete: true,
    });
    assert.equal(h.incident, "UNSUPERVISED_RUNNER");
    assert.equal(h.healthy, false);
  });

  it("both dead and incomplete is RUN_STOPPED_INCOMPLETE", () => {
    const h = classifyMonitorHealth({
      runner_alive: false,
      supervisor_alive: false,
      run_incomplete: true,
    });
    assert.equal(h.incident, "RUN_STOPPED_INCOMPLETE");
  });
});

describe("in-flight document is crash-safe observational state", () => {
  it("writeInFlightAtomic persists cell_id and phase", () => {
    const dir = mkdtempSync(join(tmpdir(), "inflight-"));
    try {
      const path = join(dir, "in-flight.json");
      writeInFlightAtomic(path, inFlightB());
      const got = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(got.cell_id, CELL_B);
      assert.equal(got.phase, "MEASURE_CONNECTING");
      assert.equal(actualInFlightCellId({ in_flight: got, last_completed_cell_id: CELL_A }), CELL_B);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("run-identity exclusive create", () => {
  it("second create fails without mutating the first document", () => {
    const dir = mkdtempSync(join(tmpdir(), "excl-id-"));
    try {
      const path = join(dir, "run-identity.json");
      const first = writeRunIdentityOnce(path, { run_id: "one", git_sha: "a" });
      assert.equal(first.ok, true);
      const second = writeRunIdentityOnce(path, { run_id: "two", git_sha: "b" });
      assert.equal(second.ok, false);
      assert.equal(JSON.parse(readFileSync(path, "utf8")).run_id, "one");
      assert.equal(existsSync(path), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cd8fb441 historical wrong-cell orphan fixture", () => {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures/pgbench-supervisor/cd8fb441-wrong-cell-orphan.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

  it("documents the legacy bug: incidents keyed to PASS cell A, not in-flight B", () => {
    assert.equal(countCellRestarts(fixture.legacy_incidents, fixture.cell_a), 3);
    assert.equal(countCellRestarts(fixture.legacy_incidents, fixture.cell_b), 0);
  });

  it("does not classify long-running B as a stall from A's checkpoint age, and never exhausts A", () => {
    const inflight = inFlightB({
      cell_id: fixture.cell_b,
      phase: fixture.inferred_in_flight.phase,
      pgbench_argv: fixture.inferred_in_flight.pgbench_argv,
      phase_started_at: T0 + 60_000,
      last_phase_progress_at: T0 + 10 * 60_000,
    });
    const d = decideSupervisorAction(
      snap({
        now_ms: T0 + 25 * 60_000,
        last_progress_at_ms: T0,
        last_completed_cell_id: fixture.cell_a,
        cell_id: fixture.cell_a,
        in_flight: inflight,
        incidents: [],
        restarts_for_current_cell: 0,
      }),
    );
    assert.equal(d.action, "WAIT");
    assert.notEqual(d.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    assert.notEqual(d.incident_cell_id, fixture.cell_a);
  });

  it("launch-then-exhaust of B terminates and does not launch an orphan replacement", () => {
    const incidents = [1, 2, 3].map((n) =>
      buildRestartIncident({
        decision: { action: "STALL_RESTART", incident_cell_id: fixture.cell_b },
        in_flight: inFlightB({ cell_id: fixture.cell_b }),
        last_completed_cell_id: fixture.cell_a,
        retry_count_for_actual_cell: n,
        pins: FROZEN,
      }),
    );
    const d = decideSupervisorAction(
      snap({
        in_flight: inFlightB({ cell_id: fixture.cell_b }),
        last_completed_cell_id: fixture.cell_a,
        incidents,
        restarts_for_current_cell: 3,
        runner_alive: true,
        runner_pids: [fixture.orphan_runner_pid],
      }),
    );
    assert.equal(d.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    const plan = planSupervisorSideEffects(d);
    assert.equal(plan.launch, false);
    assert.equal(plan.refuse_orphan, true);
    assert.equal(plan.terminate_runner, true);
    assert.equal(plan.terminate_pgbench, true);
    assert.equal(verifyTerminalCleanup({ runner_process_count: 0, pgbench_process_count: 0 }).ok, true);
  });

  it("adoption after last_completed moved still honors previous terminal state", () => {
    const d = decideSupervisorAction(
      snap({
        last_completed_cell_id: fixture.later_last_completed_after_orphan,
        cell_id: fixture.later_last_completed_after_orphan,
        in_flight: { cell_id: fixture.later_last_completed_after_orphan, phase: "SEEDING" },
        incidents: fixture.legacy_incidents,
        restarts_for_current_cell: 0,
        previous_terminal_state: fixture.previous_terminal_state,
      }),
    );
    assert.equal(d.action, "CELL_REPEATEDLY_UNEXECUTABLE");
    assert.notEqual(d.action, "LAUNCH");
    assert.equal(d.launch, false);
    assert.equal(d.terminate, true);
  });
});
