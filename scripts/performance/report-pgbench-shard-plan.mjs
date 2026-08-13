#!/usr/bin/env node
/**
 * Print Gate-3 shard plan + theoretical runtime floors.
 * Does NOT spawn environments or start parallel shards.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import {
  estimateRuntimeFloor,
  recommendedShardAssignment,
  cellsPerOwner,
} from "../lib/pgbench_shard.mjs";
import { discoverLocalPgEnvironments } from "../lib/pgbench_environment.mjs";
import {
  loadCheckpointIndex,
  classifyCheckpointReuse,
} from "../lib/pgbench_resume.mjs";
import { enumerateExpectedPgbenchCells } from "../lib/pgbench_completeness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN =
  process.env.GATE3_RESUME_DIR ||
  "reports/performance/pgbench/pgbench-contract-20260812-011924-ef21a35e";
const reportDir = RUN.startsWith("/") ? RUN : join(ROOT, RUN);

const discovery = discoverLocalPgEnvironments();
const availableIsolated = discovery.isolated_contention_domain_count;
const plan = recommendedShardAssignment(availableIsolated, 1);
const floor11 = estimateRuntimeFloor({ owner_environments: 11, all_owner_environments: 1 });
const floor4all = estimateRuntimeFloor({ owner_environments: 11, all_owner_environments: 4 });

const expected = enumerateExpectedPgbenchCells();
const checkpoint = existsSync(join(reportDir, "cells"))
  ? loadCheckpointIndex(reportDir)
  : new Map();
let reusable = 0;
let legacy = 0;
let other = 0;
for (const row of checkpoint.values()) {
  const cls = classifyCheckpointReuse(row);
  if (cls.reusable) reusable += 1;
  else if (cls.reason === "LEGACY_CHECKPOINT_INSUFFICIENT") legacy += 1;
  else other += 1;
}

console.log(
  JSON.stringify(
    {
      run_dir: reportDir,
      expected_cell_count: expected.length,
      cells_per_owner: cellsPerOwner(),
      completed_checkpoint_files: checkpoint.size,
      reusable_contract_cells: reusable,
      invalid_legacy_checkpoint_count: legacy,
      other_nonreusable: other,
      available_isolated_environment_count: availableIsolated,
      postgres_containers_on_shared_domain: discovery.postgres_instance_count,
      discovery_warning: discovery.warning,
      theoretical_floors: {
        sequential: floor11,
        with_11_owner_envs_and_1_fullstack: floor11,
        with_11_owner_envs_and_4_fullstack: floor4all,
      },
      recommended: plan,
      commands_when_truly_isolated: PER_OWNER_COMMANDS(reportDir),
      stop: {
        spawn_parallel_now: false,
        reason:
          availableIsolated < 11
            ? "Shared Colima/host contention domain — parallel PER_OWNER_CEILING shards forbidden"
            : "Environments appear isolated; review plan then launch explicitly",
      },
      gates: {
        protocol_execution_authorized: false,
        tuning: false,
        track_c_acceptance_pass: false,
        pgbench_ceiling_complete: false,
      },
    },
    null,
    2,
  ),
);

function PER_OWNER_COMMANDS(run) {
  const owners = [
    "records",
    "shopping",
    "listings",
    "trust",
    "media",
    "messaging",
    "notification",
    "analytics",
    "auction_monitor",
    "ai",
    "auth",
  ];
  return owners.map(
    (owner, shard_index) =>
      `GATE3_CONTRACT=1 GATE3_SHARD_MODE=OWNER_AFFINITY GATE3_SHARD_COUNT=11 GATE3_SHARD_INDEX=${shard_index} GATE3_SHARD_ID=${owner} GATE3_OWNER=${owner} GATE3_ENVIRONMENT_ID=isolated-${owner} GATE3_PHASE=PER_OWNER_CEILING GATE3_RESUME_DIR=${run} PGPASSWORD=postgres node scripts/performance/run-pgbench-matrix.mjs`,
  );
}
