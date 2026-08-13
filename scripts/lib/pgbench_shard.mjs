/**
 * Deterministic Gate-3 shard assignment (OWNER_AFFINITY + HASH).
 * Does not weaken the 14616-cell catalog.
 */
import { createHash } from "node:crypto";
import { OWNERS, enumerateExpectedPgbenchCells } from "./pgbench_completeness.mjs";
import { PER_OWNER_OPERATIONAL_ORDER } from "./pgbench_resume.mjs";

export { PER_OWNER_OPERATIONAL_ORDER };

/** Threads <= clients valid combinations for one owner × one workload × one dist × one batch-null. */
export function validThreadClientCombos() {
  const CLIENTS = [8, 16, 32, 64, 128, 256];
  const THREADS = [1, 2, 4, 8, 16];
  let n = 0;
  for (const c of CLIENTS) for (const t of THREADS) if (t <= c) n += 1;
  return n;
}

/**
 * Per-owner PER_OWNER_CEILING cell count:
 * 4 workloads × 2 dists × thread/client combos × (1 or 4 batches) × 3 reps
 * W1/W2/WMIX: batch null → 3 workloads × 2 × combos × 1 × 3
 * W3: 1 × 2 × combos × 4 × 3
 */
export function cellsPerOwner() {
  const combos = validThreadClientCombos();
  const nonW3 = 3 * 2 * combos * 1 * 3;
  const w3 = 1 * 2 * combos * 4 * 3;
  return nonW3 + w3;
}

export function ownerAffinityShardIndex(owner) {
  const idx = PER_OWNER_OPERATIONAL_ORDER.indexOf(owner);
  if (idx < 0) {
    const fallback = OWNERS.indexOf(owner);
    if (fallback < 0) throw new Error(`unknown owner ${owner}`);
    return fallback;
  }
  return idx;
}

/**
 * @param {any} cell
 * @param {{ mode: 'OWNER_AFFINITY'|'HASH', shard_count: number }} opts
 */
export function assignCellShard(cell, opts) {
  const shard_count = Number(opts.shard_count);
  if (!Number.isInteger(shard_count) || shard_count < 1) {
    throw new Error("shard_count must be positive integer");
  }
  if (opts.mode === "OWNER_AFFINITY") {
    if (cell.mode === "ALL_OWNERS_CONCURRENT") {
      // Owner affinity does not apply; use HASH into shard_count full-stack envs
      return hashShard(cell.cell_id, shard_count);
    }
    if (shard_count !== 11) {
      // Still affinity by owner index modulo shard_count for partial deployments
      return ownerAffinityShardIndex(cell.owner) % shard_count;
    }
    return ownerAffinityShardIndex(cell.owner);
  }
  if (opts.mode === "HASH") {
    return hashShard(cell.cell_id, shard_count);
  }
  throw new Error(`unknown shard mode ${opts.mode}`);
}

function hashShard(cellId, shard_count) {
  const buf = createHash("sha256").update(String(cellId)).digest();
  // first 8 bytes as big-endian uint64 modulo shard_count (via BigInt)
  const n =
    (BigInt(buf[0]) << 56n) |
    (BigInt(buf[1]) << 48n) |
    (BigInt(buf[2]) << 40n) |
    (BigInt(buf[3]) << 32n) |
    (BigInt(buf[4]) << 24n) |
    (BigInt(buf[5]) << 16n) |
    (BigInt(buf[6]) << 8n) |
    BigInt(buf[7]);
  return Number(n % BigInt(shard_count));
}

/**
 * @param {any[]} cells
 * @param {{
 *   mode: 'OWNER_AFFINITY'|'HASH',
 *   shard_count: number,
 *   shard_index: number,
 *   phase?: 'PER_OWNER_CEILING'|'ALL_OWNERS_CONCURRENT'|'ALL',
 *   owner?: string,
 * }} opts
 */
export function filterCellsForShard(cells, opts) {
  const phase = opts.phase || "ALL";
  const shard_index = Number(opts.shard_index);
  return cells.filter((cell) => {
    if (phase !== "ALL" && cell.mode !== phase) return false;
    if (opts.owner && cell.owner !== opts.owner) return false;
    if (opts.mode === "OWNER_AFFINITY" && phase === "PER_OWNER_CEILING") {
      return assignCellShard(cell, opts) === shard_index;
    }
    return assignCellShard(cell, opts) === shard_index;
  });
}

