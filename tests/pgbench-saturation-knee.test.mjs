/**
 * Owner-scoped saturation-knee generator.
 * Returns INCOMPLETE with knee=null until the owner has exactly 1218/1218 valid cells.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateSaturationKnee } from "../scripts/lib/pgbench_saturation_knee.mjs";
import { writeOwnerReviewArtifacts } from "../scripts/lib/pgbench_owner_review.mjs";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_MEASURED_SECONDS, CONTRACT_WARMUP_SECONDS, WORKLOAD_REVISION } from "../scripts/lib/pgbench_resume.mjs";

describe("pgbench saturation-knee generator", () => {
  it("returns INCOMPLETE with null knee until owner has 1218/1218 valid cells", () => {
    const incomplete = generateSaturationKnee({
      owner: "records",
      owner_complete: false,
      valid_owner_cells: 671,
      expected_owner_cells: 1218,
      rows: [
        { clients: 8, tps: 400, p95: 20, status: "PASS", mode: "PER_OWNER_CEILING", owner: "records" },
        { clients: 16, tps: 410, p95: 40, status: "PASS", mode: "PER_OWNER_CEILING", owner: "records" },
      ],
    });
    assert.equal(incomplete.status, "INCOMPLETE");
    assert.equal(incomplete.knee, null);
    assert.equal(incomplete.TPS_SCALE_KNEE, null);
    assert.equal(incomplete.P95_ACCELERATION, null);
    assert.equal(incomplete.valid_owner_cells, 671);
    assert.equal(incomplete.expected_owner_cells, 1218);
  });

  it("does not treat owner_complete true with the wrong cell count as a knee", () => {
    const drift = generateSaturationKnee({
      owner: "records",
      owner_complete: true,
      valid_owner_cells: 1217,
      expected_owner_cells: 1218,
      rows: [],
    });
    assert.equal(drift.status, "INCOMPLETE");
    assert.equal(drift.knee, null);
  });

  it("computes TPS_SCALE_KNEE from doubling clients once 1218/1218 is valid", () => {
    const rows = [];
    for (const clients of [8, 16, 32, 64]) {
      rows.push({
        owner: "records",
        mode: "PER_OWNER_CEILING",
        status: "PASS",
        workload: "W1_DOMAIN_ONLY",
        distribution: "UNIFORM",
        clients,
        threads: 16,
        tps: clients <= 16 ? clients * 50 : 800,
        p95: clients <= 16 ? 10 : 40,
        p99: clients <= 16 ? 12 : 80,
      });
    }
    const knee = generateSaturationKnee({
      owner: "records",
      owner_complete: true,
      valid_owner_cells: 1218,
      expected_owner_cells: 1218,
      rows,
    });
    assert.equal(knee.status, "OK");
    assert.equal(knee.TPS_SCALE_KNEE, 32);
    assert.equal(knee.P95_ACCELERATION, 32);
    assert.equal(knee.knee.clients, 32);
    assert.equal(knee.CONNECTION_SATURATION.status, "METRIC_UNAVAILABLE");
    assert.equal(knee.CPU_SATURATION.status, "METRIC_UNAVAILABLE");
    assert.equal(knee.LOCK_WAIT_ACCELERATION.status, "METRIC_UNAVAILABLE");
    assert.equal(knee.IO_DOMINANCE.status, "METRIC_UNAVAILABLE");
  });
});

describe("owner-review saturation artifact stays incomplete below 1218", () => {
  it("writeOwnerReviewArtifacts emits INCOMPLETE saturation for a partial owner", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-sat-"));
    try {
      mkdirSync(join(dir, "cells"), { recursive: true });
      writeFileSync(
        join(dir, "cells", "one.json"),
        JSON.stringify({
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
          workload_revision: WORKLOAD_REVISION,
          database_target: "127.0.0.1:5433/records",
          postgres_config_hash: "cfg-hash",
          warmup_seconds: CONTRACT_WARMUP_SECONDS,
          measured_seconds: CONTRACT_MEASURED_SECONDS,
          tps: 400,
          avg_latency_ms: 10,
          p50: 8,
          p95: 20,
          p99: 30,
          environment: {
            environment_id: "env-A",
            db_instance_id: "pg-records",
            contention_domain_id: "domain-1",
            postgres_config_hash: "cfg-hash",
            database_target: "127.0.0.1:5433/records",
          },
        }),
      );
      writeOwnerReviewArtifacts(dir, "records", "run-1");
      const sat = JSON.parse(readFileSync(join(dir, "owner-reviews", "records-saturation.json"), "utf8"));
      assert.equal(sat.status, "INCOMPLETE");
      assert.equal(sat.knee, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
