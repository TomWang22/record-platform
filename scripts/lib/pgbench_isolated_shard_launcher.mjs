/**
 * Isolated Gate-3 shard launcher contract (prepared, not auto-used).
 * Primary topology: 11 owner VMs + 4 fullstack VMs.
 * Different ports on one Colima VM are NOT isolated contention domains.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enumerateExpectedPgbenchCells } from "./pgbench_completeness.mjs";
import { PER_OWNER_OPERATIONAL_ORDER, WORKLOAD_REVISION } from "./pgbench_resume.mjs";
import {
  FROZEN_HASH_CELL_ID_CATALOG_SHA256,
  FROZEN_HASH_PARTITION_COUNTS,
  filterCellsForShard,
  hashPartitionCounts,
} from "./pgbench_shard.mjs";
import {
  assertIsolationPair,
  assertPerformanceEnvironmentEquivalence,
  detectInterference,
  PERFORMANCE_EQUIVALENCE_FIELDS,
} from "./pgbench_environment.mjs";

export const PRIMARY_TOPOLOGY = "11_OWNER_VMS_PLUS_4_FULLSTACK_VMS";
export const CAPACITY_FALLBACK_TOPOLOGY = "11_OWNER_VMS_PLUS_1_FULLSTACK_VM";
export const COLIMA_SEQUENTIAL_RUN_ID = "pgbench-contract-20260812-011924-ef21a35e";
export const PLACEHOLDER_ISOLATED_RUN_ID = "NEW_RUN_ID_REQUIRED";
export const PLACEHOLDER_CONTENTION_DOMAIN = "DECLARED_AT_PROVISION";
export const CELL_SECONDS_FLOOR = 150;
export const OWNER_CELLS = 1218;
export const CONCURRENT_CELLS = 1218;
export const GLOBAL_MERGE_EQUALITY = Object.freeze([
  "git_sha",
  "catalog_sha",
  "workload_revision",
  "isolated_run_id",
]);
export const PER_CLASS_EQUIVALENCE_FIELDS = PERFORMANCE_EQUIVALENCE_FIELDS;
export const PER_PAIR_W1_W2_EQUALITY = Object.freeze([
  "environment_fingerprint",
  "equivalence_class",
  "contention_domain_id",
  "database_target",
  "owner",
  "random_seed",
  "repetition",
]);
export const ISOLATION_MUST_DIFFER_ACROSS_VMS = Object.freeze([
  "contention_domain_id",
  "db_instance_id",
  "hostname",
  "postgres_data_directory_identity",
]);

export function isolatedOwnerClassPins() {
  return {
    cloud_provider: "aws",
    region: "us-east-1",
    availability_zone: "us-east-1a",
    machine_type: "m7i.2xlarge",
    cpu_count: 8,
    cpu_model: "Intel Xeon Platinum 8488C",
    cpu_set: "0-7",
    memory_limit: "32Gi",
    os_image_id: "ami-owner-class-20260813",
    kernel_release: "6.8.0-31-generic",
    node_version: "22.13.0",
    pgbench_version: "16.4",
    postgres_client_version: "16.4",
    postgres_version: "16.4",
    postgres_image_digest: "sha256:owner-pg-16.4-pinned",
    postgres_config_hash: "cfg-owner-class",
    storage_device_identity: "equiv-class:dedicated-ssd-owner",
    storage_size_gb: 500,
    storage_iops: 12000,
    storage_throughput_mbps: 1000,
    filesystem_type: "ext4",
    postgres_data_mount_options_hash: "mount-owner-class",
    container_runtime: "dedicated-vm",
    container_limits: { vcpu: 8, ram_gb: 32 },
  };
}

export function isolatedFullstackClassPins() {
  return {
    cloud_provider: "aws",
    region: "us-east-1",
    availability_zone: "us-east-1a",
    machine_type: "m7i.4xlarge",
    cpu_count: 16,
    cpu_model: "Intel Xeon Platinum 8488C",
    cpu_set: "0-15",
    memory_limit: "64Gi",
    os_image_id: "ami-fullstack-class-20260813",
    kernel_release: "6.8.0-31-generic",
    node_version: "22.13.0",
    pgbench_version: "16.4",
    postgres_client_version: "16.4",
    postgres_version: "16.4",
    postgres_image_digest: "sha256:fullstack-pg-16.4-pinned",
    postgres_config_hash: "cfg-fullstack-class",
    storage_device_identity: "equiv-class:dedicated-ssd-fullstack",
    storage_size_gb: 1000,
    storage_iops: 16000,
    storage_throughput_mbps: 2000,
    filesystem_type: "ext4",
    postgres_data_mount_options_hash: "mount-fullstack-class",
    container_runtime: "dedicated-vm",
    container_limits: { vcpu: 16, ram_gb: 64 },
  };
}

/** Exact VM probe contract. Launch is refused unless every predicate is true. */
export const ISOLATED_PROBE_CONTRACT = Object.freeze({
  isolated_contention_domain_count_min: 2,
  phase_1_owner_vms: 11,
  phase_2_preferred_fullstack_vms: 4,
  phase_2_fallback_fullstack_vms: 1,
  fallback_must_be_declared_before_phase_2: true,
  pins_required: Object.freeze(["git_sha", "catalog_sha", "workload_revision"]),
  owner_class_equivalence: PERFORMANCE_EQUIVALENCE_FIELDS,
  fullstack_class_equivalence: "same keys as owner class; owner class MAY differ from fullstack class",
  isolation_pair: Object.freeze(["db_instance_id", "contention_domain_id"]),
  unique_per_vm: Object.freeze([
    "hostname",
    "contention_domain_id",
    "db_instance_id",
    "postgres_data_directory_identity",
  ]),
  interference: Object.freeze([
    "one pgbench process per database_target",
    "cpu_throttled=false",
    "swap_used_bytes=0",
    "shared_storage_active_benchmark=false",
  ]),
  isolated_flag: true,
  cpu_set_forbidden: "host-shared",
  colima_checkpoints_reusable: false,
  mix_phase2_1_and_4_forbidden: true,
  cell_split_across_vms: false,
});

