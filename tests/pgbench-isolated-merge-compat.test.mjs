import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { evaluateOwnerComplete } from "../scripts/lib/pgbench_owner_review.mjs";
import {
  COLIMA_SEQUENTIAL_RUN_ID,
  PRIMARY_TOPOLOGY,
  evaluateIsolatedProbeContract,
  isolatedFullstackClassPins,
  isolatedOwnerClassPins,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";
import {
  assertGlobalMergeEquality,
  assertIsolationMustDiffer,
  assertPerClassEquivalence,
  mergeShardResults,
} from "../scripts/lib/pgbench_merge.mjs";

const GIT = "ef21a35e18b721b369fbb1a42f975f59a1c43f79";
const CAT = "isolated-catalog-sha-test";
const WL = "gate3-v1-domain-touch";
const RUN = "pgbench-isolated-20260812-223000-ef21a35e";

function lineage(extra = {}) {
  return { git_sha: GIT, catalog_sha: CAT, workload_revision: WL, isolated_run_id: RUN, ...extra };
}

function ownerEnv(owner, i) {
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

function fsEnv(i) {
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

describe("isolated merge compatibility", () => {
  it("M1/M6/M7 distinct domains and Phase1≠Phase2 class may merge", () => {
    const owners = ["records", "shopping"].map((o, i) => ({
      ...lineage(),
      mode: "PER_OWNER_CEILING",
      owner: o,
      environment: ownerEnv(o, i),
    }));
    const fs = [{ ...lineage(), mode: "ALL_OWNERS_CONCURRENT", owner: "ALL", environment: fsEnv(0) }];
    assert.equal(assertGlobalMergeEquality([...owners, ...fs]).ok, true);
    assert.equal(assertPerClassEquivalence([...owners, ...fs]).ok, true);
    assert.equal(assertIsolationMustDiffer([...owners, ...fs].map((c) => c.environment)).ok, true);
  });

  it("M2 git mismatch refuses", () => {
    const cells = [
      { ...lineage(), environment: ownerEnv("records", 0) },
      { ...lineage({ git_sha: "deadbeef" }), environment: ownerEnv("shopping", 1) },
    ];
    assert.equal(assertGlobalMergeEquality(cells).ok, false);
  });

  it("M5 Colima lineage refuses", () => {
    const cells = [
      { ...lineage(), environment: ownerEnv("records", 0) },
      { ...lineage({ isolated_run_id: COLIMA_SEQUENTIAL_RUN_ID }), environment: ownerEnv("shopping", 1) },
    ];
    assert.equal(assertGlobalMergeEquality(cells).ok, false);
  });

  it("M8 owner-class mismatch refuses", () => {
    const cells = [
      { mode: "PER_OWNER_CEILING", environment: ownerEnv("records", 0) },
      { mode: "PER_OWNER_CEILING", environment: { ...ownerEnv("shopping", 1), cpu_count: 4 } },
    ];
    assert.equal(assertPerClassEquivalence(cells).ok, false);
  });

  it("M10 shared contention domain refuses isolation", () => {
    const a = ownerEnv("records", 0);
    const b = { ...ownerEnv("shopping", 1), contention_domain_id: a.contention_domain_id };
    assert.equal(assertIsolationMustDiffer([a, b]).ok, false);
  });

  it("M17 duplicate PASS is not counted twice", () => {
    const cell = {
      cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
      status: "PASS",
      owner: "records",
      mode: "PER_OWNER_CEILING",
      workload: "W1_DOMAIN_ONLY",
      distribution: "UNIFORM",
      clients: 8,
      threads: 1,
      batch: null,
      repetition: 1,
      random_seed: 1,
      workload_revision: WL,
      warmup_seconds: 30,
      measured_seconds: 120,
      environment: ownerEnv("records", 0),
    };
    const merge = mergeShardResults([
      { shard_id: "records", results: [cell] },
      { shard_id: "records-retry", results: [{ ...cell }] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(merge.invalid.some((i) => i.reason === "DUPLICATE_PASS"));
  });

  it("M20 evaluateOwnerComplete still never sets ceiling", () => {
    const r = evaluateOwnerComplete({
      expected_owner_cells: 1218,
      valid_owner_cells: 1218,
      missing_cells: 0,
      duplicate_cells: 0,
      invalid_environment_cells: 0,
      interference_cells: 0,
      legacy_checkpoint_cells_used: 0,
      cross_environment_w1_w2_pairs: 0,
    });
    assert.equal(r.owner_complete, true);
    assert.equal(r.pgbench_ceiling_complete, false);
    const src = readFileSync(new URL("../scripts/lib/pgbench_owner_review.mjs", import.meta.url), "utf8");
    assert.match(src, /export function evaluateOwnerComplete/);
    assert.equal((src.match(/pgbench_ceiling_complete: false/g) || []).length >= 3, true);
  });

  it("M3/M4 catalog and workload mismatch refuse", () => {
    assert.equal(
      assertGlobalMergeEquality([
        { ...lineage(), environment: ownerEnv("records", 0) },
        { ...lineage({ catalog_sha: "other" }), environment: ownerEnv("shopping", 1) },
      ]).ok,
      false,
    );
    assert.equal(
      assertGlobalMergeEquality([
        { ...lineage(), environment: ownerEnv("records", 0) },
        { ...lineage({ workload_revision: "other" }), environment: ownerEnv("shopping", 1) },
      ]).ok,
      false,
    );
  });

  it("M9 fullstack-class mismatch refuses", () => {
    const cells = [
      { mode: "ALL_OWNERS_CONCURRENT", environment: fsEnv(0) },
      { mode: "ALL_OWNERS_CONCURRENT", environment: { ...fsEnv(1), memory_limit: "32Gi" } },
    ];
    assert.equal(assertPerClassEquivalence(cells).ok, false);
  });

  it("M11/M12/M13 shared db/host/datadir refuse isolation", () => {
    const a = ownerEnv("records", 0);
    assert.equal(assertIsolationMustDiffer([a, { ...ownerEnv("shopping", 1), db_instance_id: a.db_instance_id }]).ok, false);
    assert.equal(assertIsolationMustDiffer([a, { ...ownerEnv("shopping", 1), hostname: a.hostname }]).ok, false);
    assert.equal(
      assertIsolationMustDiffer([
        a,
        { ...ownerEnv("shopping", 1), postgres_data_directory_identity: a.postgres_data_directory_identity },
      ]).ok,
      false,
    );
  });

  it("M14/M15/M16 W1/W2 pair equality", () => {
    const env = ownerEnv("records", 0);
    const w1 = {
      cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
      status: "PASS",
      owner: "records",
      mode: "PER_OWNER_CEILING",
      workload: "W1_DOMAIN_ONLY",
      distribution: "UNIFORM",
      clients: 8,
      threads: 1,
      batch: null,
      repetition: 1,
      random_seed: 42,
      workload_revision: WL,
      database_target: env.database_target,
      postgres_config_hash: env.postgres_config_hash,
      warmup_seconds: 30,
      measured_seconds: 120,
      tps: 100,
      avg_latency_ms: 10,
      environment: env,
    };
    const w2ok = {
      ...w1,
      cell_id: "PER_OWNER_CEILING|records|W2_DOMAIN_PLUS_OUTBOX|UNIFORM|c8|t1|bNA|r1",
      workload: "W2_DOMAIN_PLUS_OUTBOX",
    };
    const mergeOk = mergeShardResults([{ shard_id: "records", results: [w1, w2ok] }]);
    assert.ok(mergeOk.outbox_tax_pairs.every((p) => p.status !== "INVALID" || p.reason !== "CROSS_ENVIRONMENT_PAIR"));
    const w2domain = {
      ...w2ok,
      environment: { ...env, contention_domain_id: "other-domain", environment_id: "isolated-other" },
    };
    const mergeCross = mergeShardResults([{ shard_id: "records", results: [w1, w2domain] }]);
    assert.ok(mergeCross.outbox_tax_pairs.some((p) => p.reason === "CROSS_ENVIRONMENT_PAIR" || p.status === "INVALID"));
    const w2seed = { ...w2ok, random_seed: 99 };
    const mergeSeed = mergeShardResults([{ shard_id: "records", results: [w1, w2seed] }]);
    assert.ok(mergeSeed.outbox_tax_pairs.some((p) => p.status === "INVALID"));
  });

  it("M18 Colima checkpoint in isolated merge refuses", () => {
    const cell = {
      cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
      status: "PASS",
      isolated_run_id: COLIMA_SEQUENTIAL_RUN_ID,
      git_sha: GIT,
      catalog_sha: CAT,
      workload_revision: WL,
      environment: ownerEnv("records", 0),
    };
    assert.equal(assertGlobalMergeEquality([cell]).ok, false);
  });

  it("M19 mix Phase-2 4-shard and 1-shard refuses", () => {
    assert.equal(PRIMARY_TOPOLOGY, "11_OWNER_VMS_PLUS_4_FULLSTACK_VMS");
    const mix = evaluateIsolatedProbeContract({
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      phase2_classes_seen: [4, 1],
      owner_identities: [],
      fullstack_identities: [],
      pins: { git_sha: GIT, catalog_sha: CAT, workload_revision: WL },
      merge_run_ids: [RUN],
    });
    assert.equal(mix.allowed, false);
    assert.match(mix.reasons.join(";"), /mix/i);
  });
});
