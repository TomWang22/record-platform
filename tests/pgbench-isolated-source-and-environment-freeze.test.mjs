/**
 * P0-A/B/C/D: freeze the committed Gate-3 source revision and performance
 * environment fingerprint. Tests use fixture git repos — they must not
 * mutate the live Colima run or provision VMs.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PER_OWNER_OPERATIONAL_ORDER } from "../scripts/lib/pgbench_resume.mjs";
import {
  FROZEN_HASH_CELL_ID_CATALOG_SHA256,
  FROZEN_HASH_PARTITION_COUNTS,
} from "../scripts/lib/pgbench_shard.mjs";
import {
  assertPerformanceEnvironmentEquivalence,
} from "../scripts/lib/pgbench_environment.mjs";
import { assertIsolatedSourceRevision } from "../scripts/lib/pgbench_isolated_source_revision.mjs";
import {
  COLIMA_SEQUENTIAL_RUN_ID,
  PLACEHOLDER_CONTENTION_DOMAIN,
  PLACEHOLDER_ISOLATED_RUN_ID,
  PRIMARY_TOPOLOGY,
  assertIsolatedRunId,
  buildIsolatedRunIdentity,
  evaluateIsolatedProbeContract,
  isolatedFullstackClassPins,
  isolatedOwnerClassPins,
  persistIsolatedRunIdentity,
  renderExecutableIsolatedManifest,
  resumeDirForIsolatedRunId,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAT = "f8a8ab2c341760e75e4d26d59df0255b5a64769b439842809abcc198e48b3782";
const WL = "gate3-v1-domain-touch";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeSourceRepo() {
  const dir = mkdtempSync(join(tmpdir(), "gate3-src-"));
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "scripts/performance"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, "scripts/lib/pgbench_merge.mjs"), "export const n = 1;\n");
  writeFileSync(join(dir, "scripts/performance/launch-isolated-pgbench-shards.mjs"), "export const cli = 1;\n");
  writeFileSync(join(dir, "tests/pgbench-isolated-hash-golden.test.mjs"), "export const t = 1;\n");
  git(dir, ["init", "-b", "main"]);
  git(dir, ["-c", "user.email=gate3@test", "-c", "user.name=gate3", "add", "scripts/lib/pgbench_merge.mjs", "scripts/performance/launch-isolated-pgbench-shards.mjs", "tests/pgbench-isolated-hash-golden.test.mjs"]);
  git(dir, ["-c", "user.email=gate3@test", "-c", "user.name=gate3", "commit", "-m", "freeze"]);
  return { dir, sha: git(dir, ["rev-parse", "HEAD"]) };
}

function ownerIdent(owner, shardIndex, extra = {}) {
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
    ...extra,
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

function pins(gitSha) {
  return { git_sha: gitSha, catalog_sha: CAT, workload_revision: WL };
}

function snaps(idents) {
  return idents.map((id) => ({
    active_pgbench_targets: [id.database_target],
    database_target: id.database_target,
    swap_used_bytes: 0,
    cpu_throttled: false,
    shared_storage_active_benchmark: false,
  }));
}

describe("P0-A isolated source revision freeze", () => {
  it("frozen HEAD + clean benchmark source => PASS", () => {
    const repo = makeSourceRepo();
    try {
      const r = assertIsolatedSourceRevision({ expectedGitSha: repo.sha, repoRoot: repo.dir });
      assert.equal(r.ok, true);
      assert.equal(r.head, repo.sha);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("HEAD mismatch => REFUSE ISOLATED_SOURCE_REVISION_MISMATCH", () => {
    const repo = makeSourceRepo();
    try {
      const r = assertIsolatedSourceRevision({
        expectedGitSha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
        repoRoot: repo.dir,
      });
      assert.equal(r.ok, false);
      assert.ok(r.reasons.some((x) => x.startsWith("ISOLATED_SOURCE_REVISION_MISMATCH")));
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("tracked source modification => REFUSE", () => {
    const repo = makeSourceRepo();
    try {
      writeFileSync(join(repo.dir, "scripts/lib/pgbench_merge.mjs"), "export const n = 2;\n");
      const r = assertIsolatedSourceRevision({ expectedGitSha: repo.sha, repoRoot: repo.dir });
      assert.equal(r.ok, false);
      assert.ok(r.reasons.some((x) => x.startsWith("ISOLATED_SOURCE_REVISION_MISMATCH")));
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("untracked benchmark source file => REFUSE", () => {
    const repo = makeSourceRepo();
    try {
      writeFileSync(join(repo.dir, "scripts/lib/pgbench_extra.mjs"), "export const extra = 1;\n");
      const r = assertIsolatedSourceRevision({ expectedGitSha: repo.sha, repoRoot: repo.dir });
      assert.equal(r.ok, false);
      assert.ok(r.reasons.some((x) => x.startsWith("ISOLATED_SOURCE_REVISION_MISMATCH")));
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("report/log-only changes outside source scope are allowed", () => {
    const repo = makeSourceRepo();
    try {
      mkdirSync(join(repo.dir, "reports/performance/pgbench/run-x"), { recursive: true });
      writeFileSync(
        join(repo.dir, "reports/performance/pgbench/run-x/summary.json"),
        JSON.stringify({ pgbench_ceiling_complete: false }),
      );
      const r = assertIsolatedSourceRevision({ expectedGitSha: repo.sha, repoRoot: repo.dir });
      assert.equal(r.ok, true);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});

describe("P0-B performance environment fingerprint", () => {
  it("11 equivalent owners => PASS", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    for (let i = 1; i < owners.length; i++) {
      const eq = assertPerformanceEnvironmentEquivalence(owners[0], owners[i]);
      assert.equal(eq.ok, true, eq.reasons?.join(";"));
    }
    const fullstack = [0, 1, 2, 3].map((i) => fullstackIdent(i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      interference_snaps: snaps([...owners, ...fullstack]),
      pins: pins("abc123"),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["pgbench-isolated-20260813-000000-abc123"],
    });
    assert.equal(r.allowed, true);
  });

  it("one owner different machine type => ENV_EQ_MACHINE_TYPE_MISMATCH", () => {
    const a = ownerIdent("records", 0);
    const b = ownerIdent("shopping", 1, { machine_type: "m7i.xlarge" });
    const eq = assertPerformanceEnvironmentEquivalence(a, b);
    assert.equal(eq.ok, false);
    assert.ok(eq.reasons.includes("ENV_EQ_MACHINE_TYPE_MISMATCH"));
  });

  it("one owner different CPU model => ENV_EQ_CPU_MODEL_MISMATCH", () => {
    const eq = assertPerformanceEnvironmentEquivalence(
      ownerIdent("records", 0),
      ownerIdent("shopping", 1, { cpu_model: "AMD EPYC 9R14" }),
    );
    assert.equal(eq.ok, false);
    assert.ok(eq.reasons.includes("ENV_EQ_CPU_MODEL_MISMATCH"));
  });

  it("one owner different kernel/image => REFUSE", () => {
    const kernel = assertPerformanceEnvironmentEquivalence(
      ownerIdent("records", 0),
      ownerIdent("shopping", 1, { kernel_release: "6.1.0" }),
    );
    assert.equal(kernel.ok, false);
    assert.ok(kernel.reasons.includes("ENV_EQ_KERNEL_MISMATCH"));
    const image = assertPerformanceEnvironmentEquivalence(
      ownerIdent("records", 0),
      ownerIdent("listings", 2, { os_image_id: "ami-other" }),
    );
    assert.equal(image.ok, false);
    assert.ok(image.reasons.includes("ENV_EQ_OS_IMAGE_MISMATCH"));
  });

  it("one owner different pgbench version => ENV_EQ_PGBENCH_VERSION_MISMATCH", () => {
    const eq = assertPerformanceEnvironmentEquivalence(
      ownerIdent("records", 0),
      ownerIdent("shopping", 1, { pgbench_version: "15.0" }),
    );
    assert.equal(eq.ok, false);
    assert.ok(eq.reasons.includes("ENV_EQ_PGBENCH_VERSION_MISMATCH"));
  });

  it("one owner different PG image digest => ENV_EQ_POSTGRES_IMAGE_MISMATCH", () => {
    const eq = assertPerformanceEnvironmentEquivalence(
      ownerIdent("records", 0),
      ownerIdent("shopping", 1, { postgres_image_digest: "sha256:other" }),
    );
    assert.equal(eq.ok, false);
    assert.ok(eq.reasons.includes("ENV_EQ_POSTGRES_IMAGE_MISMATCH"));
  });

  it("one owner different disk IOPS => ENV_EQ_STORAGE_IOPS_MISMATCH", () => {
    const eq = assertPerformanceEnvironmentEquivalence(
      ownerIdent("records", 0),
      ownerIdent("shopping", 1, { storage_iops: 3000 }),
    );
    assert.equal(eq.ok, false);
    assert.ok(eq.reasons.includes("ENV_EQ_STORAGE_IOPS_MISMATCH"));
  });

  it("one owner different disk throughput => ENV_EQ_STORAGE_THROUGHPUT_MISMATCH", () => {
    const eq = assertPerformanceEnvironmentEquivalence(
      ownerIdent("records", 0),
      ownerIdent("shopping", 1, { storage_throughput_mbps: 125 }),
    );
    assert.equal(eq.ok, false);
    assert.ok(eq.reasons.includes("ENV_EQ_STORAGE_THROUGHPUT_MISMATCH"));
  });

  it("4 equivalent fullstack => PASS; owner class != fullstack class => PASS", () => {
    const fs = [0, 1, 2, 3].map((i) => fullstackIdent(i));
    for (let i = 1; i < fs.length; i++) {
      assert.equal(assertPerformanceEnvironmentEquivalence(fs[0], fs[i]).ok, true);
    }
    const cross = assertPerformanceEnvironmentEquivalence(ownerIdent("records", 0), fs[0]);
    assert.equal(cross.ok, false);
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fs,
      interference_snaps: snaps([...owners, ...fs]),
      pins: pins("abc123"),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["pgbench-isolated-20260813-000000-abc123"],
    });
    assert.equal(r.allowed, true, r.reasons.join(";"));
  });

  it("one fullstack member differs => REFUSE", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const fullstack = [0, 1, 2, 3].map((i) =>
      fullstackIdent(i, i === 2 ? { machine_type: "m7i.8xlarge" } : {}),
    );
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      interference_snaps: snaps([...owners, ...fullstack]),
      pins: pins("abc123"),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["pgbench-isolated-20260813-000000-abc123"],
    });
    assert.equal(r.allowed, false);
    assert.match(r.reasons.join(";"), /ENV_EQ_MACHINE_TYPE_MISMATCH/);
  });
});

describe("P0-C/D rendered executable 15-VM dry path", () => {
  it("renderExecutableIsolatedManifest has 15 identities and zero placeholders", () => {
    const repo = makeSourceRepo();
    try {
      const rendered = renderExecutableIsolatedManifest({
        git_sha: repo.sha,
        catalog_sha: CAT,
        now: new Date(Date.UTC(2026, 7, 13, 4, 30, 0)),
      });
      assert.equal(rendered.launch_now, false);
      assert.equal(rendered.pgbench_ceiling_complete, false);
      assert.equal(rendered.tuning, "NO_GO");
      assert.equal(rendered.protocol, "NO_GO");
      assert.equal(rendered.track_c_acceptance_pass, false);
      assert.equal(rendered.platform_pass, false);
      assert.equal(rendered.git_sha, repo.sha);
      assert.notEqual(rendered.isolated_run_id, PLACEHOLDER_ISOLATED_RUN_ID);
      assert.notEqual(rendered.isolated_run_id, COLIMA_SEQUENTIAL_RUN_ID);
      assert.equal(assertIsolatedRunId(rendered.isolated_run_id).ok, true);
      const blob = JSON.stringify(rendered);
      assert.equal(blob.includes(PLACEHOLDER_ISOLATED_RUN_ID), false);
      assert.equal(blob.includes(PLACEHOLDER_CONTENTION_DOMAIN), false);
      assert.equal(rendered.phase_1.vms.length, 11);
      assert.equal(rendered.phase_2.vms.length, 4);
      assert.equal(rendered.owner_identities.length, 11);
      assert.equal(rendered.fullstack_identities.length, 4);
      assert.deepEqual(rendered.phase_2.hash_assignment.expected_cells_by_shard, [...FROZEN_HASH_PARTITION_COUNTS]);
      assert.equal(rendered.phase_2.hash_assignment.cell_id_catalog_sha256, FROZEN_HASH_CELL_ID_CATALOG_SHA256);
      assert.equal(rendered.primary_topology, PRIMARY_TOPOLOGY);
      for (const id of [...rendered.owner_identities, ...rendered.fullstack_identities]) {
        assert.ok(id.machine_type);
        assert.ok(id.cpu_model);
        assert.ok(id.os_image_id);
        assert.ok(id.kernel_release);
        assert.ok(id.pgbench_version);
        assert.ok(id.postgres_image_digest);
        assert.ok(id.storage_iops);
        assert.ok(id.storage_throughput_mbps);
        assert.notEqual(id.contention_domain_id, PLACEHOLDER_CONTENTION_DOMAIN);
      }
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("run-identity.json is immutable after persist", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate3-runid-"));
    try {
      const identity = buildIsolatedRunIdentity({
        isolated_run_id: "pgbench-isolated-20260813-043000-abcd1234",
        git_sha: "abcd1234abcd1234abcd1234abcd1234abcd1234",
        catalog_sha: CAT,
        workload_revision: WL,
        created_at: "2026-08-13T04:30:00.000Z",
      });
      persistIsolatedRunIdentity(dir, identity);
      const frozen = JSON.parse(readFileSync(join(dir, "run-identity.json"), "utf8"));
      assert.equal(frozen.topology, PRIMARY_TOPOLOGY);
      assert.equal(frozen.phase1_shard_count, 11);
      assert.equal(frozen.phase2_shard_count, 4);
      assert.deepEqual(frozen.frozen_hash_counts, [311, 296, 309, 302]);
      assert.equal(frozen.frozen_hash_catalog_sha, FROZEN_HASH_CELL_ID_CATALOG_SHA256);
      const again = persistIsolatedRunIdentity(dir, {
        ...identity,
        git_sha: "ffffffffffffffffffffffffffffffffffffffff",
      });
      assert.equal(again.ok, false);
      const still = JSON.parse(readFileSync(join(dir, "run-identity.json"), "utf8"));
      assert.equal(still.git_sha, identity.git_sha);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("positive dry CLI: source+probe PASS, launched=false, spawn=0, no Colima write", () => {
    const repo = makeSourceRepo();
    const work = mkdtempSync(join(tmpdir(), "gate3-dry-"));
    try {
      const rendered = renderExecutableIsolatedManifest({
        git_sha: repo.sha,
        catalog_sha: CAT,
        now: new Date(Date.UTC(2026, 7, 13, 4, 31, 0)),
      });
      const manifestPath = join(work, "rendered-15-vm.json");
      writeFileSync(manifestPath, JSON.stringify(rendered, null, 2) + "\n");
      const colimaDir = join(work, "colima-sentinel");
      mkdirSync(colimaDir, { recursive: true });
      writeFileSync(join(colimaDir, "untouched.json"), "{\"ok\":true}\n");
      const cli = join(root, "scripts/performance/launch-isolated-pgbench-shards.mjs");
      const r = spawnSync(process.execPath, [cli], {
        encoding: "utf8",
        cwd: root,
        env: {
          ...process.env,
          GATE3_ISOLATED_MANIFEST: manifestPath,
          GATE3_SOURCE_REPO: repo.dir,
          GATE3_RESUME_DIR: resumeDirForIsolatedRunId(rendered.isolated_run_id),
        },
      });
      assert.equal(r.status, 0, r.stderr || r.stdout);
      const json = JSON.parse(r.stdout);
      assert.ok(json.validation === "PASS" || json.launch === "PLANNED");
      assert.equal(json.source_revision_ok, true);
      assert.equal(json.probe_allowed, true);
      assert.equal(json.launched, false);
      assert.equal(json.provision, false);
      assert.equal(json.spawn_pgbench, false);
      assert.equal(json.spawn_count, 0);
      assert.equal(json.vm_api_calls, 0);
      assert.deepEqual(json.hash_counts, [311, 296, 309, 302]);
      assert.equal(json.owner_vm_count, 11);
      assert.equal(json.fullstack_vm_count, 4);
      assert.equal(readFileSync(join(colimaDir, "untouched.json"), "utf8").trim(), "{\"ok\":true}");
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
  });
});