/**
 * @param {{ isolated_contention_domain_count?: number }} opts
 */
export function prepareIsolatedShardLaunch(opts = {}) {
  const isolated = Number(opts.isolated_contention_domain_count || 0);
  if (isolated < 2) {
    return {
      allowed: false,
      mode: "SEQUENTIAL_SINGLE_CONTENTION_DOMAIN",
      reason:
        "A single Colima/host contention domain cannot be parallelized; distinct VMs/hosts required",
    };
  }
  if (isolated < 11) {
    return {
      allowed: false,
      mode: "OWNER_AFFINITY_PARTIAL_INSUFFICIENT",
      isolated_contention_domain_count: isolated,
      reason: "Phase 1 requires 11 isolated owner contention domains; partial owner parallel is not the frozen topology",
    };
  }
  return {
    allowed: false,
    mode: "PROBE_CONTRACT_REQUIRED",
    isolated_contention_domain_count: isolated,
    note: "Count≥11 is necessary but not sufficient; call evaluateIsolatedProbeContract",
  };
}

function pinMissing(pins) {
  const reasons = [];
  if (!pins?.git_sha) reasons.push("git_sha unpinned");
  if (!pins?.catalog_sha) reasons.push("catalog_sha unpinned");
  if (!pins?.workload_revision) reasons.push("workload_revision unpinned");
  return reasons;
}

function classEquivalence(identities, label) {
  const reasons = [];
  for (let i = 0; i < identities.length; i++) {
    for (let j = i + 1; j < identities.length; j++) {
      const eq = assertPerformanceEnvironmentEquivalence(identities[i], identities[j]);
      if (!eq.ok) {
        reasons.push(`${label} equivalence ${i},${j}: ${eq.reasons.join(",")}`);
      }
    }
  }
  return reasons;
}

function allPairsIsolated(identities) {
  const reasons = [];
  for (let i = 0; i < identities.length; i++) {
    for (let j = i + 1; j < identities.length; j++) {
      const iso = assertIsolationPair(identities[i], identities[j]);
      if (!iso.ok) reasons.push(`isolation ${i},${j}: ${iso.reason}`);
    }
  }
  return reasons;
}

function uniquePerVm(identities) {
  const reasons = [];
  for (const field of ISOLATED_PROBE_CONTRACT.unique_per_vm) {
    const seen = new Set();
    for (const id of identities) {
      const v = id?.[field];
      if (!v) reasons.push(`missing ${field}`);
      else if (seen.has(v)) reasons.push(`duplicate ${field}`);
      else seen.add(v);
    }
  }
  for (const id of identities) {
    if (id?.isolated !== true) reasons.push("identity.isolated must be true");
    if (id?.cpu_set === "host-shared") reasons.push("cpu_set host-shared");
  }
  return reasons;
}

/**
 * Exact VM equivalence/interference probe contract for isolated ceiling launch.
 * Does not start VMs or mutate the Colima sequential run.
 *
 * @param {{
 *   owner_identities?: any[],
 *   fullstack_identities?: any[],
 *   interference_snaps?: any[],
 *   pins?: { git_sha?: string, catalog_sha?: string, workload_revision?: string },
 *   phase2_shard_count?: number,
 *   phase2_declared_before_execution?: boolean,
 *   merge_run_ids?: string[],
 *   phase2_classes_seen?: number[],
 * }} input
 */
