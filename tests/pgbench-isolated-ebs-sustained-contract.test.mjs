/**
 * Gate-3 EBS sustained-performance contract.
 * Does not provision AWS, spawn pgbench, or mutate the Colima sequential run.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PER_OWNER_OPERATIONAL_ORDER } from "../scripts/lib/pgbench_resume.mjs";
import {
  GATE3_REQUESTED_STANDARD_VCPU,
  assertIsolatedStandardVcpuQuota,
  assertSustainedStorageContract,
  evaluateIsolatedProbeContract,
  isolatedFullstackClassPins,
  isolatedOwnerClassPins,
  markIsolatedRunSuperseded,
  persistIsolatedRunIdentity,
  buildIsolatedRunIdentity,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";

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

function snaps(ids) {
  return ids.map((id) => ({
    active_pgbench_targets: [id.database_target],
    database_target: id.database_target,
    swap_used_bytes: 0,
    cpu_throttled: false,
    shared_storage_active_benchmark: false,
  }));
}

describe("Gate-3 sustained EBS class pins", () => {
  it("keeps m7i.2xlarge owner class at gp3 500/12000/300 sustained", () => {
    const p = isolatedOwnerClassPins();
    assert.equal(p.machine_type, "m7i.2xlarge");
    assert.equal(p.volume_type, "gp3");
    assert.equal(p.storage_size_gb, 500);
    assert.equal(p.storage_iops, 12000);
    assert.equal(p.storage_throughput_mbps, 300);
    assert.equal(p.storage_contract, "SUSTAINED_NOT_BURST");
    assert.equal(p.instance_ebs_baseline_throughput_mbps, 312.5);
    assert.equal(p.instance_ebs_max_throughput_mbps, 1250);
    assert.equal(p.instance_ebs_baseline_iops, 12000);
    assert.equal(p.instance_ebs_max_iops, 40000);
  });

  it("keeps m7i.4xlarge fullstack class at gp3 1000/16000/625 sustained", () => {
    const p = isolatedFullstackClassPins();
    assert.equal(p.machine_type, "m7i.4xlarge");
    assert.equal(p.volume_type, "gp3");
    assert.equal(p.storage_size_gb, 1000);
    assert.equal(p.storage_iops, 16000);
    assert.equal(p.storage_throughput_mbps, 625);
    assert.equal(p.storage_contract, "SUSTAINED_NOT_BURST");
    assert.equal(p.instance_ebs_baseline_throughput_mbps, 625);
    assert.equal(p.instance_ebs_max_throughput_mbps, 1250);
    assert.equal(p.instance_ebs_baseline_iops, 20000);
    assert.equal(p.instance_ebs_max_iops, 40000);
  });

  it("rejects the superseded burst-dependent 1000/2000 throughput pins", () => {
    assert.notEqual(isolatedOwnerClassPins().storage_throughput_mbps, 1000);
    assert.notEqual(isolatedFullstackClassPins().storage_throughput_mbps, 2000);
  });
});

describe("assertSustainedStorageContract", () => {
  it("accepts frozen owner 300 MiB/s and fullstack 625 MiB/s", () => {
    assert.equal(assertSustainedStorageContract(isolatedOwnerClassPins(), "owner").ok, true);
    assert.equal(assertSustainedStorageContract(isolatedFullstackClassPins(), "fullstack").ok, true);
  });

  it("rejects owner throughput above m7i.2xlarge sustained baseline 312.5", () => {
    const r = assertSustainedStorageContract(
      { ...isolatedOwnerClassPins(), storage_throughput_mbps: 313 },
      "owner",
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "SUSTAINED_THROUGHPUT_EXCEEDS_INSTANCE_BASELINE");
  });

  it("rejects old owner 1000 MiB/s as burst-dependent", () => {
    const r = assertSustainedStorageContract(
      { ...isolatedOwnerClassPins(), storage_throughput_mbps: 1000 },
      "owner",
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "SUSTAINED_THROUGHPUT_EXCEEDS_INSTANCE_BASELINE");
  });

  it("rejects fullstack throughput above m7i.4xlarge sustained baseline 625", () => {
    const r = assertSustainedStorageContract(
      { ...isolatedFullstackClassPins(), storage_throughput_mbps: 626 },
      "fullstack",
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "SUSTAINED_THROUGHPUT_EXCEEDS_INSTANCE_BASELINE");
  });

  it("rejects old fullstack 2000 MiB/s as unbounded by instance max", () => {
    const r = assertSustainedStorageContract(
      { ...isolatedFullstackClassPins(), storage_throughput_mbps: 2000 },
      "fullstack",
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "SUSTAINED_THROUGHPUT_EXCEEDS_INSTANCE_BASELINE");
  });
});

describe("probe refuses burst-dependent throughput", () => {
  it("owner VM with 1000 MiB/s is not probe-allowed", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) =>
      i === 0 ? ownerIdent(o, i, { storage_throughput_mbps: 1000 }) : ownerIdent(o, i),
    );
    const fullstack = [0, 1, 2, 3].map((i) => fullstackIdent(i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      interference_snaps: snaps([...owners, ...fullstack]),
      pins: {
        git_sha: "abc123",
        catalog_sha: "cat",
        workload_revision: "gate3-v1-domain-touch",
      },
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["pgbench-isolated-20260813-000000-abc123"],
    });
    assert.equal(r.allowed, false);
    assert.match(r.reasons.join(";"), /SUSTAINED_THROUGHPUT_EXCEEDS_INSTANCE_BASELINE/);
  });
});

describe("AWS standard vCPU quota contract", () => {
  it("requests exactly 152 Standard On-Demand vCPU for 11+4", () => {
    assert.equal(GATE3_REQUESTED_STANDARD_VCPU, 152);
    assert.equal(11 * 8 + 4 * 16, 152);
  });

  it("passes when available covers existing usage plus 152", () => {
    const r = assertIsolatedStandardVcpuQuota({
      available_standard_on_demand_vcpu: 200,
      existing_standard_vcpu_usage: 0,
    });
    assert.equal(r.ok, true);
    assert.equal(r.requested_standard_vcpu, 152);
  });

  it("stops with PROVISIONING_QUOTA_REQUIRED and zero instance creates", () => {
    const r = assertIsolatedStandardVcpuQuota({
      available_standard_on_demand_vcpu: 5,
      existing_standard_vcpu_usage: 0,
    });
    assert.equal(r.ok, false);
    assert.equal(r.stop_code, "PROVISIONING_QUOTA_REQUIRED");
    assert.equal(r.vm_api_calls_creating_instances, 0);
  });
});

describe("supersede pre-provision isolated run without mutating identity", () => {
  it("writes SUPERSEDED_PRE_PROVISION_NO_CELLS_EXECUTED beside immutable run-identity.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate3-supersede-"));
    try {
      const identity = buildIsolatedRunIdentity({
        isolated_run_id: "pgbench-isolated-20260813-043047-8497c4b9",
        git_sha: "8497c4b9e15eddd866685d7ec90a9aee0558bc96",
        catalog_sha: "f8a8ab2c341760e75e4d26d59df0255b5a64769b439842809abcc198e48b3782",
        workload_revision: "gate3-v1-domain-touch",
        created_at: "2026-08-13T04:30:47.025Z",
      });
      persistIsolatedRunIdentity(dir, identity);
      const marked = markIsolatedRunSuperseded(dir, {
        status: "SUPERSEDED_PRE_PROVISION_NO_CELLS_EXECUTED",
        reason: "burst-dependent EBS throughput pins 1000/2000",
        provisioned_vm_count: 0,
        pgbench_spawn_count: 0,
        reusable_cells: 0,
      });
      assert.equal(marked.ok, true);
      const frozen = JSON.parse(readFileSync(join(dir, "run-identity.json"), "utf8"));
      assert.equal(frozen.isolated_run_id, identity.isolated_run_id);
      assert.equal(frozen.git_sha, identity.git_sha);
      assert.equal("status" in frozen, false);
      const side = JSON.parse(readFileSync(join(dir, "run-superseded.json"), "utf8"));
      assert.equal(side.status, "SUPERSEDED_PRE_PROVISION_NO_CELLS_EXECUTED");
      assert.equal(side.provisioned_vm_count, 0);
      assert.equal(side.pgbench_spawn_count, 0);
      assert.equal(side.reusable_cells, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
