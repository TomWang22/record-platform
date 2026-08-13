/**
 * Frozen 11+4 isolated topology: launch refuse contract (not auto-executed).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PER_OWNER_OPERATIONAL_ORDER } from "../scripts/lib/pgbench_resume.mjs";
import { assertEnvironmentEquivalence } from "../scripts/lib/pgbench_environment.mjs";
import {
  CAPACITY_FALLBACK_TOPOLOGY,
  COLIMA_SEQUENTIAL_RUN_ID,
  ISOLATED_PROBE_CONTRACT,
  PRIMARY_TOPOLOGY,
  buildIsolatedLaunchManifest,
  evaluateIsolatedProbeContract,
  isolatedFullstackClassPins,
  isolatedOwnerClassPins,
  prepareIsolatedShardLaunch,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";

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

function fullstackIdent(index, count) {
  return {
    ...isolatedFullstackClassPins(),
    shard_id: `fullstack-${index}`,
    environment_id: `isolated-fullstack-${index}-of-${count}`,
    hostname: `vm-fullstack-${index}`,
    host_fingerprint: `fp-fs-${index}`,
    db_instance_id: `pg-fullstack-${index}`,
    database_target: `10.1.${index}.10:5432/ALL`,
    postgres_data_directory_identity: `vol-fs-${index}:/pgdata`,
    contention_domain_id: `domain-fullstack-${index}`,
    isolated: true,
    local_database: true,
    database_host_identity: `vm-fullstack-${index}`,
  };
}

function cleanSnap(target) {
  return {
    active_pgbench_targets: [target],
    database_target: target,
    swap_used_bytes: 0,
    cpu_throttled: false,
    shared_storage_active_benchmark: false,
  };
}

function pins() {
  return {
    git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
    catalog_sha: "f8a8ab2c341760e75e4d26d59df0255b5a64769b439842809abcc198e48b3782",
    workload_revision: "gate3-v1-domain-touch",
  };
}

describe("isolated topology launch refuse contract", () => {
  it("I1 refuses a single Colima contention domain", () => {
    const r = prepareIsolatedShardLaunch({ isolated_contention_domain_count: 1 });
    assert.equal(r.allowed, false);
    assert.equal(r.mode, "SEQUENTIAL_SINGLE_CONTENTION_DOMAIN");
  });

  it("I2 refuses partial owner parallel", () => {
    const r = prepareIsolatedShardLaunch({ isolated_contention_domain_count: 2 });
    assert.equal(r.allowed, false);
    assert.equal(r.mode, "OWNER_AFFINITY_PARTIAL_INSUFFICIENT");
  });

  it("I3 count 11 without probes is not a launch", () => {
    const r = prepareIsolatedShardLaunch({ isolated_contention_domain_count: 11 });
    assert.equal(r.allowed, false);
    assert.equal(r.mode, "PROBE_CONTRACT_REQUIRED");
  });

  it("I3 count 15 without probes is not a launch", () => {
    const r = prepareIsolatedShardLaunch({ isolated_contention_domain_count: 15 });
    assert.equal(r.allowed, false);
    assert.equal(r.mode, "PROBE_CONTRACT_REQUIRED");
  });

  it("I4 allows primary 11 owner + 4 fullstack when probes pass", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const fullstack = [0, 1, 2, 3].map((i) => fullstackIdent(i, 4));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      interference_snaps: [
        ...owners.map((o) => cleanSnap(o.database_target)),
        ...fullstack.map((f) => cleanSnap(f.database_target)),
      ],
      pins: pins(),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, true);
    assert.equal(r.topology, PRIMARY_TOPOLOGY);
    assert.equal(r.launch_now, false);
  });

  it("I5 allows 11+1 fallback only when declared before Phase 2", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const ok = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [fullstackIdent(0, 1)],
      interference_snaps: [
        ...owners.map((o) => cleanSnap(o.database_target)),
        cleanSnap("10.1.0.10:5432/ALL"),
      ],
      pins: pins(),
      phase2_shard_count: 1,
      phase2_declared_before_execution: true,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(ok.allowed, true);
    assert.equal(ok.topology, CAPACITY_FALLBACK_TOPOLOGY);
  });

  it("I6 refuses 11+1 fallback declared late", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const late = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [fullstackIdent(0, 1)],
      interference_snaps: [
        ...owners.map((o) => cleanSnap(o.database_target)),
        cleanSnap("10.1.0.10:5432/ALL"),
      ],
      pins: pins(),
      phase2_shard_count: 1,
      phase2_declared_before_execution: false,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(late.allowed, false);
  });

  it("I7 refuses mixing Phase-2 4-shard and 1-shard classes", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: [
        ...owners.map((o) => cleanSnap(o.database_target)),
        ...[0, 1, 2, 3].map((i) => cleanSnap(`10.1.${i}.10:5432/ALL`)),
      ],
      pins: pins(),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["isolated-new-run"],
      phase2_classes_seen: [4, 1],
    });
    assert.equal(r.allowed, false);
    assert.match(r.reasons.join(";"), /mix/i);
  });

  it("I8 refuses unpinned git", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: owners.map((o) => cleanSnap(o.database_target)),
      pins: { git_sha: "", catalog_sha: "x", workload_revision: "x" },
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, false);
  });

  it("I9 refuses unpinned catalog", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: owners.map((o) => cleanSnap(o.database_target)),
      pins: { git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79", catalog_sha: "", workload_revision: "x" },
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, false);
  });

  it("I10 refuses unpinned workload", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: owners.map((o) => cleanSnap(o.database_target)),
      pins: {
        git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
        catalog_sha: "f8a8ab2c341760e75e4d26d59df0255b5a64769b439842809abcc198e48b3782",
        workload_revision: "",
      },
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, false);
  });

  it("refuses Colima sequential checkpoints in an isolated merge", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: [
        ...owners.map((o) => cleanSnap(o.database_target)),
        ...[0, 1, 2, 3].map((i) => cleanSnap(`10.1.${i}.10:5432/ALL`)),
      ],
      pins: pins(),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: [COLIMA_SEQUENTIAL_RUN_ID],
    });
    assert.equal(r.allowed, false);
    assert.match(r.reasons.join(";"), /colima|cross-run/i);
  });

  it("I11 refuses interference duplicate pgbench on same database_target", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const noisy = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: [
        {
          active_pgbench_targets: ["10.0.0.10:5432/records", "10.0.0.10:5432/records"],
          database_target: "10.0.0.10:5432/records",
          swap_used_bytes: 0,
          cpu_throttled: false,
          shared_storage_active_benchmark: false,
        },
      ],
      pins: pins(),
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(noisy.allowed, false);
  });

  it("I12/I13/I14 interference snaps fail closed", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const fullstack = [0, 1, 2, 3].map((i) => fullstackIdent(i, 4));
    const base = {
      owner_identities: owners,
      fullstack_identities: fullstack,
      pins: pins(),
      phase2_shard_count: 4,
      merge_run_ids: ["isolated-new-run"],
    };
    assert.equal(
      evaluateIsolatedProbeContract({
        ...base,
        interference_snaps: [{ ...cleanSnap(owners[0].database_target), swap_used_bytes: 1 }],
      }).allowed,
      false,
    );
    assert.equal(
      evaluateIsolatedProbeContract({
        ...base,
        interference_snaps: [{ ...cleanSnap(owners[0].database_target), cpu_throttled: true }],
      }).allowed,
      false,
    );
    assert.equal(
      evaluateIsolatedProbeContract({
        ...base,
        interference_snaps: [
          { ...cleanSnap(owners[0].database_target), shared_storage_active_benchmark: true },
        ],
      }).allowed,
      false,
    );
  });

  it("I15 refuses cpu_set host-shared", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    owners[0] = { ...owners[0], cpu_set: "host-shared" };
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: owners.map((o) => cleanSnap(o.database_target)),
      pins: pins(),
      phase2_shard_count: 4,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, false);
  });

  it("I16 refuses isolated=false", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    owners[0] = { ...owners[0], isolated: false };
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: owners.map((o) => cleanSnap(o.database_target)),
      pins: pins(),
      phase2_shard_count: 4,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, false);
  });

  it("I17 owner-class equivalence includes performance fingerprint fields", () => {
    const expectedKeys = [
      "cloud_provider",
      "region",
      "availability_zone",
      "machine_type",
      "cpu_count",
      "cpu_model",
      "cpu_set",
      "memory_limit",
      "os_image_id",
      "kernel_release",
      "node_version",
      "pgbench_version",
      "postgres_client_version",
      "postgres_version",
      "postgres_image_digest",
      "postgres_config_hash",
      "storage_device_identity",
      "storage_size_gb",
      "storage_iops",
      "storage_throughput_mbps",
      "filesystem_type",
      "postgres_data_mount_options_hash",
      "container_runtime",
      "container_limits",
    ];
    assert.deepEqual([...ISOLATED_PROBE_CONTRACT.owner_class_equivalence], expectedKeys);
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const mismatched = { ...owners[0], cpu_count: 4 };
    const eq = assertEnvironmentEquivalence(owners[0], mismatched);
    assert.equal(eq.ok, false);
    const r = evaluateIsolatedProbeContract({
      owner_identities: [mismatched, ...owners.slice(1)],
      fullstack_identities: [0, 1, 2, 3].map((i) => fullstackIdent(i, 4)),
      interference_snaps: owners.map((o) => cleanSnap(o.database_target)),
      pins: pins(),
      phase2_shard_count: 4,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, false);
    assert.match(r.reasons.join(";"), /owner equivalence/i);
  });

  it("I18 passing probes never launch", () => {
    const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => ownerIdent(o, i));
    const fullstack = [0, 1, 2, 3].map((i) => fullstackIdent(i, 4));
    const r = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      interference_snaps: [
        ...owners.map((o) => cleanSnap(o.database_target)),
        ...fullstack.map((f) => cleanSnap(f.database_target)),
      ],
      pins: pins(),
      phase2_shard_count: 4,
      merge_run_ids: ["isolated-new-run"],
    });
    assert.equal(r.allowed, true);
    assert.equal(r.launch_now, false);
    assert.equal(r.pgbench_ceiling_complete, false);
  });
});

describe("cloud-agnostic 15-VM launch manifest", () => {
  it("assigns 11 owner-affinity VMs and 4 HASH fullstack VMs", () => {
    const m = buildIsolatedLaunchManifest({ phase2_shard_count: 4 });
    assert.equal(m.primary_topology, PRIMARY_TOPOLOGY);
    assert.equal(m.existing_colima_run_id, COLIMA_SEQUENTIAL_RUN_ID);
    assert.equal(m.isolated_run_id, "NEW_RUN_ID_REQUIRED");
    assert.equal(m.phase_1.vms.length, 11);
    assert.equal(m.phase_2.vms.length, 4);
    assert.equal(m.phase_1.vms[0].owner, PER_OWNER_OPERATIONAL_ORDER[0]);
    assert.equal(m.phase_1.vms[0].shard_index, 0);
    assert.equal(m.phase_1.vms[0].shard_mode, "OWNER_AFFINITY");
    assert.equal(m.phase_2.vms[0].shard_mode, "HASH");
    assert.equal(m.phase_2.preferred_shard_count, 4);
    assert.equal(m.floors.primary_hours, 63.4375);
    assert.equal(m.colima_checkpoints_reusable, false);
    assert.equal(m.launch_now, false);
    assert.equal(m.vm_count, 15);
    assert.equal(m.phase_2.hash_assignment.expected_cells_sum, 1218);
    assert.equal(
      m.phase_2.hash_assignment.expected_cells_by_shard.reduce((a, b) => a + b, 0),
      1218,
    );
    assert.equal(m.phase_2.vms.every((v) => v.cell_split_across_vms === false), true);
  });

  it("V1–V7 primary 15-VM manifest contract", () => {
    const m = buildIsolatedLaunchManifest({ phase2_shard_count: 4 });
    assert.equal(m.vm_count, 15);
    assert.equal(m.phase_1.vms.length, 11);
    assert.equal(m.phase_2.vms.length, 4);
    assert.deepEqual(m.phase_2.hash_assignment.expected_cells_by_shard, [311, 296, 309, 302]);
    assert.equal(m.floors.primary_ideal_hours, 63.4375);
    assert.equal(m.floors.phase_2_frozen_hash_hours, 12.9583);
    assert.equal(m.floors.primary_catalog_hash_hours, 63.7083);
    assert.equal(String(m.phase_2.hash_assignment.algorithm).includes("sha256(cell_id)[0:8]"), false);
    assert.match(String(m.phase_2.hash_assignment.algorithm), /assignCellShard/);
    assert.equal(m.launch_now, false);
    assert.equal(m.tuning, "NO_GO");
    assert.equal(m.protocol, "NO_GO");
    assert.equal(m.track_c_acceptance_pass, false);
    assert.equal(m.platform_pass, false);
    assert.equal(m.pgbench_ceiling_complete, false);
  });

  it("V8 fallback 12-VM manifest is not mixed with 4", () => {
    const m = buildIsolatedLaunchManifest({ phase2_shard_count: 1 });
    assert.equal(m.vm_count, 12);
    assert.equal(m.phase_2.declared_shard_count, 1);
    assert.deepEqual(m.phase_2.hash_assignment.expected_cells_by_shard, [1218]);
  });
});