export function evaluateIsolatedProbeContract(input = {}) {
  /** @type {string[]} */
  const reasons = [];
  reasons.push(...pinMissing(input.pins));

  const owners = input.owner_identities || [];
  const fullstack = input.fullstack_identities || [];
  if (owners.length !== 11) reasons.push(`owner_vms=${owners.length} (require 11)`);

  const fsCount = Number(input.phase2_shard_count);
  let topology = null;
  if (fsCount === 4) {
    topology = PRIMARY_TOPOLOGY;
  } else if (fsCount === 1 && input.phase2_declared_before_execution === true) {
    topology = CAPACITY_FALLBACK_TOPOLOGY;
  } else {
    reasons.push("phase2 shard count must be 4, or 1 declared before Phase 2 execution");
  }
  if (topology && fullstack.length !== fsCount) {
    reasons.push(`fullstack_vms=${fullstack.length} (require ${fsCount})`);
  }

  const classes = input.phase2_classes_seen || [fsCount];
  const uniqueClasses = [...new Set(classes.filter((n) => n != null))];
  if (uniqueClasses.length > 1) {
    reasons.push("cannot mix Phase-2 1-shard and 4-shard equivalence classes");
  }

  const mergeIds = input.merge_run_ids || [];
  if (mergeIds.includes(COLIMA_SEQUENTIAL_RUN_ID)) {
    reasons.push("colima sequential checkpoints forbidden in isolated cross-run merge");
  }

  const allIdentities = [...owners, ...fullstack];
  reasons.push(...classEquivalence(owners, "owner"));
  reasons.push(...classEquivalence(fullstack, "fullstack"));
  reasons.push(...allPairsIsolated(allIdentities));
  reasons.push(...uniquePerVm(allIdentities));

  for (const snap of input.interference_snaps || []) {
    const hit = detectInterference(snap);
    if (!hit.ok) reasons.push(`interference: ${hit.reason}`);
  }

  for (const id of fullstack) {
    const loc = assertFullstackDatabaseLocality(id);
    if (!loc.ok) reasons.push(loc.reason);
  }

  return {
    allowed: reasons.length === 0,
    topology: reasons.length === 0 ? topology : null,
    reasons,
    pgbench_ceiling_complete: false,
    launch_now: false,
  };
}

/**
 * Phase-2 databases must be local to that fullstack contention domain.
 * Accepted proof: database_host_identity === hostname, or local_database=true
 * with a db_instance_id bound to the same contention domain.
 *
 * @param {any} identity
 */
export function assertFullstackDatabaseLocality(identity) {
  if (!identity || typeof identity !== "object") {
    return { ok: false, reason: "FULLSTACK_DATABASE_NOT_LOCAL" };
  }
  const hostname = identity.hostname;
  const hostId = identity.database_host_identity;
  const localFlag = identity.local_database === true && Boolean(identity.db_instance_id);
  const hostMatch = Boolean(hostId) && Boolean(hostname) && hostId === hostname;
  if (!localFlag && !hostMatch) {
    return { ok: false, reason: "FULLSTACK_DATABASE_NOT_LOCAL" };
  }
  if (
    identity.database_contention_domain_id &&
    identity.database_contention_domain_id !== identity.contention_domain_id
  ) {
    return { ok: false, reason: "FULLSTACK_DATABASE_NOT_LOCAL" };
  }
  const domainIdx = /fullstack-(\d+)/.exec(String(identity.contention_domain_id || ""));
  const dbIdx = /fullstack-(\d+)/.exec(String(identity.db_instance_id || ""));
  if (domainIdx && dbIdx && domainIdx[1] !== dbIdx[1]) {
    return { ok: false, reason: "FULLSTACK_DATABASE_NOT_LOCAL" };
  }
  return { ok: true, reason: null };
}

function ownerVm(owner, shard_index) {
  return {
    vm_id: `owner-${owner}`,
    role: "PER_OWNER_CEILING",
    owner,
    shard_index,
    shard_count: 11,
    shard_mode: "OWNER_AFFINITY",
    environment_id: `isolated-${owner}`,
    contention_domain_id: "DECLARED_AT_PROVISION",
    vcpu: "DEDICATED_PINNED",
    ram: "DEDICATED",
    storage: "DEDICATED_VOLUME",
    storage_device_identity_equivalence_class: "equiv-class:dedicated-ssd-owner",
    postgres: { owners: [owner], instance_count: 1 },
    launch_env: {
      GATE3_CONTRACT: "1",
      GATE3_SHARD_MODE: "OWNER_AFFINITY",
      GATE3_SHARD_COUNT: "11",
      GATE3_SHARD_INDEX: String(shard_index),
      GATE3_SHARD_ID: owner,
      GATE3_OWNER: owner,
      GATE3_ENVIRONMENT_ID: `isolated-${owner}`,
      GATE3_PHASE: "PER_OWNER_CEILING",
      GATE3_RESUME_DIR: "NEW_RUN_ID_REQUIRED",
    },
  };
}

