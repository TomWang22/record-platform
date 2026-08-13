/**
 * Resumable Gate-3 full-contract cell catalog.
 * Scout measurements (warmup≠30 or measured≠120) must never promote to PASS reuse.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  enumerateExpectedPgbenchCells,
  OWNERS,
} from "./pgbench_completeness.mjs";

export const CONTRACT_WARMUP_SECONDS = 30;
export const CONTRACT_MEASURED_SECONDS = 120;
export const WORKLOAD_REVISION = "gate3-v1-domain-touch";

/** Operational order only — does not change required coverage. */
export const PER_OWNER_OPERATIONAL_ORDER = [
  "records",
  "shopping",
  "listings",
  "trust",
  "media",
  "messaging",
  "notification",
  "analytics",
  "auction_monitor",
  "ai",
  "auth",
];

export function cellKeyFields() {
  return [
    "owner",
    "mode",
    "workload",
    "distribution",
    "clients",
    "threads",
    "batch",
    "repetition",
    "random_seed",
    "workload_revision",
    "database_target",
    "postgres_config_hash",
    "warmup_seconds",
    "measured_seconds",
  ];
}

export function databaseTargetFor(owner, ownerDb) {
  if (owner === "ALL") return "ALL_OWNERS_SHARED";
  const db = ownerDb?.[owner];
  if (!db) return `unknown/${owner}`;
  return `127.0.0.1:${db.port}/${db.database}`;
}

/**
 * Deterministic seed for a catalog cell (stable across resumes for same run_id).
 */
export function deterministicSeed(runId, cellId) {
  const h = createHash("sha256").update(`${runId}|${cellId}`).digest("hex").slice(0, 8);
  return Number.parseInt(h, 16) % 2147483647;
}

/**
 * @param {{
 *   workload_revision?: string,
 *   postgres_config_hash: string,
 *   database_targets: Record<string, string>,
 *   run_id?: string,
 * }} opts
 */
export function buildExpectedCellCatalog(opts) {
  const workload_revision = opts.workload_revision || WORKLOAD_REVISION;
  const warmup_seconds = CONTRACT_WARMUP_SECONDS;
  const measured_seconds = CONTRACT_MEASURED_SECONDS;
  const base = enumerateExpectedPgbenchCells();
  const runId = opts.run_id || "catalog";

  const orderIndex = new Map(PER_OWNER_OPERATIONAL_ORDER.map((o, i) => [o, i]));
  const workloadOrder = new Map(
    ["W1_DOMAIN_ONLY", "W2_DOMAIN_PLUS_OUTBOX", "W3_PUBLISHER_DB_PATH", "WMIX_OWNER_RANDOMIZED"].map(
      (w, i) => [w, i],
    ),
  );
  const perOwner = base
    .filter((c) => c.mode === "PER_OWNER_CEILING")
    .sort((a, b) => {
      const oa = orderIndex.get(a.owner) ?? 999;
      const ob = orderIndex.get(b.owner) ?? 999;
      if (oa !== ob) return oa - ob;
      const wa = workloadOrder.get(a.workload) ?? 999;
      const wb = workloadOrder.get(b.workload) ?? 999;
      if (wa !== wb) return wa - wb;
      if (a.distribution !== b.distribution) {
        return String(a.distribution).localeCompare(String(b.distribution));
      }
      if (a.clients !== b.clients) return a.clients - b.clients;
      if (a.threads !== b.threads) return a.threads - b.threads;
      const ba = a.batch ?? -1;
      const bb = b.batch ?? -1;
      if (ba !== bb) return ba - bb;
      return a.repetition - b.repetition;
    });
  const concurrent = base
    .filter((c) => c.mode === "ALL_OWNERS_CONCURRENT")
    .sort((a, b) => {
      const wa = workloadOrder.get(a.workload) ?? 999;
      const wb = workloadOrder.get(b.workload) ?? 999;
      if (wa !== wb) return wa - wb;
      if (a.distribution !== b.distribution) {
        return String(a.distribution).localeCompare(String(b.distribution));
      }
      if (a.clients !== b.clients) return a.clients - b.clients;
      if (a.threads !== b.threads) return a.threads - b.threads;
      const ba = a.batch ?? -1;
      const bb = b.batch ?? -1;
      if (ba !== bb) return ba - bb;
      return a.repetition - b.repetition;
    });

  const cells = [...perOwner, ...concurrent].map((c) => {
    const database_target =
      opts.database_targets[c.owner] || opts.database_targets.ALL || `db/${c.owner}`;
    // W1/W2 share a pair seed so cell-matched OUTBOX_DB_TAX equivalence can pass.
    const seedKey =
      c.workload === "W1_DOMAIN_ONLY" || c.workload === "W2_DOMAIN_PLUS_OUTBOX"
        ? [
            c.mode,
            c.owner,
            c.distribution,
            `c${c.clients}`,
            `t${c.threads}`,
            `r${c.repetition}`,
            "W1W2_PAIR",
          ].join("|")
        : c.cell_id;
    const random_seed = deterministicSeed(runId, seedKey);
    return {
      ...c,
      batch: c.batch ?? null,
      random_seed,
      workload_revision,
      database_target,
      postgres_config_hash: opts.postgres_config_hash,
      warmup_seconds,
      measured_seconds,
    };
  });

  return {
    schema: "record-platform-pgbench-expected-cells/v1",
    workload_revision,
    warmup_seconds,
    measured_seconds,
    postgres_config_hash: opts.postgres_config_hash,
    owners: OWNERS,
    cell_count: cells.length,
    cells,
  };
}

