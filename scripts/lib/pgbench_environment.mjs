/**
 * Gate-3 environment identity, isolation, equivalence, interference.
 * Different ports on a shared host are NOT independent ceiling environments.
 */
import { createHash } from "node:crypto";
import { hostname as osHostname, cpus, totalmem } from "node:os";
import { spawnSync } from "node:child_process";

/**
 * @param {Record<string, unknown>} fields
 */
export function buildEnvironmentIdentity(fields) {
  const required = [
    "shard_id",
    "environment_id",
    "hostname",
    "host_fingerprint",
    "db_instance_id",
    "database_target",
    "postgres_version",
    "postgres_config_hash",
    "container_runtime",
    "container_limits",
    "cpu_model",
    "cpu_count",
    "cpu_set",
    "memory_limit",
    "storage_device_identity",
    "filesystem",
    "kernel",
    "postgres_data_directory_identity",
    "contention_domain_id",
  ];
  for (const k of required) {
    if (fields[k] == null || fields[k] === "") {
      throw new Error(`environment identity missing ${k}`);
    }
  }
  return { ...fields };
}

/**
 * Concurrent PER_OWNER_CEILING shards must not share db_instance_id or contention_domain_id.
 */
export function assertIsolationPair(a, b) {
  if (!a || !b) return { ok: false, reason: "MISSING_ENVIRONMENT" };
  if (a.db_instance_id === b.db_instance_id) {
    return { ok: false, reason: "SHARED_DB_INSTANCE_ID" };
  }
  if (a.contention_domain_id === b.contention_domain_id) {
    return { ok: false, reason: "SHARED_CONTENTION_DOMAIN" };
  }
  return { ok: true };
}

/**
 * Equivalence for comparison-class merge.
 */
export const PERFORMANCE_EQUIVALENCE_FIELDS = Object.freeze([
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
]);

const PERFORMANCE_EQ_REASON = Object.freeze({
  machine_type: "ENV_EQ_MACHINE_TYPE_MISMATCH",
  cpu_model: "ENV_EQ_CPU_MODEL_MISMATCH",
  os_image_id: "ENV_EQ_OS_IMAGE_MISMATCH",
  kernel_release: "ENV_EQ_KERNEL_MISMATCH",
  pgbench_version: "ENV_EQ_PGBENCH_VERSION_MISMATCH",
  postgres_image_digest: "ENV_EQ_POSTGRES_IMAGE_MISMATCH",
  storage_size_gb: "ENV_EQ_STORAGE_SIZE_MISMATCH",
  storage_iops: "ENV_EQ_STORAGE_IOPS_MISMATCH",
  storage_throughput_mbps: "ENV_EQ_STORAGE_THROUGHPUT_MISMATCH",
  filesystem_type: "ENV_EQ_FILESYSTEM_MISMATCH",
});

function isIdentityPlaceholder(value) {
  return (
    value == null ||
    value === "" ||
    value === "NEW_RUN_ID_REQUIRED" ||
    value === "DECLARED_AT_PROVISION"
  );
}

function performanceEqReason(field) {
  return PERFORMANCE_EQ_REASON[field] || `ENV_EQ_${String(field).toUpperCase()}_MISMATCH`;
}

/**
 * Within-class performance fingerprint for isolated ceiling VMs.
 * Does not rewrite historical Colima sequential identity.
 *
 * @param {any} a
 * @param {any} b
 */
export function assertPerformanceEnvironmentEquivalence(a, b) {
  /** @type {string[]} */
  const reasons = [];
  /** @type {{ field: string, a: unknown, b: unknown }[]} */
  const deviations = [];
  if (!a || !b) {
    return { ok: false, reasons: ["ENV_EQ_MISSING_IDENTITY"], deviations };
  }
  for (const field of PERFORMANCE_EQUIVALENCE_FIELDS) {
    const va = a[field];
    const vb = b[field];
    if (isIdentityPlaceholder(va) || isIdentityPlaceholder(vb)) {
      reasons.push(performanceEqReason(field));
      deviations.push({ field, a: va, b: vb });
      continue;
    }
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      reasons.push(performanceEqReason(field));
      deviations.push({ field, a: va, b: vb });
    }
  }
  if (a.time_sync_ok === false || b.time_sync_ok === false) {
    reasons.push("TIME_SYNC_NOT_OK");
  }
  return { ok: reasons.length === 0, reasons, deviations };
}

