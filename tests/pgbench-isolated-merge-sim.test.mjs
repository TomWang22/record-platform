/**
 * Synthetic completeness / ceiling simulation (S1–S5, M17–M18).
 * Stub PASS cells use catalog identity fields only — not live checkpoints.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateOwnerComplete } from "../scripts/lib/pgbench_owner_review.mjs";
import { enumerateExpectedPgbenchCells } from "../scripts/lib/pgbench_completeness.mjs";
import { COLIMA_SEQUENTIAL_RUN_ID, isolatedFullstackClassPins, isolatedOwnerClassPins } from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";
import {
  CONTRACT_MEASURED_SECONDS,
  CONTRACT_WARMUP_SECONDS,
  WORKLOAD_REVISION,
  evaluateContractCompleteness,
} from "../scripts/lib/pgbench_resume.mjs";
import {
  assertGlobalMergeEquality,
  mergeShardResults,
} from "../scripts/lib/pgbench_merge.mjs";

const GIT = "ef21a35e18b721b369fbb1a42f975f59a1c43f79";
const CAT = "isolated-catalog-sha-test";
const RUN = "pgbench-isolated-20260812-223000-ef21a35e";
const EXPECTED_TOTAL = 14616;
const CELLS_PER_OWNER = 1218;

function stubPass(cell, extra = {}) {
  const environment = extra.environment;
  return {
    cell_id: cell.cell_id,
    status: "PASS",
    owner: cell.owner,
    mode: cell.mode,
    workload: cell.workload,
    distribution: cell.distribution,
    clients: cell.clients,
    threads: cell.threads,
    batch: cell.batch,
    repetition: cell.repetition,
    random_seed: extra.random_seed ?? 42,
    warmup_seconds: CONTRACT_WARMUP_SECONDS,
    measured_seconds: CONTRACT_MEASURED_SECONDS,
    tps: extra.tps ?? 100,
    avg_latency_ms: extra.avg_latency_ms ?? 10,
    database_target: extra.database_target ?? environment?.database_target,
    postgres_config_hash: extra.postgres_config_hash ?? environment?.postgres_config_hash,
    ...extra,
  };
}

function lineage(extra = {}) {
  return {
    git_sha: GIT,
    catalog_sha: CAT,
    workload_revision: WORKLOAD_REVISION,
    isolated_run_id: RUN,
    ...extra,
  };
}

function ownerEnv(owner = "records", i = 0) {
  return {
    ...isolatedOwnerClassPins(),
    environment_id: `isolated-${owner}`,
    hostname: `vm-owner-${owner}`,
    db_instance_id: `pg-${owner}`,
    database_target: `10.0.${i}.10:5432/${owner}`,
    postgres_data_directory_identity: `vol-${owner}:/pgdata`,
    contention_domain_id: `domain-owner-${owner}`,
    isolated: true,
    local_database: true,
    database_host_identity: `vm-owner-${owner}`,
  };
}

function fsEnv(i = 0) {
  return {
    ...isolatedFullstackClassPins(),
    environment_id: `isolated-fullstack-${i}-of-4`,
    hostname: `vm-fullstack-${i}`,
    db_instance_id: `pg-fullstack-${i}`,
    database_target: `10.1.${i}.10:5432/ALL`,
    postgres_data_directory_identity: `vol-fs-${i}:/pgdata`,
    contention_domain_id: `domain-fullstack-${i}`,
    isolated: true,
    local_database: true,
    database_host_identity: `vm-fullstack-${i}`,
  };
}

function passIsolated(cell, extra = {}) {
  const environment = extra.environment || (cell.mode === "ALL_OWNERS_CONCURRENT" ? fsEnv(0) : ownerEnv(cell.owner || "records", 0));
  return stubPass(cell, {
    ...lineage(),
    environment,
    database_target: environment.database_target,
    postgres_config_hash: environment.postgres_config_hash,
    ...(cell.mode === "ALL_OWNERS_CONCURRENT" ? { phase2_shard_count: 4 } : {}),
    ...extra,
    environment: extra.environment || environment,
  });
}

const ISOLATED_MERGE_OPTS = { lineage: "ISOLATED", expected_run_id: RUN, phase2_shard_count: 4 };

describe("isolated merge completeness simulation", () => {
  it("S1 incomplete isolated owner cells do not allow ceiling", () => {
    const owners = enumerateExpectedPgbenchCells()
      .filter((c) => c.mode === "PER_OWNER_CEILING")
      .map((c) => stubPass(c));
    assert.equal(owners.length, CELLS_PER_OWNER * 11);
    const completeness = evaluateContractCompleteness(owners);
    assert.equal(completeness.pgbench_ceiling_complete_allowed, false);
    assert.ok(completeness.missing_count > 0);
    assert.equal(completeness.complete, false);
  });

  it("S2 full synthetic isolated completeness allowed only if predicates pass", () => {
    const stubs = enumerateExpectedPgbenchCells().map((c) => stubPass(c));
    assert.equal(stubs.length, EXPECTED_TOTAL);
    const completeness = evaluateContractCompleteness(stubs);
    assert.equal(completeness.expected_cell_count, EXPECTED_TOTAL);
    assert.equal(completeness.pass_cell_count, EXPECTED_TOTAL);
    assert.equal(completeness.missing_count, 0);
    assert.equal(completeness.complete, true);
    assert.equal(completeness.pgbench_ceiling_complete_allowed, true);

    const catalog = enumerateExpectedPgbenchCells();
    const ownerCell = passIsolated(catalog.find((c) => c.mode === "PER_OWNER_CEILING"));
    const fsCell = passIsolated(catalog.find((c) => c.mode === "ALL_OWNERS_CONCURRENT"));
    const merge = mergeShardResults(
      [
        { shard_id: "records", results: [ownerCell] },
        { shard_id: "fullstack-0", results: [fsCell] },
      ],
      ISOLATED_MERGE_OPTS,
    );
    assert.equal(merge.ok, true);
    assert.equal(assertGlobalMergeEquality([ownerCell, fsCell]).ok, true);
    assert.equal(merge.invalid.length, 0);
  });

  it("S3/M18 Colima cells cannot fill isolated holes", () => {
    const hole = enumerateExpectedPgbenchCells().find((c) => c.mode === "ALL_OWNERS_CONCURRENT");
    const colimaFill = passIsolated(hole, {
      isolated_run_id: COLIMA_SEQUENTIAL_RUN_ID,
      environment: fsEnv(0),
    });
    const merge = mergeShardResults(
      [
        { shard_id: "isolated-records", results: [] },
        { shard_id: "colima", results: [colimaFill] },
      ],
      ISOLATED_MERGE_OPTS,
    );
    assert.equal(assertGlobalMergeEquality([colimaFill]).ok, false);
    assert.ok(merge.invalid.length > 0 || merge.ok === false);
    assert.equal(
      merge.results.some((r) => r.cell_id === hole.cell_id),
      false,
    );
    const completeness = evaluateContractCompleteness(merge.results);
    assert.ok(completeness.missing_count > 0);
    assert.equal(completeness.pgbench_ceiling_complete_allowed, false);
  });

  it("S4/M17 replacement shard duplicates are DUPLICATE_PASS not 1218 valid", () => {
    const concurrent = enumerateExpectedPgbenchCells().filter((c) => c.mode === "ALL_OWNERS_CONCURRENT");
    assert.equal(concurrent.length, CELLS_PER_OWNER);
    const cell = passIsolated(concurrent[0], { environment: fsEnv(0) });
    const merge = mergeShardResults(
      [
        { shard_id: "fullstack-0", results: [cell] },
        { shard_id: "fullstack-replacement", results: [{ ...cell }] },
      ],
      ISOLATED_MERGE_OPTS,
    );
    assert.equal(merge.ok, false);
    assert.ok(merge.invalid.some((i) => i.reason === "DUPLICATE_PASS"));
    assert.equal(merge.results.filter((r) => r.cell_id === cell.cell_id && r.status === "PASS").length, 0);
    const completeness = evaluateContractCompleteness(merge.results);
    assert.notEqual(completeness.pass_cell_count, CELLS_PER_OWNER);
    assert.equal(completeness.pgbench_ceiling_complete_allowed, false);
  });

  it("S5 owner complete is not ceiling", () => {
    const r = evaluateOwnerComplete({
      expected_owner_cells: CELLS_PER_OWNER,
      valid_owner_cells: CELLS_PER_OWNER,
      missing_cells: 0,
      duplicate_cells: 0,
      invalid_environment_cells: 0,
      interference_cells: 0,
      legacy_checkpoint_cells_used: 0,
      cross_environment_w1_w2_pairs: 0,
    });
    assert.equal(r.owner_complete, true);
    assert.equal(r.pgbench_ceiling_complete, false);
  });
});