function fullstackVm(index, count) {
  return {
    vm_id: `fullstack-${index}`,
    role: "ALL_OWNERS_CONCURRENT",
    owner: "ALL",
    shard_index: index,
    shard_count: count,
    shard_mode: "HASH",
    environment_id: `isolated-fullstack-${index}-of-${count}`,
    contention_domain_id: "DECLARED_AT_PROVISION",
    vcpu: "DEDICATED_PINNED",
    ram: "DEDICATED",
    storage: "DEDICATED_VOLUME",
    storage_device_identity_equivalence_class: "equiv-class:dedicated-ssd-fullstack",
    postgres: { owners: [...PER_OWNER_OPERATIONAL_ORDER], instance_count: 11 },
    cell_split_across_vms: false,
    launch_env: {
      GATE3_CONTRACT: "1",
      GATE3_SHARD_MODE: "HASH",
      GATE3_SHARD_COUNT: String(count),
      GATE3_SHARD_INDEX: String(index),
      GATE3_SHARD_ID: `fullstack-${index}`,
      GATE3_ENVIRONMENT_ID: `isolated-fullstack-${index}-of-${count}`,
      GATE3_PHASE: "ALL_OWNERS_CONCURRENT",
      GATE3_RESUME_DIR: "NEW_RUN_ID_REQUIRED",
    },
  };
}

/**
 * Cloud-agnostic 15-VM (or 12-VM fallback) launch manifest. Does not provision.
 * @param {{ phase2_shard_count?: number }} opts
 */
export function buildIsolatedLaunchManifest(opts = {}) {
  const phase2 = Number(opts.phase2_shard_count ?? 4);
  const ownerHours = (OWNER_CELLS * CELL_SECONDS_FLOOR) / 3600;
  const phase2IdealEqualSplitHours = (CONCURRENT_CELLS * CELL_SECONDS_FLOOR) / phase2 / 3600;
  const phase2FrozenHashHours = Number(((311 * CELL_SECONDS_FLOOR) / 3600).toFixed(4));
  const primaryIdealHours = Number((ownerHours + phase2IdealEqualSplitHours).toFixed(4));
  const primaryCatalogHashHours = Number((ownerHours + phase2FrozenHashHours).toFixed(4));
  const expectedByShard = hashPartitionCounts(phase2);
  return {
    schema: "record-platform-gate3-isolated-launch-manifest/v1",
    cloud: "AGNOSTIC",
    vm_count: 11 + phase2,
    primary_topology: PRIMARY_TOPOLOGY,
    capacity_fallback: CAPACITY_FALLBACK_TOPOLOGY,
    existing_colima_run_id: COLIMA_SEQUENTIAL_RUN_ID,
    isolated_run_id: "NEW_RUN_ID_REQUIRED",
    colima_checkpoints_reusable: false,
    launch_now: false,
    tuning: "NO_GO",
    protocol: "NO_GO",
    track_c_acceptance_pass: false,
    platform_pass: false,
    pgbench_ceiling_complete: false,
    probe_contract: ISOLATED_PROBE_CONTRACT,
    global_merge_equality: GLOBAL_MERGE_EQUALITY,
    per_class_equivalence_fields: PER_CLASS_EQUIVALENCE_FIELDS,
    per_pair_w1_w2_equality: PER_PAIR_W1_W2_EQUALITY,
    isolation_must_differ_across_vms: ISOLATION_MUST_DIFFER_ACROSS_VMS,
    phase_1: {
      mode: "PER_OWNER_CEILING",
      shard_strategy: "OWNER_AFFINITY",
      shard_count: 11,
      owners_per_shard: 1,
      expected_cells_per_owner: OWNER_CELLS,
      vms: PER_OWNER_OPERATIONAL_ORDER.map((owner, shard_index) => ownerVm(owner, shard_index)),
    },
    phase_2: {
      mode: "ALL_OWNERS_CONCURRENT",
      shard_strategy: "HASH",
      preferred_shard_count: 4,
      declared_shard_count: phase2,
      hash_assignment: {
        algorithm:
          "assignCellShard mode=HASH — exact existing implementation (scripts/lib/pgbench_shard.mjs)",
        source: "scripts/lib/pgbench_shard.mjs assignCellShard mode=HASH",
        cell_id_catalog_sha256: FROZEN_HASH_CELL_ID_CATALOG_SHA256,
        expected_cells_by_shard: expectedByShard,
        expected_cells_sum: expectedByShard.reduce((a, b) => a + b, 0),
        cell_split_across_vms: false,
      },
      vms: Array.from({ length: phase2 }, (_, index) => ({
        ...fullstackVm(index, phase2),
        expected_cells: expectedByShard[index],
      })),
    },
    floors: {
      cell_seconds: CELL_SECONDS_FLOOR,
      phase_1_hours: ownerHours,
      phase_2_ideal_equal_split_hours: phase2IdealEqualSplitHours,
      phase_2_frozen_hash_hours: phase2FrozenHashHours,
      primary_ideal_hours: primaryIdealHours,
      primary_catalog_hash_hours: primaryCatalogHashHours,
      primary_hours: primaryIdealHours,
      fallback_hours: ownerHours + ownerHours,
      note: "theoretical 150s/cell only; excludes provision, probes, retries, artifacts, merge; primary floor is 63.4375h ≈ 2.64 days, not 2.3",
    },
    forbidden: [
      "merge Colima sequential checkpoints into isolated ceiling",
      "mix Phase-2 1-shard and 4-shard results",
      "migrate an in-progress cell between contention domains",
      "split one ALL_OWNERS_CONCURRENT cell across VMs",
      "parallelize inside a shared Colima contention domain",
      "count duplicated cells from replacement shards",
    ],
  };
}

