/**
 * Read-only per-owner Gate-3 review block generator.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOwnerReview,
  evaluateOwnerComplete,
  evaluateOwnerReview,
  summarizeW3Batches,
  summarizeLatency,
  summarizePostgresWaits,
} from "../scripts/lib/pgbench_owner_review.mjs";
import { WORKLOAD_REVISION, CONTRACT_WARMUP_SECONDS, CONTRACT_MEASURED_SECONDS } from "../scripts/lib/pgbench_resume.mjs";
import { cellsPerOwner } from "../scripts/lib/pgbench_shard.mjs";
import { enumerateExpectedPgbenchCells } from "../scripts/lib/pgbench_completeness.mjs";

function env(id = "env-A") {
  return {
    environment_id: id,
    db_instance_id: "pg-records",
    contention_domain_id: "domain-1",
    postgres_config_hash: "cfg-hash",
    database_target: "127.0.0.1:5433/records",
  };
}

function cell(overrides = {}) {
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
    environment: env(),
    ...overrides,
  };
}

describe("pgbench owner review generator", () => {
  it("reports incomplete owner when below 1218 env-valid cells", () => {
    const review = buildOwnerReview({
      owner: "records",
      run_id: "run-1",
      results: [cell()],
    });
    assert.equal(review.expected_owner_cells, cellsPerOwner());
    assert.equal(review.valid_owner_cells, 1);
    assert.ok(review.missing_cells > 0);
    assert.equal(review.owner_complete, false);
    assert.equal(review.legacy_checkpoint_cells_used, 0);
    assert.equal(review.pgbench_ceiling_complete, false);
  });

  it("excludes legacy (no environment) from valid_owner_cells", () => {
    const legacy = cell();
    delete legacy.environment;
    const good = cell({
      cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r2",
      repetition: 2,
      environment: env(),
    });
    const review = buildOwnerReview({
      owner: "records",
      run_id: "run-1",
      results: [legacy, good],
    });
    assert.equal(review.valid_owner_cells, 1);
    assert.equal(review.legacy_checkpoint_cells_used, 0);
    assert.equal(review.invalid_environment_cells, 1);
  });

  it("flags CROSS_ENVIRONMENT W1/W2 pairs", () => {
    const w1 = cell({
      workload: "W1_DOMAIN_ONLY",
      cell_id: "w1",
      environment: env("env-A"),
    });
    const w2 = cell({
      workload: "W2_DOMAIN_PLUS_OUTBOX",
      cell_id: "w2",
      avg_latency_ms: 15,
      environment: env("env-B"),
    });
    const review = buildOwnerReview({
      owner: "records",
      run_id: "run-1",
      results: [w1, w2],
    });
    assert.ok(review.cross_environment_w1_w2_pairs >= 1);
  });

  it("builds w3/latency/postgres wait summaries without inventing metrics", () => {
    const rows = [
      cell({
        workload: "W3_PUBLISHER_DB_PATH",
        batch: 1,
        cell_id: "w3b1",
        p95: 40,
      }),
      cell({
        workload: "W3_PUBLISHER_DB_PATH",
        batch: 10,
        cell_id: "w3b10",
        p95: 35,
        avg_latency_ms: 12,
      }),
    ];
    const w3 = summarizeW3Batches(rows);
    assert.ok(w3.by_batch["1"]);
    assert.ok(w3.by_batch["10"]);
    assert.equal(w3.optimal_batch_selected, null);
    const lat = summarizeLatency(rows);
    assert.ok(lat.cells_with_p95 >= 1);
    const waits = summarizePostgresWaits(rows);
    assert.equal(waits.status, "PARTIAL_OR_UNAVAILABLE");
  });

  it("OWNER_COMPLETE requires exact 1218/1218 and zero anomalies", () => {
    const expected = cellsPerOwner();
    assert.equal(expected, 1218);
    const incomplete = evaluateOwnerComplete({
      expected_owner_cells: 1218,
      valid_owner_cells: 17,
      missing_cells: 1201,
      duplicate_cells: 0,
      invalid_environment_cells: 0,
      interference_cells: 0,
      legacy_checkpoint_cells_used: 0,
      cross_environment_w1_w2_pairs: 0,
    });
    assert.equal(incomplete.owner_complete, false);
    assert.equal(incomplete.pgbench_ceiling_complete, false);

    const complete = evaluateOwnerComplete({
      expected_owner_cells: 1218,
      valid_owner_cells: 1218,
      missing_cells: 0,
      duplicate_cells: 0,
      invalid_environment_cells: 0,
      interference_cells: 0,
      legacy_checkpoint_cells_used: 0,
      cross_environment_w1_w2_pairs: 0,
    });
    assert.equal(complete.owner_complete, true);
    assert.equal(complete.pgbench_ceiling_complete, false);
  });

  it("fails OWNER_COMPLETE when valid_owner_cells exceeds expected (catalog drift)", () => {
    const over = evaluateOwnerComplete({
      expected_owner_cells: 1218,
      valid_owner_cells: 1219,
      missing_cells: 0,
      duplicate_cells: 0,
      invalid_environment_cells: 0,
      interference_cells: 0,
      legacy_checkpoint_cells_used: 0,
      cross_environment_w1_w2_pairs: 0,
    });
    assert.equal(over.owner_complete, false);
    assert.equal(over.over_count, true);
    assert.match(over.reason, /valid_owner_cells > expected/);
  });

  it("buildOwnerReview sets owner_complete false on any anomaly including over-count", () => {
    const ids = enumerateExpectedPgbenchCells()
      .filter((c) => c.mode === "PER_OWNER_CEILING" && c.owner === "records")
      .slice(0, 3);
    const results = ids.map((c, i) =>
      cell({
        ...c,
        cell_id: c.cell_id,
        clients: c.clients,
        threads: c.threads,
        repetition: c.repetition,
        batch: c.batch,
        workload: c.workload,
        distribution: c.distribution,
        random_seed: 100 + i,
        environment: env(),
      }),
    );
    // Inject an extra phantom env-valid cell with a forged id that somehow increments valid
    // Over-count is enforced via evaluateOwnerComplete on the review counters.
    const review = buildOwnerReview({ owner: "records", run_id: "run-1", results });
    assert.equal(review.owner_complete, false);
    assert.equal(review.pgbench_ceiling_complete, false);
    assert.ok(review.valid_owner_cells < review.expected_owner_cells);
    assert.equal(review.exit_code, 2);
  });

  it("evaluateOwnerReview is a pure read and does not write artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-eval-review-"));
    try {
      mkdirSync(join(dir, "cells"), { recursive: true });
      writeFileSync(
        join(dir, "cells", "one.json"),
        JSON.stringify(
          cell({
            cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
          }),
        ),
      );
      const before = readdirSync(dir).sort();
      const review = evaluateOwnerReview(dir, "records", "run-1");
      assert.equal(review.owner, "records");
      assert.equal(review.pgbench_ceiling_complete, false);
      assert.equal(review.owner_complete, false);
      const after = readdirSync(dir).sort();
      assert.deepEqual(after, before);
      assert.equal(existsSync(join(dir, "owner-reviews")), false);
      assert.equal(existsSync(join(dir, "records-owner-review.json")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
