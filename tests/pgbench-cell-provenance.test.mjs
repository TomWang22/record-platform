/**
 * Per-cell source provenance and source-locked resume.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  captureCellSourceProvenance,
  evaluateSourceBeforeAccept,
  sourceDigestsMatchFreeze,
  SOURCE_CHANGED_DURING_CELL,
  SOURCE_PROVENANCE_MISMATCH,
} from "../scripts/lib/pgbench_cell_provenance.mjs";
import { isSourceLockedReusable, nextMissingCells, WORKLOAD_REVISION } from "../scripts/lib/pgbench_resume.mjs";

const freeze = {
  run_id: "pgbench-contract-test-abc",
  git_sha: "abc123",
  source_bundle_sha: "bundle-aaa",
  catalog_sha: "catalog-aaa",
  workload_revision: WORKLOAD_REVISION,
  contention_domain_id: "colima-or-host",
};

function sqlTree() {
  const dir = mkdtempSync(join(tmpdir(), "prov-sql-"));
  mkdirSync(join(dir, "scripts/performance/pgbench/records"), { recursive: true });
  mkdirSync(join(dir, "scripts/performance/pgbench/common"), { recursive: true });
  writeFileSync(join(dir, "scripts/performance/pgbench/records/domain-only.sql"), "w1\n");
  writeFileSync(join(dir, "scripts/performance/pgbench/common/seed.sql"), "seed\n");
  writeFileSync(join(dir, "scripts/performance/pgbench/common/cleanup.sql"), "cleanup\n");
  return dir;
}

describe("per-cell source provenance", () => {
  it("hashes the actual files that will be passed to pgbench/psql", () => {
    const root = sqlTree();
    try {
      const prov = captureCellSourceProvenance({
        root,
        freeze,
        owner: "records",
        workload: "W1_DOMAIN_ONLY",
        environment: {
          db_instance_id: "pg-records",
          contention_domain_id: freeze.contention_domain_id,
          database_target: "127.0.0.1:5433/records",
          environment_fingerprint: "fp",
        },
        cell: {
          cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
          owner: "records",
          mode: "PER_OWNER_CEILING",
          workload: "W1_DOMAIN_ONLY",
          distribution: "UNIFORM",
          clients: 8,
          threads: 1,
          batch: null,
          repetition: 1,
          random_seed: 1,
          warmup_seconds: 30,
          measured_seconds: 120,
        },
      });
      assert.equal(prov.run_id, freeze.run_id);
      assert.equal(prov.git_sha, freeze.git_sha);
      assert.equal(prov.source_bundle_sha, freeze.source_bundle_sha);
      assert.equal(prov.workload_sql_path, "scripts/performance/pgbench/records/domain-only.sql");
      assert.equal(prov.seed_sql_path, "scripts/performance/pgbench/common/seed.sql");
      assert.equal(prov.cleanup_sql_path, "scripts/performance/pgbench/common/cleanup.sql");
      assert.equal(prov.workload_sql_sha256.length, 64);
      assert.equal(prov.seed_sql_sha256.length, 64);
      assert.equal(prov.cleanup_sql_sha256.length, 64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("invalidates a cell when source bytes change during the cell", () => {
    const root = sqlTree();
    try {
      const start = captureCellSourceProvenance({
        root,
        freeze,
        owner: "records",
        workload: "W1_DOMAIN_ONLY",
        environment: { contention_domain_id: freeze.contention_domain_id },
        cell: { cell_id: "c1", owner: "records", workload: "W1_DOMAIN_ONLY" },
      });
      writeFileSync(join(root, "scripts/performance/pgbench/records/domain-only.sql"), "mutated\n");
      const verdict = evaluateSourceBeforeAccept({ root, start, freeze, owner: "records", workload: "W1_DOMAIN_ONLY" });
      assert.equal(verdict.ok, false);
      assert.equal(verdict.status, "INVALID");
      assert.equal(verdict.reason, SOURCE_CHANGED_DURING_CELL);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("source-locked resume", () => {
  const env = {
    environment_id: "env-test",
    db_instance_id: "pg-test",
    contention_domain_id: freeze.contention_domain_id,
    postgres_config_hash: "cfg",
    database_target: "127.0.0.1:5433/records",
  };
  const good = {
    cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c8|t1|bNA|r1",
    status: "PASS",
    warmup_seconds: 30,
    measured_seconds: 120,
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
    postgres_config_hash: "cfg",
    tps: 10,
    avg_latency_ms: 1,
    environment: env,
    ...freeze,
    workload_sql_sha256: "w",
    seed_sql_sha256: "s",
    cleanup_sql_sha256: "c",
  };

  it("reuses a cell only when every source digest matches the active freeze", () => {
    assert.equal(isSourceLockedReusable(good, freeze), true);
  });

  it("does not silently upgrade legacy checkpoints missing source digests", () => {
    const legacy = { ...good };
    delete legacy.source_bundle_sha;
    const r = isSourceLockedReusable(legacy, freeze);
    assert.equal(r, false);
  });

  it("reruns on SOURCE_PROVENANCE_MISMATCH", () => {
    const mismatch = { ...good, source_bundle_sha: "other-bundle" };
    assert.equal(isSourceLockedReusable(mismatch, freeze), false);
    const catalog = { cells: [{ ...good }] };
    const idx = new Map([[good.cell_id, mismatch]]);
    const pending = nextMissingCells(catalog, idx, freeze);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].cell_id, good.cell_id);
  });
});