function executableOwnerIdentity(owner, shardIndex) {
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

function executableFullstackIdentity(index) {
  const hostname = `vm-fullstack-${index}`;
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
  };
}

/**
 * Fully rendered 11+4 manifest. Does not provision or spawn pgbench.
 * @param {{ git_sha: string, catalog_sha: string, now?: Date, workload_revision?: string }} opts
 */
export function renderExecutableIsolatedManifest(opts) {
  const git_sha = opts.git_sha;
  const catalog_sha = opts.catalog_sha;
  const workload_revision = opts.workload_revision || WORKLOAD_REVISION;
  const isolated_run_id = mintIsolatedRunId({ git_sha, now: opts.now });
  const resume = resumeDirForIsolatedRunId(isolated_run_id);
  const draft = buildIsolatedLaunchManifest({ phase2_shard_count: 4 });
  const owners = PER_OWNER_OPERATIONAL_ORDER.map((o, i) => executableOwnerIdentity(o, i));
  const fullstack = [0, 1, 2, 3].map((i) => executableFullstackIdentity(i));
  draft.git_sha = git_sha;
  draft.isolated_run_id = isolated_run_id;
  draft.pins = { git_sha, catalog_sha, workload_revision };
  draft.owner_identities = owners;
  draft.fullstack_identities = fullstack;
  draft.interference_snaps = [...owners, ...fullstack].map((id) => ({
    active_pgbench_targets: [id.database_target],
    database_target: id.database_target,
    swap_used_bytes: 0,
    cpu_throttled: false,
    shared_storage_active_benchmark: false,
  }));
  for (const vm of draft.phase_1.vms) {
    const ident = owners.find((o) => o.shard_id === vm.owner);
    vm.contention_domain_id = ident.contention_domain_id;
    vm.hostname = ident.hostname;
    vm.db_instance_id = ident.db_instance_id;
    vm.machine_type = ident.machine_type;
    vm.local_database = true;
    vm.launch_env.GATE3_RESUME_DIR = resume;
  }
  for (const vm of draft.phase_2.vms) {
    const ident = fullstack.find((f) => f.shard_id === vm.vm_id);
    vm.contention_domain_id = ident.contention_domain_id;
    vm.hostname = ident.hostname;
    vm.db_instance_id = ident.db_instance_id;
    vm.machine_type = ident.machine_type;
    vm.local_database = true;
    vm.database_host_identity = ident.hostname;
    vm.launch_env.GATE3_RESUME_DIR = resume;
  }
  return draft;
}

/**
 * @param {{
 *   isolated_run_id: string,
 *   git_sha: string,
 *   catalog_sha: string,
 *   workload_revision?: string,
 *   created_at?: string,
 * }} opts
 */
