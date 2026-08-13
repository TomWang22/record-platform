/**
 * Gate 3 completion: resumable full-cell catalog + scout non-promotion.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CONTRACT_WARMUP_SECONDS,
  CONTRACT_MEASURED_SECONDS,
  WORKLOAD_REVISION,
  buildExpectedCellCatalog,
  cellKeyFields,
  isReusableContractCell,
  rejectScoutPromotion,
  loadCheckpointIndex,
  nextMissingCells,
  evaluateContractCompleteness,
} from "../scripts/lib/pgbench_resume.mjs";
import { enumerateExpectedPgbenchCells } from "../scripts/lib/pgbench_completeness.mjs";

describe("pgbench resume / contract catalog", () => {
  const env = {
    environment_id: "env-test",
    db_instance_id: "pg-test",
    contention_domain_id: "domain-test",
    postgres_config_hash: "cfg",
    database_target: "127.0.0.1:5443/media",
    shard_id: "media",
    hostname: "h",
    host_fingerprint: "fp",
    postgres_version: "16",
    container_runtime: "test",
    container_limits: {},
    cpu_model: "x",
    cpu_count: 1,
    cpu_set: "0",
    memory_limit: "1g",
    storage_device_identity: "disk",
    filesystem: "x",
    kernel: "x",
    postgres_data_directory_identity: "data",
  };

  it("builds expected catalog with all contract matrix dimensions", () => {
    const catalog = buildExpectedCellCatalog({
      workload_revision: WORKLOAD_REVISION,
      postgres_config_hash: "cfg-test",
      database_targets: { media: "127.0.0.1:5443/media" },
    });
    assert.equal(catalog.warmup_seconds, CONTRACT_WARMUP_SECONDS);
    assert.equal(catalog.measured_seconds, CONTRACT_MEASURED_SECONDS);
    assert.equal(catalog.cells.length, enumerateExpectedPgbenchCells().length);
    const sample = catalog.cells[0];
    for (const f of cellKeyFields()) {
      assert.ok(f in sample, `missing key field ${f}`);
    }
    assert.equal(sample.warmup_seconds, 30);
    assert.equal(sample.measured_seconds, 120);
  });

  it("never reuses scout cells as full-contract PASS", () => {
    const scout = {
      cell_id: "PER_OWNER_CEILING|media|W1_DOMAIN_ONLY|UNIFORM|c8|t8|bNA|r1",
      status: "PASS",
      warmup_seconds: 5,
      measured_seconds: 20,
      owner: "media",
      mode: "PER_OWNER_CEILING",
      workload: "W1_DOMAIN_ONLY",
      distribution: "UNIFORM",
      clients: 8,
      threads: 8,
      batch: null,
      repetition: 1,
      random_seed: 1,
      workload_revision: WORKLOAD_REVISION,
      database_target: "127.0.0.1:5443/media",
      postgres_config_hash: "cfg",
    };
    assert.equal(isReusableContractCell(scout), false);
    const rej = rejectScoutPromotion(scout);
    assert.equal(rej.ok, false);
    assert.match(rej.reason, /scout|warmup|measured/i);
  });

  it("reuses only PASS cells that match full contract key fields", () => {
    const good = {
      cell_id: "PER_OWNER_CEILING|media|W1_DOMAIN_ONLY|UNIFORM|c8|t8|bNA|r1",
      status: "PASS",
      warmup_seconds: 30,
      measured_seconds: 120,
      owner: "media",
      mode: "PER_OWNER_CEILING",
      workload: "W1_DOMAIN_ONLY",
      distribution: "UNIFORM",
      clients: 8,
      threads: 8,
      batch: null,
      repetition: 1,
      random_seed: 42,
      workload_revision: WORKLOAD_REVISION,
      database_target: "127.0.0.1:5443/media",
      postgres_config_hash: "cfg",
      tps: 100,
      avg_latency_ms: 1,
      environment: env,
    };
    assert.equal(isReusableContractCell(good), true);
    const badSeed = { ...good, random_seed: null };
    assert.equal(isReusableContractCell(badSeed), false);
    const legacy = { ...good };
    delete legacy.environment;
    assert.equal(isReusableContractCell(legacy), false);
  });

  it("resumes from first missing/invalid cell and skips reusable PASS", () => {
    const catalog = buildExpectedCellCatalog({
      workload_revision: WORKLOAD_REVISION,
      postgres_config_hash: "cfg",
      database_targets: Object.fromEntries(
        [
          "media",
          "messaging",
          "notification",
          "records",
          "shopping",
          "trust",
          "auth",
          "listings",
          "analytics",
          "auction_monitor",
          "ai",
          "ALL",
        ].map((o) => [o, `db/${o}`]),
      ),
    });
    const first = catalog.cells[0];
    const reused = {
      ...first,
      status: "PASS",
      tps: 1,
      avg_latency_ms: 1,
      random_seed: 99,
      environment: { ...env, database_target: first.database_target },
    };
    // catalog cells may not have random_seed until materialization — inject for match
    const withSeed = catalog.cells.map((c, i) =>
      i === 0 ? { ...c, random_seed: 99 } : c,
    );
    const catalog2 = { ...catalog, cells: withSeed };
    const dir = mkdtempSync(join(tmpdir(), "pgbench-ckpt-"));
    try {
      mkdirSync(join(dir, "cells"), { recursive: true });
      const safeId = reused.cell_id.replace(/\|/g, "__");
      writeFileSync(join(dir, "cells", `${safeId}.json`), JSON.stringify(reused, null, 2));
      const idx = loadCheckpointIndex(dir);
      assert.equal(idx.size, 1);
      const pending = nextMissingCells(catalog2, idx);
      assert.ok(pending.length < catalog2.cells.length);
      assert.notEqual(pending[0].cell_id, first.cell_id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("contract completeness requires full matrix PASS with contract durations", () => {
    const partial = enumerateExpectedPgbenchCells()
      .slice(0, 5)
      .map((c) => ({
        ...c,
        status: "PASS",
        warmup_seconds: 30,
        measured_seconds: 120,
      }));
    const gate = evaluateContractCompleteness(partial);
    assert.equal(gate.complete, false);
    assert.equal(gate.pgbench_ceiling_complete_allowed, false);
    assert.ok(gate.missing_count > 0);
  });

  it("ENVIRONMENT_CAPACITY blocks keep ceiling incomplete", () => {
    const expected = enumerateExpectedPgbenchCells();
    const results = expected.map((c) => ({
      ...c,
      status: "BLOCKED",
      blocked_reason: "ENVIRONMENT_CAPACITY: test",
      warmup_seconds: 30,
      measured_seconds: 120,
    }));
    const gate = evaluateContractCompleteness(results);
    assert.equal(gate.complete, false);
    assert.equal(gate.pgbench_ceiling_complete_allowed, false);
    assert.equal(gate.blocked_cell_count, expected.length);
  });
});