function hasRequiredKeyFields(cell) {
  for (const f of cellKeyFields()) {
    if (f === "batch") {
      if (!("batch" in cell)) return false;
      continue;
    }
    if (cell[f] == null || cell[f] === "") return false;
  }
  return true;
}

export function rejectScoutPromotion(cell) {
  const warm = Number(cell?.warmup_seconds);
  const meas = Number(cell?.measured_seconds);
  if (warm !== CONTRACT_WARMUP_SECONDS || meas !== CONTRACT_MEASURED_SECONDS) {
    return {
      ok: false,
      reason: `scout/non-contract durations rejected (warmup=${warm} measured=${meas}; require ${CONTRACT_WARMUP_SECONDS}/${CONTRACT_MEASURED_SECONDS})`,
    };
  }
  return { ok: true };
}

/**
 * A result may be reused only if it is a full-contract PASS with complete key fields.
 */
export function isReusableContractCell(cell) {
  if (!cell || cell.status !== "PASS") return false;
  const scout = rejectScoutPromotion(cell);
  if (!scout.ok) return false;
  if (!hasRequiredKeyFields(cell)) return false;
  if (cell.tps == null && cell.avg_latency_ms == null) return false;
  // Environment identity required — legacy checkpoints without it must be re-run.
  const env = cell.environment;
  if (
    !env ||
    !env.environment_id ||
    !env.db_instance_id ||
    !env.contention_domain_id ||
    !env.postgres_config_hash
  ) {
    return false;
  }
  return true;
}

export function classifyCheckpointReuse(cell) {
  if (!cell) return { reusable: false, reason: "MISSING" };
  if (cell.status !== "PASS") return { reusable: false, reason: cell.status };
  const scout = rejectScoutPromotion(cell);
  if (!scout.ok) return { reusable: false, reason: "SCOUT_PROMOTION_FORBIDDEN" };
  if (!hasRequiredKeyFields(cell)) return { reusable: false, reason: "INCOMPLETE_KEY" };
  if (
    !cell.environment ||
    !cell.environment.environment_id ||
    !cell.environment.db_instance_id ||
    !cell.environment.contention_domain_id
  ) {
    return { reusable: false, reason: "LEGACY_CHECKPOINT_INSUFFICIENT" };
  }
  if (isReusableContractCell(cell)) return { reusable: true, reason: null };
  return { reusable: false, reason: "NOT_REUSABLE" };
}