export function assertEnvironmentEquivalence(a, b) {
  const keys = [
    "postgres_version",
    "postgres_config_hash",
    "cpu_count",
    "memory_limit",
    "storage_device_identity",
    "container_runtime",
  ];
  const deviations = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      deviations.push({ field: k, a: a[k], b: b[k] });
    }
  }
  // container_limits deep compare
  if (JSON.stringify(a.container_limits) !== JSON.stringify(b.container_limits)) {
    deviations.push({
      field: "container_limits",
      a: a.container_limits,
      b: b.container_limits,
    });
  }
  if (deviations.length) {
    return {
      ok: false,
      status: "INVALID_ENVIRONMENT_MISMATCH",
      deviations,
    };
  }
  return { ok: true, deviations: [] };
}

/**
 * @param {{
 *   active_pgbench_targets: string[],
 *   database_target: string,
 *   swap_used_bytes?: number,
 *   cpu_throttled?: boolean,
 *   shared_storage_active_benchmark?: boolean,
 * }} snap
 */
export function detectInterference(snap) {
  const targets = snap.active_pgbench_targets || [];
  const hits = targets.filter((t) => t === snap.database_target);
  if (hits.length > 1) {
    return {
      ok: false,
      status: "INVALID_ENVIRONMENT_INTERFERENCE",
      reason: "multiple pgbench processes on same database_target",
    };
  }
  if (snap.cpu_throttled) {
    return {
      ok: false,
      status: "INVALID_ENVIRONMENT_INTERFERENCE",
      reason: "cpu_throttled",
    };
  }
  if ((snap.swap_used_bytes || 0) > 0) {
    return {
      ok: false,
      status: "INVALID_ENVIRONMENT_INTERFERENCE",
      reason: "swap_pressure",
    };
  }
  if (snap.shared_storage_active_benchmark) {
    return {
      ok: false,
      status: "INVALID_ENVIRONMENT_INTERFERENCE",
      reason: "shared_storage_benchmark",
    };
  }
  return { ok: true, status: null };
}

export function hostFingerprint() {
  const payload = [
    osHostname(),
    cpus()[0]?.model || "unknown",
    String(cpus().length),
    String(totalmem()),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Probe local Colima/docker shared-host reality.
 * Different compose Postgres ports on one Colima VM ⇒ one contention domain.
 */
export function discoverLocalPgEnvironments() {
  const host = osHostname();
  const fp = hostFingerprint();
  const contention_domain_id = `colima-or-host:${fp}`;
  const r = spawnSync("docker", ["ps", "--format", "{{.Names}}\t{{.ID}}\t{{.Ports}}"], {
    encoding: "utf8",
  });
  /** @type {any[]} */
  const instances = [];
  if (r.status === 0) {
    for (const line of String(r.stdout).split("\n")) {
      if (!/postgres/i.test(line)) continue;
      const [name, id, ports] = line.split("\t");
      instances.push({
        name,
        db_instance_id: id || name,
        ports: ports || "",
        contention_domain_id,
        hostname: host,
        host_fingerprint: fp,
        isolated: false,
        note: "docker postgres on shared host/Colima — not an independent ceiling environment",
      });
    }
  }
  return {
    contention_domain_id,
    hostname: host,
    host_fingerprint: fp,
    postgres_instance_count: instances.length,
    isolated_contention_domain_count: instances.length > 0 ? 1 : 0,
    instances,
    warning:
      instances.length > 1
        ? "Multiple Postgres containers detected but they share one contention domain; parallel PER_OWNER_CEILING shards are FORBIDDEN here"
        : null,
  };
}

/**
 * Build identity for the current process targeting one OWNER_DB entry.
 */
export function captureEnvironmentForOwner(opts) {
  const discovery = discoverLocalPgEnvironments();
  const cpu = cpus()[0];
  return buildEnvironmentIdentity({
    shard_id: opts.shard_id,
    environment_id: opts.environment_id || `${discovery.contention_domain_id}:${opts.owner}`,
    hostname: discovery.hostname,
    host_fingerprint: discovery.host_fingerprint,
    db_instance_id: opts.db_instance_id || `local:${opts.database_target}`,
    database_target: opts.database_target,
    postgres_version: opts.postgres_version || "unknown",
    postgres_config_hash: opts.postgres_config_hash,
    container_runtime: "docker/colima-shared",
    container_limits: opts.container_limits || { note: "not_enforced_per_container_for_ceiling" },
    cpu_model: cpu?.model || "unknown",
    cpu_count: cpus().length,
    cpu_set: opts.cpu_set || "host-shared",
    memory_limit: opts.memory_limit || `host:${totalmem()}`,
    storage_device_identity: opts.storage_device_identity || discovery.contention_domain_id,
    filesystem: opts.filesystem || "host",
    kernel: process.platform,
    postgres_data_directory_identity: opts.postgres_data_directory_identity || opts.database_target,
    contention_domain_id: discovery.contention_domain_id,
    isolated: false,
  });
}
