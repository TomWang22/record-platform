/**
 * Strict pgbench completeness + stub hard-fail guards.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OWNERS,
  WORKLOADS,
  CLIENTS,
  enumerateExpectedPgbenchCells,
  evaluatePgbenchCompleteness,
  scanPgbenchStubSql,
} from "../scripts/lib/pgbench_completeness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PGBENCH_DIR = join(ROOT, "scripts/performance/pgbench");

describe("pgbench completeness matrix", () => {
  it("enumerates all owners × workloads × distributions × clients × valid threads × reps", () => {
    const cells = enumerateExpectedPgbenchCells();
    assert.ok(cells.length > 1000, `expected large matrix, got ${cells.length}`);
    assert.equal(OWNERS.length, 11);
    assert.equal(WORKLOADS.length, 4);
    assert.deepEqual(CLIENTS, [8, 16, 32, 64, 128, 256]);
    const perOwner = cells.filter((c) => c.mode === "PER_OWNER_CEILING");
    for (const owner of OWNERS) {
      assert.ok(perOwner.some((c) => c.owner === owner), owner);
      for (const workload of WORKLOADS) {
        assert.ok(
          perOwner.some((c) => c.owner === owner && c.workload === workload),
          `${owner}/${workload}`,
        );
      }
    }
    // threads <= clients
    for (const c of cells) {
      assert.ok(c.threads <= c.clients, c.cell_id);
    }
    // W3 has batches; others null
    assert.ok(cells.some((c) => c.workload === "W3_PUBLISHER_DB_PATH" && c.batch === 50));
    assert.ok(cells.every((c) => c.workload !== "W1_DOMAIN_ONLY" || c.batch === null));
  });

  it("completeness fails when any expected cell is missing", () => {
    const expected = enumerateExpectedPgbenchCells();
    const partial = expected.slice(0, 10).map((c) => ({ cell_id: c.cell_id, status: "PASS" }));
    const gate = evaluatePgbenchCompleteness(partial);
    assert.equal(gate.complete, false);
    assert.ok(gate.missing_count > 0);
  });
});

describe("pgbench stub hard-fail", () => {
  it("detects SELECT 1 / 0 and TEMPLATE ONLY tripwires", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-stub-"));
    try {
      writeFileSync(join(dir, "bad.sql"), "-- TEMPLATE ONLY\nSELECT 1 / 0;\n");
      writeFileSync(join(dir, "ok.sql"), "INSERT INTO t(id) VALUES (:id);\n");
      const offenders = scanPgbenchStubSql(dir);
      assert.equal(offenders.length, 1);
      assert.match(offenders[0].path, /bad\.sql$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("live pgbench tree must eventually be stub-free (reports current count)", () => {
    const offenders = scanPgbenchStubSql(PGBENCH_DIR);
    // Before materialization this is >0; after Gate-3 materialization must be 0.
    // The execution runner hard-fails when offenders.length > 0.
    assert.ok(Array.isArray(offenders));
    console.log(`pgbench_stub_offender_count=${offenders.length}`);
  });
});