export function cellFilename(cellId) {
  return `${String(cellId).replace(/\|/g, "__")}.json`;
}

/**
 * @param {string} reportDir
 * @returns {Map<string, any>}
 */
export function loadCheckpointIndex(reportDir) {
  const dir = join(reportDir, "cells");
  /** @type {Map<string, any>} */
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const row = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (row?.cell_id) map.set(row.cell_id, row);
    } catch {
      // skip corrupt checkpoint
    }
  }
  return map;
}

/**
 * Persist one immutable cell result for resume.
 * @param {string} reportDir
 * @param {any} result
 */
export function writeCellCheckpoint(reportDir, result) {
  const dir = join(reportDir, "cells");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, cellFilename(result.cell_id));
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  return path;
}

/**
 * @param {{ cells: any[] }} catalog
 * @param {Map<string, any>} checkpointIndex
 */
export function nextMissingCells(catalog, checkpointIndex) {
  /** @type {any[]} */
  const pending = [];
  for (const expected of catalog.cells) {
    const got = checkpointIndex.get(expected.cell_id);
    if (got && isReusableContractCell(got) && keysMatch(expected, got)) {
      continue;
    }
    pending.push(expected);
  }
  return pending;
}

function keysMatch(expected, got) {
  for (const f of cellKeyFields()) {
    if (f === "random_seed") {
      // allow checkpoint seed to define the key once written; expected must equal got
      if (Number(expected.random_seed) !== Number(got.random_seed)) return false;
      continue;
    }
    if (f === "batch") {
      const eb = expected.batch ?? null;
      const gb = got.batch ?? null;
      if (eb !== gb) return false;
      continue;
    }
    if (String(expected[f]) !== String(got[f])) return false;
  }
  return true;
}

/**
 * Full-contract completeness: every expected cell must be PASS under contract durations.
 * ENVIRONMENT_CAPACITY blocks keep ceiling incomplete.
 * @param {Array<any>} results
 * @param {{ expected_cell_count?: number }} [opts]
 */
export function evaluateContractCompleteness(results, opts = {}) {
  const expected = enumerateExpectedPgbenchCells();
  const byId = new Map(results.map((r) => [r.cell_id, r]));
  const missing = [];
  const blocked = [];
  const invalid = [];
  const passed = [];

  for (const cell of expected) {
    const got = byId.get(cell.cell_id);
    if (!got) {
      missing.push(cell.cell_id);
      continue;
    }
    if (got.status === "PASS") {
      if (
        Number(got.warmup_seconds) === CONTRACT_WARMUP_SECONDS &&
        Number(got.measured_seconds) === CONTRACT_MEASURED_SECONDS
      ) {
        passed.push(cell.cell_id);
      } else {
        invalid.push({
          id: cell.cell_id,
          reason: "non-contract durations on PASS cell (scout promotion forbidden)",
        });
      }
      continue;
    }
    if (got.status === "BLOCKED") {
      blocked.push({ id: cell.cell_id, reason: got.blocked_reason || null });
      continue;
    }
    invalid.push({ id: cell.cell_id, reason: `status=${got.status}` });
  }

  const unexplainedBlocked = blocked.filter((b) => !b.reason);
  const complete =
    missing.length === 0 &&
    invalid.length === 0 &&
    unexplainedBlocked.length === 0 &&
    blocked.length === 0 &&
    passed.length === expected.length;

  return {
    expected_cell_count: opts.expected_cell_count ?? expected.length,
    pass_cell_count: passed.length,
    blocked_cell_count: blocked.length,
    invalid_cell_count: invalid.length,
    missing_count: missing.length,
    unexplained_blocked_count: unexplainedBlocked.length,
    missing: missing.slice(0, 50),
    invalid: invalid.slice(0, 50),
    complete,
    pgbench_ceiling_complete_allowed: complete,
    unknowns: 0,
  };
}