/**
 * Theoretical minimum wall-clock floors (no setup/telemetry overhead).
 */
export function estimateRuntimeFloor(opts = {}) {
  const cell_seconds = opts.cell_seconds ?? 150;
  const total = enumerateExpectedPgbenchCells();
  const per_owner_cells = total.filter((c) => c.mode === "PER_OWNER_CEILING").length;
  const all_owners_cells = total.filter((c) => c.mode === "ALL_OWNERS_CONCURRENT").length;
  const owner_envs = Math.max(1, Number(opts.owner_environments ?? 1));
  const all_envs = Math.max(1, Number(opts.all_owner_environments ?? 1));

  const sequential_seconds = total.length * cell_seconds;
  const owner_seq_seconds = per_owner_cells * cell_seconds;
  const all_seq_seconds = all_owners_cells * cell_seconds;
  const owner_parallel_seconds = (per_owner_cells / owner_envs) * cell_seconds;
  const all_parallel_seconds = (all_owners_cells / all_envs) * cell_seconds;

  return {
    total_cells: total.length,
    per_owner_cells,
    all_owners_cells,
    cells_per_owner: cellsPerOwner(),
    cell_seconds,
    sequential_seconds,
    sequential_days: sequential_seconds / 86400,
    per_owner_sequential_days: owner_seq_seconds / 86400,
    owner_phase_hours_with_11: owner_parallel_seconds / 3600,
    all_owners_sequential_hours: all_seq_seconds / 3600,
    all_owners_hours_with_envs: all_parallel_seconds / 3600,
    combined_floor_hours: owner_parallel_seconds / 3600 + all_parallel_seconds / 3600,
    owner_environments: owner_envs,
    all_owner_environments: all_envs,
    note: "theoretical minimums only — excludes setup/telemetry/interference retries",
  };
}

export function recommendedShardAssignment(availableIsolatedOwnerEnvs, availableFullStackEnvs) {
  const floor = estimateRuntimeFloor({
    owner_environments: Math.max(1, availableIsolatedOwnerEnvs),
    all_owner_environments: Math.max(1, availableFullStackEnvs),
  });
  return {
    per_owner_mode:
      availableIsolatedOwnerEnvs >= 11
        ? "OWNER_AFFINITY_11"
        : availableIsolatedOwnerEnvs > 1
          ? "OWNER_AFFINITY_PARTIAL"
          : "SEQUENTIAL_SINGLE_CONTENTION_DOMAIN",
    all_owners_mode:
      availableFullStackEnvs > 1 ? `HASH_${availableFullStackEnvs}` : "SEQUENTIAL_SINGLE_FULLSTACK",
    owners: PER_OWNER_OPERATIONAL_ORDER.map((owner, shard_index) => ({
      owner,
      shard_index,
      shard_id: owner,
      cells: cellsPerOwner(),
    })),
    runtime_floor: floor,
    warning:
      availableIsolatedOwnerEnvs < 11
        ? "Insufficient isolated contention domains for 11-way owner parallel; different ports on shared Colima/host do NOT count"
        : null,
  };
}

export const FROZEN_HASH_PARTITION_COUNTS = Object.freeze([311, 296, 309, 302]);
export const FROZEN_HASH_CELL_ID_CATALOG_SHA256 =
  "9c65197dad369894db6fca4534cb4ca487fab5f6a698488096677a5b16166ff9";

export function concurrentCellIdCatalogSha256() {
  const ids = enumerateExpectedPgbenchCells()
    .filter((c) => c.mode === "ALL_OWNERS_CONCURRENT")
    .map((c) => c.cell_id)
    .sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

export function hashPartitionCounts(shard_count = 4) {
  const counts = Array.from({ length: shard_count }, () => 0);
  for (const cell of enumerateExpectedPgbenchCells().filter((c) => c.mode === "ALL_OWNERS_CONCURRENT")) {
    counts[assignCellShard(cell, { mode: "HASH", shard_count })] += 1;
  }
  return counts;
}
