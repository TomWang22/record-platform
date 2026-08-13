/**
 * Control-plane provenance: execution/resume/supervisor bytes are frozen
 * separately from workload SQL/JSON, and run-identity.json is write-once.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CONTROL_PLANE_PATHS } from "../scripts/lib/pgbench_control_plane_bundle.mjs";
import { computeBundleSha256 } from "../scripts/lib/pgbench_source_bundle.mjs";
import {
  RUN_IDENTITY_MUTATION_REFUSED,
  assertControlPlaneMatchesIdentity,
  writeRunIdentityOnce,
} from "../scripts/lib/pgbench_run_identity.mjs";
import {
  CONTROL_PLANE_PROVENANCE_MISMATCH,
  classifySourceLockedReuse,
  sourceDigestsMatchFreeze,
} from "../scripts/lib/pgbench_cell_provenance.mjs";
import { isSourceLockedReusable, WORKLOAD_REVISION } from "../scripts/lib/pgbench_resume.mjs";
import {
  assertFrozenRunIdentity,
  decideSupervisorAction,
} from "../scripts/lib/pgbench_contract_supervisor.mjs";

const REQUIRED_CONTROL_PLANE = [
  "scripts/performance/run-pgbench-matrix.mjs",
  "scripts/performance/supervise-pgbench-contract.mjs",
  "scripts/lib/pgbench_resume.mjs",
  "scripts/lib/pgbench_completeness.mjs",
  "scripts/lib/pgbench_environment.mjs",
  "scripts/lib/pgbench_cell_provenance.mjs",
  "scripts/lib/pgbench_source_bundle.mjs",
  "scripts/lib/pgbench_shard.mjs",
  "scripts/lib/pgbench_contract_runner.mjs",
  "scripts/lib/pgbench_contract_supervisor.mjs",
  "scripts/lib/pgbench_run_watchdog.mjs",
];

describe("control-plane bundle", () => {
  it("pins runner, resume, supervisor, catalog, provenance, and watchdog modules", () => {
    for (const rel of REQUIRED_CONTROL_PLANE) {
      assert.ok(CONTROL_PLANE_PATHS.includes(rel), `missing ${rel}`);
    }
    assert.equal(CONTROL_PLANE_PATHS.includes("scripts/lib/pgbench_isolated_shard_launcher.mjs"), false);
  });

  it("file ordering does not change control-plane bundle SHA", () => {
    const a = computeBundleSha256([
      { path: "b.mjs", sha256: "11" },
      { path: "a.mjs", sha256: "22" },
    ]);
    const b = computeBundleSha256([
      { path: "a.mjs", sha256: "22" },
      { path: "b.mjs", sha256: "11" },
    ]);
    assert.equal(a, b);
  });

  it("one byte change changes control-plane bundle SHA", () => {
    const a = computeBundleSha256([{ path: "a.mjs", sha256: "aa" }]);
    const b = computeBundleSha256([{ path: "a.mjs", sha256: "ab" }]);
    assert.notEqual(a, b);
  });
});

describe("run-identity write-once", () => {
  it("mutation of run-identity.json after creation is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-id-"));
    try {
      const path = join(dir, "run-identity.json");
      const identity = {
        schema: "record-platform-pgbench-run-identity/v1",
        run_id: "pgbench-contract-test",
        git_sha: "abc",
        workload_source_bundle_sha: "w",
        control_plane_bundle_sha: "c",
        catalog_sha: "cat",
        workload_revision: WORKLOAD_REVISION,
        environment_fingerprint: "label|domain|cfg",
        contention_domain_id: "domain",
      };
      const first = writeRunIdentityOnce(path, identity);
      assert.equal(first.ok, true);
      const onDisk = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(onDisk.control_plane_bundle_sha, "c");
      const second = writeRunIdentityOnce(path, { ...identity, environment_fingerprint: "mutated" });
      assert.equal(second.ok, false);
      assert.equal(second.reason, RUN_IDENTITY_MUTATION_REFUSED);
      const still = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(still.environment_fingerprint, "label|domain|cfg");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dual-digest resume and supervision", () => {
  const freeze = {
    run_id: "pgbench-contract-test-abc",
    git_sha: "abc123",
    source_bundle_sha: "workload-aaa",
    workload_source_bundle_sha: "workload-aaa",
    control_plane_bundle_sha: "control-aaa",
    catalog_sha: "catalog-aaa",
    workload_revision: WORKLOAD_REVISION,
    contention_domain_id: "colima-or-host:deadbeef",
  };
  const env = {
    environment_id: "colima-shared-domain",
    db_instance_id: "pg-test",
    contention_domain_id: freeze.contention_domain_id,
    postgres_config_hash: "cfg",
    database_target: "127.0.0.1:5433/records",
    environment_fingerprint: "colima-shared-domain|colima-or-host:deadbeef|cfg",
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

  it("environment label != contention_domain_id does not cause false mismatch", () => {
    assert.notEqual(env.environment_id, freeze.contention_domain_id);
    assert.equal(sourceDigestsMatchFreeze(good, freeze), true);
    assert.equal(isSourceLockedReusable(good, freeze), true);
  });

  it("discovered contention domain change DOES cause mismatch", () => {
    const changed = {
      ...good,
      environment: { ...env, contention_domain_id: "colima-or-host:other" },
      contention_domain_id: "colima-or-host:other",
    };
    assert.equal(sourceDigestsMatchFreeze(changed, freeze), false);
    assert.equal(isSourceLockedReusable(changed, freeze), false);
  });

  it("first cell missing control_plane_bundle_sha is non-reusable", () => {
    const legacy = { ...good };
    delete legacy.control_plane_bundle_sha;
    assert.equal(isSourceLockedReusable(legacy, freeze), false);
    const cls = classifySourceLockedReuse(legacy, freeze, (c) => c.status === "PASS");
    assert.equal(cls.reusable, false);
    assert.equal(cls.reason, CONTROL_PLANE_PROVENANCE_MISMATCH);
  });

  it("supervisor from different control-plane SHA refuses resume", () => {
    const frozen = {
      resume_dir: "/tmp/run",
      git_sha: "abc",
      catalog_sha: "cat",
      environment_fingerprint: "fp",
      warmup_seconds: 30,
      measured_seconds: 120,
      expected_cell_count: 14616,
      expected_owner_cells: 1218,
      workload_revision: WORKLOAD_REVISION,
      source_bundle_sha: "w",
      control_plane_bundle_sha: "control-aaa",
      run_id: "run-1",
    };
    const observed = { ...frozen, control_plane_bundle_sha: "control-bbb" };
    const id = assertFrozenRunIdentity(frozen, observed);
    assert.equal(id.ok, false);
    assert.equal(id.code, CONTROL_PLANE_PROVENANCE_MISMATCH);
    const d = decideSupervisorAction({
      now_ms: 1,
      frozen_identity: frozen,
      observed_identity: observed,
      runner_alive: false,
      pgbench_alive: false,
      concurrent_runner_count: 0,
      last_progress_at_ms: null,
      stall_after_ms: 1_000_000,
      owner: "records",
      pending_cells: [],
      owner_reviews_written: [],
      restarts_for_current_cell: 0,
      max_restarts_per_cell: 3,
      resume_dir: frozen.resume_dir,
      global_valid_cells: 0,
      all_owners_concurrent_complete: false,
      global_ceiling: { pgbench_ceiling_complete: false },
    });
    assert.equal(d.action, CONTROL_PLANE_PROVENANCE_MISMATCH);
    assert.equal(d.launch, false);
    assert.equal(d.exit_code, 2);
    assert.equal(d.stop, true);
  });

  it("runner from different control-plane SHA refuses resume", () => {
    const identity = {
      run_id: "run-1",
      git_sha: "abc",
      workload_source_bundle_sha: "w",
      control_plane_bundle_sha: "control-aaa",
    };
    const live = { control_plane_bundle_sha: "control-bbb", workload_source_bundle_sha: "w" };
    const verdict = assertControlPlaneMatchesIdentity(identity, live);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, CONTROL_PLANE_PROVENANCE_MISMATCH);
  });
});
