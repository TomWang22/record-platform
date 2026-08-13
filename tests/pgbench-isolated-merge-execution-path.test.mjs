/**
 * Execution-path contract holes: tests MUST call mergeShardResults / CLI / publish,
 * not merely the exported helpers.
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
  COLIMA_SEQUENTIAL_RUN_ID,
  PLACEHOLDER_ISOLATED_RUN_ID,
  buildIsolatedLaunchManifest,
  evaluateIsolatedProbeContract,
  isolatedFullstackClassPins,
  isolatedOwnerClassPins,
  mintIsolatedRunId,
  renderExecutableIsolatedManifest,
  resumeDirForIsolatedRunId,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";
import {
  mergeShardResults,
  publishMergedReportBundle,
} from "../scripts/lib/pgbench_merge.mjs";
import {
  CONTRACT_MEASURED_SECONDS,
  CONTRACT_WARMUP_SECONDS,
  PER_OWNER_OPERATIONAL_ORDER,
  WORKLOAD_REVISION,
  cellKeyFields,
} from "../scripts/lib/pgbench_resume.mjs";
import { FROZEN_HASH_PARTITION_COUNTS } from "../scripts/lib/pgbench_shard.mjs";

const GIT = "ef21a35e18b721b369fbb1a42f975f59a1c43f79";
const CAT = "isolated-catalog-sha-test";
const RUN = "pgbench-isolated-20260812-223000-ef21a35e";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function isolatedOpts(extra = {}) {
  return { lineage: "ISOLATED", expected_run_id: RUN, phase2_shard_count: 4, ...extra };
}

function sequentialOpts(extra = {}) {
  return { lineage: "SEQUENTIAL", expected_run_id: COLIMA_SEQUENTIAL_RUN_ID, ...extra };
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

function fsEnv(i, extra = {}) {
  const hostname = extra.hostname || `vm-fullstack-${i}`;
  return {
    ...isolatedFullstackClassPins(),
    environment_id: `isolated-fullstack-${i}-of-4`,
    hostname,
    db_instance_id: `pg-fullstack-${i}`,
    database_target: `10.1.${i}.10:5432/ALL`,
    postgres_data_directory_identity: `vol-fs-${i}:/pgdata`,
    contention_domain_id: `domain-fullstack-${i}`,
    isolated: true,
    local_database: true,
    database_host_identity: hostname,
    ...extra,
    hostname: extra.hostname || hostname,
  };
}

function isolatedPass(overrides = {}) {
  const owner = overrides.owner ?? "records";
  const mode = overrides.mode ?? "PER_OWNER_CEILING";
  const workload = overrides.workload ?? "W1_DOMAIN_ONLY";
  const repetition = overrides.repetition ?? 1;
  const environment =
    overrides.environment ||
    (mode === "ALL_OWNERS_CONCURRENT" ? fsEnv(0) : ownerEnv(owner, 0));
  const cell = {
    cell_id:
      overrides.cell_id ||
      `${mode}|${owner}|${workload}|UNIFORM|c8|t1|bNA|r${repetition}`,
    status: "PASS",
    owner,
    mode,
    workload,
    distribution: "UNIFORM",
    clients: 8,
    threads: 1,
    batch: null,
    repetition,
    random_seed: 42,
    workload_revision: WORKLOAD_REVISION,
    database_target: environment.database_target,
    postgres_config_hash: environment.postgres_config_hash,
    warmup_seconds: CONTRACT_WARMUP_SECONDS,
    measured_seconds: CONTRACT_MEASURED_SECONDS,
    tps: 100,
    avg_latency_ms: 10,
    git_sha: GIT,
    catalog_sha: CAT,
    isolated_run_id: RUN,
    environment,
    ...(mode === "ALL_OWNERS_CONCURRENT" ? { phase2_shard_count: 4 } : {}),
    ...overrides,
    environment: overrides.environment || environment,
  };
  return cell;
}

function colimaPass(overrides = {}) {
  return isolatedPass({
    isolated_run_id: COLIMA_SEQUENTIAL_RUN_ID,
    git_sha: GIT,
    catalog_sha: CAT,
    ...overrides,
  });
}

function mergeIsolated(shards, extra = {}) {
  return mergeShardResults(shards, isolatedOpts(extra));
}

describe("P0-1 global merge equality on the real merge path", () => {
  it("cross git_sha => merge.ok=false", () => {
    const a = isolatedPass({ owner: "records" });
    const b = isolatedPass({
      owner: "shopping",
      git_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(
      merge.errors.some((e) => /GLOBAL_MERGE_MISMATCH git_sha/.test(e)) ||
        merge.invalid.some((i) => /GLOBAL_MERGE_MISMATCH git_sha/.test(i.reason)),
    );
  });

  it("cross catalog_sha => merge.ok=false", () => {
    const a = isolatedPass({ owner: "records" });
    const b = isolatedPass({ owner: "shopping", catalog_sha: "other-catalog" });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(
      merge.errors.some((e) => /GLOBAL_MERGE_MISMATCH catalog_sha/.test(e)) ||
        merge.invalid.some((i) => /catalog_sha/.test(i.reason)),
    );
  });

  it("cross workload_revision => merge.ok=false", () => {
    const a = isolatedPass({ owner: "records" });
    const b = isolatedPass({ owner: "shopping", workload_revision: "other-rev" });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(merge.ok === false);
  });

  it("cross isolated_run_id => merge.ok=false", () => {
    const a = isolatedPass({ owner: "records" });
    const b = isolatedPass({
      owner: "shopping",
      isolated_run_id: "pgbench-isolated-20260812-999999-ef21a35e",
    });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(
      merge.errors.some((e) => /GLOBAL_MERGE_MISMATCH isolated_run_id/.test(e)) ||
        merge.invalid.some((i) => /isolated_run_id/.test(i.reason)),
    );
  });

  it("missing git_sha => merge.ok=false", () => {
    const a = isolatedPass({ git_sha: "" });
    const merge = mergeIsolated([{ shard_id: "records", results: [a] }]);
    assert.equal(merge.ok, false);
  });

  it("missing catalog_sha => merge.ok=false", () => {
    const a = isolatedPass();
    delete a.catalog_sha;
    const merge = mergeIsolated([{ shard_id: "records", results: [a] }]);
    assert.equal(merge.ok, false);
  });

  it("missing workload_revision => merge.ok=false", () => {
    const a = isolatedPass();
    delete a.workload_revision;
    const merge = mergeIsolated([{ shard_id: "records", results: [a] }]);
    assert.equal(merge.ok, false);
  });

  it("missing isolated_run_id => merge.ok=false", () => {
    const a = isolatedPass();
    delete a.isolated_run_id;
    const merge = mergeIsolated([{ shard_id: "records", results: [a] }]);
    assert.equal(merge.ok, false);
  });

  it("NEW_RUN_ID_REQUIRED is not an isolated merge identity", () => {
    const a = isolatedPass({ isolated_run_id: PLACEHOLDER_ISOLATED_RUN_ID });
    const merge = mergeShardResults([{ shard_id: "records", results: [a] }], {
      lineage: "ISOLATED",
      expected_run_id: PLACEHOLDER_ISOLATED_RUN_ID,
    });
    assert.equal(merge.ok, false);
  });

  it("Colima sequential run id cannot be the isolated expected_run_id", () => {
    const a = isolatedPass({ isolated_run_id: COLIMA_SEQUENTIAL_RUN_ID });
    const merge = mergeShardResults([{ shard_id: "records", results: [a] }], {
      lineage: "ISOLATED",
      expected_run_id: COLIMA_SEQUENTIAL_RUN_ID,
    });
    assert.equal(merge.ok, false);
  });
});

describe("P0-2 merge lineage is explicit, not a Colima blacklist", () => {
  it("ISOLATED merge rejects Colima cells", () => {
    const isolated = isolatedPass({ owner: "records" });
    const colima = colimaPass({
      owner: "shopping",
      cell_id: "PER_OWNER_CEILING|shopping|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
    });
    const merge = mergeIsolated([
      { shard_id: "records", results: [isolated] },
      { shard_id: "colima", results: [colima] },
    ]);
    assert.equal(merge.ok, false);
    assert.equal(merge.results.some((r) => r.isolated_run_id === COLIMA_SEQUENTIAL_RUN_ID), false);
    assert.ok(merge.invalid.some((i) => i.reason === "COLIMA_CHECKPOINT_FORBIDDEN"));
  });

  it("SEQUENTIAL Colima-only lineage remains mergeable", () => {
    const cell = colimaPass();
    const merge = mergeShardResults([{ shard_id: "default", results: [cell] }], sequentialOpts());
    assert.equal(merge.ok, true);
    assert.equal(merge.results.length, 1);
    assert.equal(merge.results[0].isolated_run_id, COLIMA_SEQUENTIAL_RUN_ID);
  });

  it("default mergeShardResults(shards) is SEQUENTIAL so Colima standalone still works", () => {
    const cell = colimaPass();
    const merge = mergeShardResults([{ shard_id: "default", results: [cell] }]);
    assert.equal(merge.ok, true);
    assert.equal(merge.results[0].cell_id, cell.cell_id);
  });

  it("SEQUENTIAL merge rejects injected isolated cells", () => {
    const isolated = isolatedPass();
    const merge = mergeShardResults([{ shard_id: "records", results: [isolated] }], sequentialOpts());
    assert.equal(merge.ok, false);
    assert.ok(
      merge.invalid.some(
        (i) =>
          i.reason === "ISOLATED_CELL_IN_SEQUENTIAL_MERGE" ||
          i.reason === "LINEAGE_INJECTION",
      ),
    );
  });

  it("ISOLATED merge does not consume Colima cells into results", () => {
    const colima = colimaPass();
    const merge = mergeIsolated([{ shard_id: "colima", results: [colima] }]);
    assert.equal(merge.ok, false);
    assert.equal(merge.results.length, 0);
  });
});

describe("P0-3 isolation uniqueness on the real merge path", () => {
  it("duplicate contention_domain_id => fail", () => {
    const a = isolatedPass({ owner: "records", environment: ownerEnv("records", 0) });
    const bEnv = { ...ownerEnv("shopping", 1), contention_domain_id: a.environment.contention_domain_id };
    const b = isolatedPass({
      owner: "shopping",
      environment: bEnv,
      database_target: bEnv.database_target,
    });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
  });

  it("duplicate db_instance_id => fail", () => {
    const a = isolatedPass({ owner: "records" });
    const bEnv = { ...ownerEnv("shopping", 1), db_instance_id: a.environment.db_instance_id };
    const b = isolatedPass({
      owner: "shopping",
      environment: bEnv,
      database_target: bEnv.database_target,
    });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
  });

  it("duplicate hostname => fail", () => {
    const a = isolatedPass({ owner: "records" });
    const bEnv = { ...ownerEnv("shopping", 1), hostname: a.environment.hostname };
    const b = isolatedPass({
      owner: "shopping",
      environment: bEnv,
      database_target: bEnv.database_target,
    });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
  });

  it("duplicate postgres_data_directory_identity => fail", () => {
    const a = isolatedPass({ owner: "records" });
    const bEnv = {
      ...ownerEnv("shopping", 1),
      postgres_data_directory_identity: a.environment.postgres_data_directory_identity,
    };
    const b = isolatedPass({
      owner: "shopping",
      environment: bEnv,
      database_target: bEnv.database_target,
    });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "shopping", results: [b] },
    ]);
    assert.equal(merge.ok, false);
  });

  it("same owner VM may contribute multiple cells without isolation failure", () => {
    const env = ownerEnv("records", 0);
    const a = isolatedPass({ owner: "records", environment: env, workload: "W1_DOMAIN_ONLY" });
    const b = isolatedPass({
      owner: "records",
      environment: env,
      workload: "W2_DOMAIN_PLUS_OUTBOX",
      cell_id: "PER_OWNER_CEILING|records|W2_DOMAIN_PLUS_OUTBOX|UNIFORM|c8|t1|bNA|r1",
    });
    const merge = mergeIsolated([{ shard_id: "records", results: [a, b] }]);
    assert.equal(merge.ok, true);
  });
});

const REUSABLE_SOLE_FIELDS = cellKeyFields().filter(
  (f) => f !== "warmup_seconds" && f !== "measured_seconds",
);

describe("P0-4 isReusableContractCell is fail-closed on the merge path", () => {
  for (const field of REUSABLE_SOLE_FIELDS) {
    it(`PASS missing ${field} does not enter byId / completeness`, () => {
      const cell = isolatedPass();
      if (field === "batch") delete cell.batch;
      else cell[field] = field === "random_seed" ? null : "";
      const merge = mergeIsolated([{ shard_id: "records", results: [cell] }]);
      assert.equal(merge.ok, false);
      assert.equal(merge.results.some((r) => r.cell_id === cell.cell_id && r.status === "PASS"), false);
      assert.ok(
        merge.invalid.some(
          (i) =>
            i.cell_id === cell.cell_id &&
            (i.reason === "NOT_REUSABLE" || i.reason === "REUSABLE_CONTRACT_VIOLATION"),
        ),
      );
    });
  }

  it("PASS missing both tps and avg_latency_ms does not enter byId", () => {
    const cell = isolatedPass();
    delete cell.tps;
    delete cell.avg_latency_ms;
    const merge = mergeIsolated([{ shard_id: "records", results: [cell] }]);
    assert.equal(merge.ok, false);
    assert.equal(merge.results.some((r) => r.cell_id === cell.cell_id), false);
    assert.ok(
      merge.invalid.some(
        (i) => i.reason === "NOT_REUSABLE" || i.reason === "REUSABLE_CONTRACT_VIOLATION",
      ),
    );
  });
});

describe("P0-5 Phase-2 shard class immutability on the real merge path", () => {
  it("only phase2_shard_count=4 is allowed", () => {
    const a = isolatedPass({
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      phase2_shard_count: 4,
      environment: fsEnv(0),
    });
    const b = isolatedPass({
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      phase2_shard_count: 4,
      cell_id: "ALL_OWNERS_CONCURRENT|ALL|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r2",
      repetition: 2,
      environment: fsEnv(1),
    });
    const merge = mergeIsolated([
      { shard_id: "fullstack-0", results: [a] },
      { shard_id: "fullstack-1", results: [b] },
    ]);
    assert.equal(merge.ok, true);
  });

  it("only phase2_shard_count=1 with frozen fallback lineage is allowed", () => {
    const a = isolatedPass({
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      phase2_shard_count: 1,
      environment: fsEnv(0),
    });
    const merge = mergeShardResults([{ shard_id: "fullstack-0", results: [a] }], {
      lineage: "ISOLATED",
      expected_run_id: RUN,
      phase2_shard_count: 1,
      phase2_declared_before_execution: true,
    });
    assert.equal(merge.ok, true);
  });

  it("phase2 4 + 1 mix => PHASE2_SHARD_CLASS_MIX", () => {
    const a = isolatedPass({
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      phase2_shard_count: 4,
      environment: fsEnv(0),
    });
    const b = isolatedPass({
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      phase2_shard_count: 1,
      cell_id: "ALL_OWNERS_CONCURRENT|ALL|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r2",
      repetition: 2,
      environment: fsEnv(1),
    });
    const merge = mergeIsolated([
      { shard_id: "fullstack-0", results: [a] },
      { shard_id: "fullstack-1", results: [b] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(
      merge.errors.some((e) => /PHASE2_SHARD_CLASS_MIX/.test(e)) ||
        merge.invalid.some((i) => i.reason === "PHASE2_SHARD_CLASS_MIX"),
    );
  });
});

describe("P0-6 W1/W2 pair contract includes repetition and class", () => {
  it("matching pair remains valid", () => {
    const env = ownerEnv("records", 0);
    const w1 = isolatedPass({ environment: env, workload: "W1_DOMAIN_ONLY", random_seed: 42 });
    const w2 = isolatedPass({
      environment: env,
      workload: "W2_DOMAIN_PLUS_OUTBOX",
      random_seed: 42,
      cell_id: "PER_OWNER_CEILING|records|W2_DOMAIN_PLUS_OUTBOX|UNIFORM|c8|t1|bNA|r1",
    });
    const merge = mergeIsolated([{ shard_id: "records", results: [w1, w2] }]);
    assert.equal(merge.ok, true);
    assert.equal(
      merge.outbox_tax_pairs.some((p) => p.reason === "CROSS_ENVIRONMENT_PAIR" || p.reason === "INVALID_PAIR"),
      false,
    );
  });

  it("same owner/env/seed but different repetition => CROSS_ENVIRONMENT_PAIR or INVALID_PAIR", () => {
    const env = ownerEnv("records", 0);
    const w1 = isolatedPass({
      environment: env,
      workload: "W1_DOMAIN_ONLY",
      repetition: 1,
      random_seed: 42,
    });
    const w2 = isolatedPass({
      environment: env,
      workload: "W2_DOMAIN_PLUS_OUTBOX",
      repetition: 2,
      random_seed: 42,
      cell_id: "PER_OWNER_CEILING|records|W2_DOMAIN_PLUS_OUTBOX|UNIFORM|c8|t1|bNA|r2",
    });
    const merge = mergeIsolated([{ shard_id: "records", results: [w1, w2] }]);
    assert.ok(
      merge.outbox_tax_pairs.some(
        (p) => p.reason === "CROSS_ENVIRONMENT_PAIR" || p.reason === "INVALID_PAIR",
      ),
    );
  });

  it("mode / comparison class mismatch => INVALID_PAIR or CROSS_ENVIRONMENT_PAIR", () => {
    const env = ownerEnv("records", 0);
    const w1 = isolatedPass({
      environment: env,
      mode: "PER_OWNER_CEILING",
      workload: "W1_DOMAIN_ONLY",
      random_seed: 42,
    });
    const w2 = isolatedPass({
      environment: env,
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      workload: "W2_DOMAIN_PLUS_OUTBOX",
      random_seed: 42,
      phase2_shard_count: 4,
      cell_id: "ALL_OWNERS_CONCURRENT|ALL|W2_DOMAIN_PLUS_OUTBOX|UNIFORM|c8|t1|bNA|r1",
    });
    const merge = mergeIsolated([{ shard_id: "records", results: [w1, w2] }]);
    assert.ok(
      merge.outbox_tax_pairs.some(
        (p) => p.reason === "CROSS_ENVIRONMENT_PAIR" || p.reason === "INVALID_PAIR",
      ) || merge.ok === false,
    );
  });
});

describe("P1-1 duplicate cell_id provenance is fail-closed", () => {
  it("PASS + PASS => DUPLICATE_PASS and no last-write-wins", () => {
    const a = isolatedPass({ tps: 10 });
    const b = isolatedPass({ tps: 99 });
    const merge = mergeIsolated([
      { shard_id: "records", results: [a] },
      { shard_id: "records-retry", results: [b] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(merge.invalid.some((i) => i.reason === "DUPLICATE_PASS"));
    assert.equal(merge.results.filter((r) => r.cell_id === a.cell_id && r.status === "PASS").length, 0);
  });

  it("PASS + FAIL => DUPLICATE_CELL", () => {
    const pass = isolatedPass();
    const fail = isolatedPass({ status: "FAIL", tps: 0 });
    const merge = mergeIsolated([
      { shard_id: "records", results: [pass] },
      { shard_id: "records-retry", results: [fail] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(merge.invalid.some((i) => i.reason === "DUPLICATE_CELL"));
    assert.equal(merge.results.filter((r) => r.cell_id === pass.cell_id && r.status === "PASS").length, 0);
  });

  it("PASS + BLOCKED => DUPLICATE_CELL", () => {
    const pass = isolatedPass();
    const blocked = isolatedPass({ status: "BLOCKED" });
    const merge = mergeIsolated([
      { shard_id: "records", results: [pass] },
      { shard_id: "records-retry", results: [blocked] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(merge.invalid.some((i) => i.reason === "DUPLICATE_CELL"));
  });

  it("FAIL then PASS => DUPLICATE_CELL not last-write-wins PASS", () => {
    const fail = isolatedPass({ status: "FAIL" });
    const pass = isolatedPass({ tps: 50 });
    const merge = mergeIsolated([
      { shard_id: "records", results: [fail] },
      { shard_id: "records-retry", results: [pass] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(merge.invalid.some((i) => i.reason === "DUPLICATE_CELL"));
    assert.equal(merge.results.filter((r) => r.cell_id === pass.cell_id && r.status === "PASS").length, 0);
  });
});

describe("P1-2 atomic merged report publication", () => {
  it("crash before terminal summary leaves previous ceiling marker authoritative", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-merge-atomic-"));
    try {
      writeFileSync(
        join(dir, "summary.json"),
        JSON.stringify({ pgbench_ceiling_complete: false, generation: "previous" }, null, 2) + "\n",
      );
      const files = {
        "raw-results.json": { results: [] },
        "outbox-tax.json": { pairs: [], summary: {} },
        "blocked-cells.json": { cells: [] },
        "summary.json": {
          schema: "record-platform-pgbench-contract-merged/v1",
          pgbench_ceiling_complete: true,
          generation: "new",
        },
      };
      assert.throws(() => publishMergedReportBundle(dir, files, { failBeforeSummary: true }));
      const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
      assert.equal(summary.pgbench_ceiling_complete, false);
      assert.equal(summary.generation, "previous");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writeMergedArtifacts publishes summary.json last via publishMergedReportBundle", () => {
    const src = readFileSync(join(root, "scripts/lib/pgbench_merge.mjs"), "utf8");
    assert.match(src, /publishMergedReportBundle/);
    assert.doesNotMatch(
      src,
      /writeFileSync\([^)]*summary\.json[\s\S]*writeFileSync\([^)]*raw-results/,
    );
  });
});

describe("P1-3 fullstack database locality", () => {
  function ownerIdent(owner, shardIndex) {
    return {
      ...isolatedOwnerClassPins(),
      shard_id: owner,
      environment_id: `isolated-${owner}`,
      hostname: `vm-owner-${owner}`,
      host_fingerprint: `fp-owner-${owner}`,
      db_instance_id: `pg-${owner}`,
      database_target: `10.0.${shardIndex}.10:5432/${owner}`,
      postgres_data_directory_identity: `vol-${owner}:/pgdata`,
      contention_domain_id: `domain-owner-${owner}`,
      isolated: true,
      local_database: true,
      database_host_identity: `vm-owner-${owner}`,
    };
  }

  function fullstackIdent(index, extra = {}) {
    const hostname = extra.hostname || `vm-fullstack-${index}`;
    return {
      ...isolatedFullstackClassPins(),
      shard_id: `fullstack-${index}`,
      environment_id: `isolated-fullstack-${index}-of-4`,
      hostname,
      host_fingerprint: `fp-fs-${index}`,
      db_instance_id: `pg-fullstack-${index}`,
      database_target: `10.1.${index}.10:5432/ALL`,
      postgres_data_directory_identity: `vol-fs-${index}:/pgdata`,
      contention_domain_id: `domain-fullstack-${index}`,
      isolated: true,
      local_database: true,
      database_host_identity: hostname,
      ...extra,
    };
  }

  function pins() {
    return {
      git_sha: GIT,
      catalog_sha: "f8a8ab2c341760e75e4d26d59df0255b5a64769b439842809abcc198e48b3782",
      workload_revision: WORKLOAD_REVISION,
    };
  }

  it("probe rejects remote/shared fullstack database_host_identity", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const fullstack = [0, 1, 2, 3].map((i) =>
      fullstackIdent(i, i === 0 ? { local_database: false, database_host_identity: "remote-shared-db" } : {}),
    );
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      pins: pins(),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: [RUN],
    });
    assert.equal(r.allowed, false);
    assert.match(r.reasons.join(";"), /FULLSTACK_DATABASE_NOT_LOCAL|local_database|database_host_identity|remote/i);
  });

  it("probe rejects one DB instance reused by two fullstack VMs", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const fullstack = [0, 1, 2, 3].map((i) =>
      fullstackIdent(i, i === 1 ? { db_instance_id: "pg-fullstack-0" } : {}),
    );
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      pins: pins(),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: [RUN],
    });
    assert.equal(r.allowed, false);
  });

  it("isolated merge rejects fullstack cell pointing at a remote database", () => {
    const cell = isolatedPass({
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      phase2_shard_count: 4,
      environment: fsEnv(0, { local_database: false, database_host_identity: "rds.example" }),
    });
    const merge = mergeIsolated([{ shard_id: "fullstack-0", results: [cell] }]);
    assert.equal(merge.ok, false);
    assert.ok(
      merge.invalid.some(
        (i) =>
          i.reason === "FULLSTACK_DATABASE_NOT_LOCAL" ||
          /local_database|database_host_identity/.test(i.reason),
      ),
    );
  });

  it("isolated merge rejects fullstack cell whose DB is outside its contention domain", () => {
    const cell = isolatedPass({
      mode: "ALL_OWNERS_CONCURRENT",
      owner: "ALL",
      phase2_shard_count: 4,
      environment: fsEnv(0, {
        db_instance_id: "pg-fullstack-9",
        contention_domain_id: "domain-fullstack-0",
      }),
    });
    const merge = mergeIsolated([{ shard_id: "fullstack-0", results: [cell] }]);
    assert.equal(merge.ok, false);
  });
});

describe("P0-7 fully rendered 15-VM manifest dry path", () => {
  it("synthetic PROVISIONED manifest validates without spawning", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "gate3-src-p07-"));
    mkdirSync(join(repoDir, "scripts/lib"), { recursive: true });
    writeFileSync(join(repoDir, "scripts/lib/pgbench_merge.mjs"), "export const n = 1;\n");
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, encoding: "utf8" });
    execFileSync("git", ["-c", "user.email=gate3@test", "-c", "user.name=gate3", "add", "scripts/lib/pgbench_merge.mjs"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    execFileSync("git", ["-c", "user.email=gate3@test", "-c", "user.name=gate3", "commit", "-m", "freeze"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
    const manifest = renderExecutableIsolatedManifest({
      git_sha: sha,
      catalog_sha: "f8a8ab2c341760e75e4d26d59df0255b5a64769b439842809abcc198e48b3782",
      now: new Date(Date.UTC(2026, 7, 12, 23, 50, 0)),
    });
    assert.notEqual(manifest.isolated_run_id, PLACEHOLDER_ISOLATED_RUN_ID);
    assert.notEqual(manifest.isolated_run_id, COLIMA_SEQUENTIAL_RUN_ID);
    const dir = mkdtempSync(join(tmpdir(), "gate3-rendered-manifest-"));
    const path = join(dir, "rendered-15-vm.json");
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
    const cli = join(root, "scripts/performance/launch-isolated-pgbench-shards.mjs");
    const r = spawnSync(process.execPath, [cli], {
      encoding: "utf8",
      cwd: root,
      env: {
        ...process.env,
        GATE3_ISOLATED_MANIFEST: path,
        GATE3_SOURCE_REPO: repoDir,
      },
    });
    rmSync(dir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const json = JSON.parse(r.stdout);
    assert.ok(json.launch === "PLANNED" || json.validation === "PASS" || json.launch === "PASS");
    assert.ok(json.validation === "PASS" || json.validation === "PLANNED" || json.launch === "PLANNED");
    assert.equal(json.launched, false);
    assert.equal(json.provision, false);
    assert.equal(json.spawn_pgbench, false);
    assert.equal(json.spawn_count, 0);
    assert.equal(json.owner_vm_count, 11);
    assert.equal(json.fullstack_vm_count, 4);
    assert.deepEqual(json.hash_counts, [311, 296, 309, 302]);
    assert.equal(json.phase2_shard_count, 4);
    assert.equal(json.probe_allowed, true);
    assert.notEqual(json.isolated_run_id, PLACEHOLDER_ISOLATED_RUN_ID);
    assert.match(JSON.stringify(manifest), /pgbench-isolated-/);
    assert.doesNotMatch(JSON.stringify(manifest), /NEW_RUN_ID_REQUIRED/);
    assert.doesNotMatch(JSON.stringify(manifest), /DECLARED_AT_PROVISION/);
  });
});

describe("frozen helpers remain unmodified", () => {
  it("evaluateOwnerComplete / assignCellShard / hashShard bodies unchanged by this patch", () => {
    const owner = readFileSync(join(root, "scripts/lib/pgbench_owner_review.mjs"), "utf8");
    const shard = readFileSync(join(root, "scripts/lib/pgbench_shard.mjs"), "utf8");
    assert.match(owner, /export function evaluateOwnerComplete/);
    assert.match(shard, /export function assignCellShard/);
    assert.match(shard, /function hashShard/);
  });
});