export function buildIsolatedRunIdentity(opts) {
  return {
    schema: "record-platform-gate3-isolated-run-identity/v1",
    isolated_run_id: opts.isolated_run_id,
    git_sha: opts.git_sha,
    catalog_sha: opts.catalog_sha,
    workload_revision: opts.workload_revision || WORKLOAD_REVISION,
    topology: PRIMARY_TOPOLOGY,
    phase1_shard_count: 11,
    phase2_shard_count: 4,
    frozen_hash_catalog_sha: FROZEN_HASH_CELL_ID_CATALOG_SHA256,
    frozen_hash_counts: [...FROZEN_HASH_PARTITION_COUNTS],
    created_at: opts.created_at || new Date().toISOString(),
    launch_now: false,
    pgbench_ceiling_complete: false,
    tuning: "NO_GO",
    protocol: "NO_GO",
    track_c_acceptance_pass: false,
    platform_pass: false,
  };
}

const RUN_IDENTITY_IMMUTABLE = [
  "isolated_run_id",
  "git_sha",
  "catalog_sha",
  "workload_revision",
  "phase2_shard_count",
];

/**
 * Persist run-identity.json. Refuses mutation of frozen fields.
 * @param {string} reportDir
 * @param {Record<string, unknown>} identity
 */
export function persistIsolatedRunIdentity(reportDir, identity) {
  mkdirSync(reportDir, { recursive: true });
  const path = join(reportDir, "run-identity.json");
  if (existsSync(path)) {
    const frozen = JSON.parse(readFileSync(path, "utf8"));
    for (const field of RUN_IDENTITY_IMMUTABLE) {
      if (frozen[field] !== identity[field]) {
        return { ok: false, reasons: [`${field} immutable after run-identity.json checkpoint`] };
      }
    }
    return { ok: true, identity: frozen, already_present: true };
  }
  writeFileSync(path, JSON.stringify(identity, null, 2) + "\n");
  return { ok: true, identity, already_present: false };
}

/**
 * @param {{ git_sha?: string, now?: Date }} opts
 */
export function mintIsolatedRunId({ git_sha, now = new Date() }) {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const short = String(git_sha || "").slice(0, 8);
  return `pgbench-isolated-${y}${mo}${d}-${h}${mi}${s}-${short}`;
}

/**
 * @param {string | null | undefined} runId
 */
export function assertIsolatedRunId(runId) {
  const reasons = [];
  if (!runId) reasons.push("empty isolated_run_id");
  if (runId === PLACEHOLDER_ISOLATED_RUN_ID) reasons.push("unresolved NEW_RUN_ID_REQUIRED");
  if (runId === COLIMA_SEQUENTIAL_RUN_ID) reasons.push("colima sequential run id forbidden");
  return { ok: reasons.length === 0, reasons, exit_code: reasons.length ? 2 : 0 };
}

/**
 * @param {string | null | undefined} frozen isolated_run_id from run-identity.json
 * @param {string | null | undefined} observed proposed isolated_run_id
 */
export function assertRunIdentityImmutable(frozen, observed) {
  if (!frozen) return { ok: true, reasons: [] };
  if (frozen !== observed) {
    return {
      ok: false,
      reasons: ["isolated_run_id immutable after run-identity.json checkpoint"],
      exit_code: 2,
    };
  }
  return { ok: true, reasons: [] };
}

/**
 * @param {string} runId
 */
export function resumeDirForIsolatedRunId(runId) {
  const check = assertIsolatedRunId(runId);
  if (!check.ok) {
    const err = new Error(check.reasons.join("; "));
    err.exit_code = 2;
    throw err;
  }
  return `reports/performance/pgbench/${runId}`;
}

/**
 * @param {{ declared?: number, frozen?: number | null, phase2_checkpoint_exists?: boolean }} opts
 */
export function assertPhase2ShardCountFrozen({ declared, frozen, phase2_checkpoint_exists }) {
  const n = Number(declared);
  if (n !== 4 && n !== 1) return { ok: false, reasons: ["phase2_shard_count must be 4 or 1"] };
  if (phase2_checkpoint_exists && frozen != null && Number(frozen) !== n) {
    return { ok: false, reasons: ["PHASE2_SHARD_COUNT immutable after first Phase-2 checkpoint"] };
  }
  return { ok: true, reasons: [] };
}

function refusePlan(reasons, extra = {}) {
  return {
    ok: false,
    reasons,
    exit_code: 2,
    spawn_pgbench: false,
    ...extra,
  };
}

function collectDomainReasons(keys, contention_domains) {
  /** @type {string[]} */
  const reasons = [];
  for (const key of keys) {
    const domain = contention_domains[key];
    if (!domain) reasons.push(`missing contention domain for ${key}`);
    else if (domain === PLACEHOLDER_CONTENTION_DOMAIN) {
      reasons.push(`unresolved DECLARED_AT_PROVISION for ${key}`);
    }
  }
  return reasons;
}

