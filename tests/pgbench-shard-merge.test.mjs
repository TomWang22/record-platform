/**
 * Environment isolation / equivalence + safe shard merge.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildEnvironmentIdentity,
  assertIsolationPair,
  assertEnvironmentEquivalence,
  detectInterference,
} from "../scripts/lib/pgbench_environment.mjs";
import {
  mergeShardResults,
  validateMergedCompleteness,
} from "../scripts/lib/pgbench_merge.mjs";
import { WORKLOAD_REVISION, CONTRACT_WARMUP_SECONDS, CONTRACT_MEASURED_SECONDS } from "../scripts/lib/pgbench_resume.mjs";

function env(overrides = {}) {
  return buildEnvironmentIdentity({
    shard_id: "records",
    environment_id: "env-records-A",
    hostname: "host-a",
    host_fingerprint: "fp-a",
    db_instance_id: "pg-records-1",
    database_target: "127.0.0.1:5433/records",
    postgres_version: "16.14",
    postgres_config_hash: "cfg1",
    container_runtime: "docker",
    container_limits: { cpus: "2", memory: "4g" },
    cpu_model: "test-cpu",
    cpu_count: 2,
    cpu_set: "0-1",
    memory_limit: "4g",
    storage_device_identity: "disk-A",
    filesystem: "ext4",
    kernel: "linux",
    postgres_data_directory_identity: "data-records",
    contention_domain_id: "domain-A",
    ...overrides,
  });
}

function passCell(overrides = {}) {
  return {
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
    workload_revision: WORKLOAD_REVISION,
    database_target: "127.0.0.1:5433/records",
    postgres_config_hash: "cfg1",
    warmup_seconds: CONTRACT_WARMUP_SECONDS,
    measured_seconds: CONTRACT_MEASURED_SECONDS,
    tps: 400,
    avg_latency_ms: 20,
    environment: env(),
    ...overrides,
  };
}

describe("pgbench environment guards", () => {
  it("fails isolation when db_instance_id or contention domain collide", () => {
    const a = env({ db_instance_id: "same", contention_domain_id: "d1" });
    const b = env({
      shard_id: "shopping",
      environment_id: "env-shopping",
      db_instance_id: "same",
      contention_domain_id: "d2",
      database_target: "127.0.0.1:5436/shopping",
    });
    const r = assertIsolationPair(a, b);
    assert.equal(r.ok, false);
    assert.match(r.reason, /db_instance_id|contention/i);
  });

  it("does not claim isolation from different ports alone on shared contention domain", () => {
    const a = env({
      database_target: "127.0.0.1:5433/records",
      db_instance_id: "pg-records",
      contention_domain_id: "colima-shared",
    });
    const b = env({
      shard_id: "media",
      environment_id: "env-media",
      database_target: "127.0.0.1:5443/media",
      db_instance_id: "pg-media",
      contention_domain_id: "colima-shared",
    });
    const r = assertIsolationPair(a, b);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "SHARED_CONTENTION_DOMAIN");
  });

  it("passes equivalence when config/resources match", () => {
    const a = env();
    const b = env({
      shard_id: "shopping",
      environment_id: "env-shopping",
      db_instance_id: "pg-shopping",
      database_target: "127.0.0.1:5436/shopping",
      postgres_data_directory_identity: "data-shopping",
      contention_domain_id: "domain-B",
    });
    const r = assertEnvironmentEquivalence(a, b);
    assert.equal(r.ok, true);
  });

  it("detects concurrent pgbench interference", () => {
    const r = detectInterference({
      active_pgbench_targets: ["127.0.0.1:5433/records", "127.0.0.1:5433/records"],
      database_target: "127.0.0.1:5433/records",
      swap_used_bytes: 0,
      cpu_throttled: false,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "INVALID_ENVIRONMENT_INTERFERENCE");
  });
});

describe("pgbench shard merge", () => {
  it("rejects duplicate PASS and scout durations", () => {
    const a = passCell();
    const b = passCell({ tps: 999 });
    const merge = mergeShardResults([
      { shard_id: "records", results: [a] },
      { shard_id: "records-dup", results: [b] },
    ]);
    assert.equal(merge.ok, false);
    assert.ok(merge.errors.some((e) => /duplicate/i.test(e)));
  });

  it("rejects cells missing environment identity as LEGACY_CHECKPOINT_INSUFFICIENT", () => {
    const legacy = passCell();
    delete legacy.environment;
    const merge = mergeShardResults([{ shard_id: "records", results: [legacy] }]);
    assert.equal(merge.ok, false);
    assert.ok(
      merge.invalid.some((i) => i.reason === "LEGACY_CHECKPOINT_INSUFFICIENT"),
    );
  });

  it("rejects CROSS_ENVIRONMENT W1/W2 pairs in outbox tax path", () => {
    const w1 = passCell({
      workload: "W1_DOMAIN_ONLY",
      cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
      environment: env({ environment_id: "env-A" }),
    });
    const w2 = passCell({
      workload: "W2_DOMAIN_PLUS_OUTBOX",
      cell_id: "PER_OWNER_CEILING|records|W2_DOMAIN_PLUS_OUTBOX|UNIFORM|c8|t1|bNA|r1",
      avg_latency_ms: 30,
      environment: env({ environment_id: "env-B", db_instance_id: "other" }),
    });
    const merge = mergeShardResults([{ shard_id: "records", results: [w1, w2] }]);
    assert.ok(
      merge.outbox_tax_pairs.some(
        (p) => p.status === "INVALID" && p.reason === "CROSS_ENVIRONMENT_PAIR",
      ),
    );
  });

  it("validateMergedCompleteness stays false until all 14616 valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-merge-"));
    try {
      mkdirSync(join(dir, "shards", "records", "cells"), { recursive: true });
      writeFileSync(
        join(dir, "shards", "records", "cells", "one.json"),
        JSON.stringify(passCell()),
      );
      const v = validateMergedCompleteness(dir);
      assert.equal(v.pgbench_ceiling_complete_allowed, false);
      assert.ok(v.missing_count > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
