/**
 * Per-cell source provenance. Checkpoints without these digests are non-reusable.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKLOAD_FILES } from "./pgbench_completeness.mjs";
const SOURCE_IDENTITY_FIELDS = [
  "run_id",
  "git_sha",
  "source_bundle_sha",
  "catalog_sha",
  "workload_revision",
];

/**
 * Resume is source-locked. Legacy checkpoints without digests never upgrade.
 */
export function sourceDigestsMatchFreeze(cell, freeze) {
  if (!cell || !freeze) return false;
  for (const key of SOURCE_IDENTITY_FIELDS) {
    if (cell[key] == null || cell[key] !== freeze[key]) return false;
  }
  for (const key of ["workload_sql_sha256", "seed_sql_sha256", "cleanup_sql_sha256"]) {
    if (cell[key] == null) return false;
    if (freeze[key] != null && cell[key] !== freeze[key]) return false;
  }
  if (cell.environment?.contention_domain_id && freeze.contention_domain_id) {
    if (cell.environment.contention_domain_id !== freeze.contention_domain_id) return false;
  }
  return true;
}

export const SOURCE_CHANGED_DURING_CELL = "SOURCE_CHANGED_DURING_CELL";
export const SOURCE_PROVENANCE_MISMATCH = "SOURCE_PROVENANCE_MISMATCH";

function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function relHash(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { path: rel, sha256: null, missing: true };
  return { path: rel, sha256: sha256File(abs), missing: false };
}

export function workloadSqlRel(owner, workload) {
  return `scripts/performance/pgbench/${owner}/${WORKLOAD_FILES[workload]}`;
}

export const SEED_SQL_REL = "scripts/performance/pgbench/common/seed.sql";
export const CLEANUP_SQL_REL = "scripts/performance/pgbench/common/cleanup.sql";

/**
 * Hash the files that will be passed to pgbench/psql for this cell.
 */
export function captureCellSourceProvenance(opts) {
  const root = opts.root;
  const freeze = opts.freeze || {};
  const owner = opts.owner || opts.cell?.owner;
  const workload = opts.workload || opts.cell?.workload;
  const workloadRel = workloadSqlRel(owner, workload);
  const w = relHash(root, workloadRel);
  const seed = relHash(root, SEED_SQL_REL);
  const cleanup = relHash(root, CLEANUP_SQL_REL);
  const env = opts.environment || {};
  const cell = opts.cell || {};
  return {
    run_id: freeze.run_id,
    git_sha: freeze.git_sha,
    source_bundle_sha: freeze.source_bundle_sha,
    catalog_sha: freeze.catalog_sha,
    workload_revision: freeze.workload_revision,
    workload_sql_path: w.path,
    workload_sql_sha256: w.sha256,
    seed_sql_path: seed.path,
    seed_sql_sha256: seed.sha256,
    cleanup_sql_path: cleanup.path,
    cleanup_sql_sha256: cleanup.sha256,
    environment_fingerprint: env.environment_fingerprint || env.environment_id || null,
    db_instance_id: env.db_instance_id || null,
    contention_domain_id: env.contention_domain_id || freeze.contention_domain_id || null,
    database_target: env.database_target || cell.database_target || null,
    cell_id: cell.cell_id,
    owner: cell.owner || owner,
    mode: cell.mode,
    workload: cell.workload || workload,
    distribution: cell.distribution,
    clients: cell.clients,
    threads: cell.threads,
    batch: cell.batch ?? null,
    repetition: cell.repetition,
    random_seed: cell.random_seed,
    warmup_seconds: cell.warmup_seconds,
    measured_seconds: cell.measured_seconds,
  };
}

function bundleFileSha(freeze, rel) {
  const files = freeze?.files || [];
  const hit = files.find((f) => f.path === rel);
  return hit?.sha256 ?? null;
}

/**
 * Re-hash files before accepting PASS. Source mutation mid-cell is INVALID.
 */
export function evaluateSourceBeforeAccept(opts) {
  const now = captureCellSourceProvenance(opts);
  const start = opts.start;
  const fields = ["workload_sql_sha256", "seed_sql_sha256", "cleanup_sql_sha256"];
  for (const f of fields) {
    if (start?.[f] !== now[f]) {
      return { ok: false, status: "INVALID", reason: SOURCE_CHANGED_DURING_CELL, start, now };
    }
  }
  const freeze = opts.freeze || {};
  if (freeze.files?.length) {
    const pairs = [
      [now.workload_sql_path, now.workload_sql_sha256],
      [now.seed_sql_path, now.seed_sql_sha256],
      [now.cleanup_sql_path, now.cleanup_sql_sha256],
    ];
    for (const [rel, sha] of pairs) {
      const frozen = bundleFileSha(freeze, rel);
      if (frozen && frozen !== sha) {
        return { ok: false, status: "INVALID", reason: SOURCE_PROVENANCE_MISMATCH, start, now };
      }
    }
  }
  return { ok: true, status: "PASS", reason: null, provenance: now };
}

export function classifySourceLockedReuse(cell, freeze, isReusable) {
  if (!cell) return { reusable: false, reason: "MISSING" };
  if (typeof isReusable === "function" && !isReusable(cell)) {
    return { reusable: false, reason: "NOT_REUSABLE" };
  }
  if (!sourceDigestsMatchFreeze(cell, freeze)) {
    return { reusable: false, reason: SOURCE_PROVENANCE_MISMATCH };
  }
  return { reusable: true, reason: null };
}