/**
 * @param {{
 *   isolated_run_id: string,
 *   phase2_shard_count?: number,
 *   contention_domains?: Record<string, string>,
 *   phase2_frozen_shard_count?: number | null,
 *   phase2_checkpoint_exists?: boolean,
 * }} opts
 * @param {string} resumeDir
 */
function buildPhase2HashPlan(opts, resumeDir) {
  const shardCount = Number(opts.phase2_shard_count);
  const freeze = assertPhase2ShardCountFrozen({
    declared: shardCount,
    frozen: opts.phase2_frozen_shard_count,
    phase2_checkpoint_exists: opts.phase2_checkpoint_exists,
  });
  if (!freeze.ok) {
    return refusePlan(freeze.reasons);
  }

  if (shardCount === 1 && opts.phase2_declared_before_execution !== true) {
    return refusePlan([
      "phase2 shard count must be 4, or 1 declared before Phase 2 execution",
    ]);
  }

  const contention_domains = opts.contention_domains || {};
  const vmKeys = Array.from({ length: shardCount }, (_, i) => `fullstack-${i}`);
  const reasons = collectDomainReasons(vmKeys, contention_domains);
  if (reasons.length > 0) {
    return refusePlan(reasons);
  }

  const concurrent = enumerateExpectedPgbenchCells().filter(
    (c) => c.mode === "ALL_OWNERS_CONCURRENT",
  );
  const expectedByShard = hashPartitionCounts(shardCount);
  const shards = vmKeys.map((vmKey, shard_index) => {
    const cells = filterCellsForShard(concurrent, {
      mode: "HASH",
      shard_count: shardCount,
      shard_index,
      phase: "ALL_OWNERS_CONCURRENT",
    });
    return {
      shard_index,
      expected_cells: expectedByShard[shard_index],
      cell_ids: cells.map((c) => c.cell_id),
      cell_split_across_vms: false,
      contention_domain_id: contention_domains[vmKey],
      launch_env: {
        GATE3_CONTRACT: "1",
        GATE3_SHARD_MODE: "HASH",
        GATE3_SHARD_COUNT: String(shardCount),
        GATE3_SHARD_INDEX: String(shard_index),
        GATE3_SHARD_ID: vmKey,
        GATE3_ENVIRONMENT_ID: `isolated-fullstack-${shard_index}-of-${shardCount}`,
        GATE3_PHASE: "ALL_OWNERS_CONCURRENT",
        GATE3_RESUME_DIR: resumeDir,
      },
    };
  });

  return {
    ok: true,
    phase: "ALL_OWNERS_CONCURRENT",
    shards,
    expected_cells_by_shard: expectedByShard,
    cell_split_across_vms: false,
    spawn_pgbench: false,
  };
}

/**
 * Build an isolated launch plan without spawning pgbench or child processes.
 * Phase 1 OWNER_AFFINITY and Phase 2 HASH×4 or HASH×1 (fallback only when
 * declared before execution and freeze allows).
 *
 * @param {{
 *   isolated_run_id?: string,
 *   phase?: string,
 *   phase2_shard_count?: number,
 *   contention_domains?: Record<string, string>,
 *   phase2_declared_before_execution?: boolean,
 *   phase2_checkpoint_exists?: boolean,
 *   phase2_frozen_shard_count?: number | null,
 * }} opts
 */
export function buildIsolatedLaunchPlan(opts = {}) {
  const { isolated_run_id, phase, contention_domains = {} } = opts;

  const idCheck = assertIsolatedRunId(isolated_run_id);
  if (!idCheck.ok) {
    return {
      ok: false,
      reasons: idCheck.reasons,
      exit_code: idCheck.exit_code,
      spawn_pgbench: false,
    };
  }

  let resumeDir;
  try {
    resumeDir = resumeDirForIsolatedRunId(isolated_run_id);
  } catch (err) {
    const e = /** @type {Error & { exit_code?: number }} */ (err);
    return {
      ok: false,
      reasons: [e.message],
      exit_code: e.exit_code ?? 2,
      spawn_pgbench: false,
    };
  }

  if (phase === "ALL_OWNERS_CONCURRENT") {
    return buildPhase2HashPlan({ ...opts, isolated_run_id }, resumeDir);
  }

  if (phase !== "PER_OWNER_CEILING") {
    return {
      ok: false,
      reason: "PHASE_PLAN_NOT_IMPLEMENTED",
      phase,
      spawn_pgbench: false,
    };
  }

  const reasons = collectDomainReasons(PER_OWNER_OPERATIONAL_ORDER, contention_domains);
  if (reasons.length > 0) {
    return refusePlan(reasons);
  }

  const shards = PER_OWNER_OPERATIONAL_ORDER.map((owner, shard_index) => ({
    owner,
    shard_index,
    contention_domain_id: contention_domains[owner],
    launch_env: {
      GATE3_CONTRACT: "1",
      GATE3_SHARD_MODE: "OWNER_AFFINITY",
      GATE3_SHARD_COUNT: "11",
      GATE3_SHARD_INDEX: String(shard_index),
      GATE3_SHARD_ID: owner,
      GATE3_OWNER: owner,
      GATE3_ENVIRONMENT_ID: `isolated-${owner}`,
      GATE3_PHASE: "PER_OWNER_CEILING",
      GATE3_RESUME_DIR: resumeDir,
    },
  }));

  return {
    ok: true,
    phase: "PER_OWNER_CEILING",
    shards,
    spawn_pgbench: false,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} manifest
 */
export function assertManifestLaunchable(manifest) {
  const reasons = [];
  const idCheck = assertIsolatedRunId(manifest?.isolated_run_id);
  if (!idCheck.ok) reasons.push(...idCheck.reasons);
  const vms = [...(manifest?.phase_1?.vms || []), ...(manifest?.phase_2?.vms || [])];
  for (const vm of vms) {
    if (vm.contention_domain_id === PLACEHOLDER_CONTENTION_DOMAIN) {
      reasons.push("unresolved DECLARED_AT_PROVISION");
    }
    if (vm.launch_env?.GATE3_RESUME_DIR === PLACEHOLDER_ISOLATED_RUN_ID) {
      reasons.push("GATE3_RESUME_DIR is NEW_RUN_ID_REQUIRED");
    }
  }
  return { ok: reasons.length === 0, reasons, exit_code: reasons.length ? 2 : 0 };
}

/**
 * Provisioning-path validation used by the isolated launcher CLI.
 * Never provisions, never spawns pgbench.
 *
 * @param {any} manifest
 */
export function validateIsolatedLaunchManifest(manifest) {
  const reasons = [];
  const launchable = assertManifestLaunchable(manifest);
  if (!launchable.ok) reasons.push(...launchable.reasons);
  const idCheck = assertIsolatedRunId(manifest?.isolated_run_id);
  if (!idCheck.ok) reasons.push(...idCheck.reasons);

  const ownerVms = manifest?.phase_1?.vms || [];
  const fsVms = manifest?.phase_2?.vms || [];
  const phase2 = Number(manifest?.phase_2?.declared_shard_count ?? 4);
  const hash = manifest?.phase_2?.hash_assignment?.expected_cells_by_shard || null;

  if (ownerVms.length !== 11) reasons.push(`owner_vms=${ownerVms.length} (require 11)`);
  if (phase2 === 4 && fsVms.length !== 4) {
    reasons.push(`fullstack_vms=${fsVms.length} (require 4)`);
  }
  if (phase2 === 4 && hash) {
    const got = [...hash];
    if (JSON.stringify(got) !== JSON.stringify([...FROZEN_HASH_PARTITION_COUNTS])) {
      reasons.push(`hash counts must be [${FROZEN_HASH_PARTITION_COUNTS.join(",")}]`);
    }
  }

  const owners = manifest?.owner_identities;
  const fullstack = manifest?.fullstack_identities;
  let probe_allowed = false;
  if (Array.isArray(owners) && Array.isArray(fullstack)) {
    const probe = evaluateIsolatedProbeContract({
      owner_identities: owners,
      fullstack_identities: fullstack,
      interference_snaps: manifest?.interference_snaps || [],
      pins: manifest?.pins,
      phase2_shard_count: phase2,
      phase2_declared_before_execution: true,
      merge_run_ids: [manifest?.isolated_run_id].filter(Boolean),
    });
    if (!probe.allowed) reasons.push(...probe.reasons);
    probe_allowed = probe.allowed;
  } else if (reasons.length === 0) {
    reasons.push("owner_identities and fullstack_identities required");
  }

  const ok = reasons.length === 0;
  return {
    ok,
    reasons,
    validation: ok ? "PASS" : "REFUSED",
    launch: ok ? "PLANNED" : "REFUSED",
    launched: false,
    provision: false,
    spawn_pgbench: false,
    spawn_count: 0,
    owner_vm_count: ownerVms.length,
    fullstack_vm_count: fsVms.length,
    hash_counts: hash ? [...hash] : null,
    phase2_shard_count: phase2,
    probe_allowed: ok && probe_allowed,
    isolated_run_id: manifest?.isolated_run_id ?? null,
    git_sha: manifest?.git_sha ?? manifest?.pins?.git_sha ?? null,
    vm_api_calls: 0,
    pgbench_ceiling_complete: false,
    tuning: "NO_GO",
    protocol: "NO_GO",
    track_c_acceptance_pass: false,
    platform_pass: false,
  };
}
