/**
 * Enumerate expected Gate-3 pgbench cells and reject stub SQL.
 * Completeness is required before pgbench_ceiling_complete=true.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const PGBENCH_STUB_BLOCKED = "PGBENCH_STUB_SQL_BLOCKED";

export const OWNERS = [
  "media",
  "messaging",
  "notification",
  "records",
  "shopping",
  "trust",
  "auth",
  "listings",
  "analytics",
  "auction_monitor",
  "ai",
];

export const WORKLOADS = [
  "W1_DOMAIN_ONLY",
  "W2_DOMAIN_PLUS_OUTBOX",
  "W3_PUBLISHER_DB_PATH",
  "WMIX_OWNER_RANDOMIZED",
];

export const CLIENTS = [8, 16, 32, 64, 128, 256];
export const THREADS = [1, 2, 4, 8, 16];
export const DISTRIBUTIONS = ["UNIFORM", "ZIPFIAN_HOTSET"];
export const PUBLISHER_BATCHES = [1, 10, 25, 50];
export const REPETITIONS = [1, 2, 3];
export const MODES = ["PER_OWNER_CEILING", "ALL_OWNERS_CONCURRENT"];

export const WORKLOAD_FILES = {
  W1_DOMAIN_ONLY: "domain-only.sql",
  W2_DOMAIN_PLUS_OUTBOX: "domain-plus-outbox.sql",
  W3_PUBLISHER_DB_PATH: "publisher-db-path.sql",
  WMIX_OWNER_RANDOMIZED: "wmix.sql",
};

const STUB_PATTERNS = [
  /SELECT\s+1\s*;/i,
  /SELECT\s+0\s*;/i,
  /SELECT\s+1\s*\/\s*0/i,
  /PGBENCH_EXECUTION_BLOCKED/,
  /TEMPLATE ONLY/,
  /TODO_REAL_SQL/,
];

/**
 * @param {string} rootDir scripts/performance/pgbench
 */
export function scanPgbenchStubSql(rootDir) {
  const offenders = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".sql")) {
        const text = readFileSync(p, "utf8");
        for (const re of STUB_PATTERNS) {
          if (re.test(text)) {
            offenders.push({ path: p, pattern: String(re) });
            break;
          }
        }
      }
    }
  }
  walk(rootDir);
  return offenders;
}

/**
 * Full expected cell enumeration for PER_OWNER_CEILING.
 * W3 includes publisher_batches; W1/W2/WMIX use batch=null.
 */
export function enumerateExpectedPgbenchCells() {
  /** @type {Array<Record<string, unknown>>} */
  const cells = [];
  for (const mode of MODES) {
    const owners = mode === "ALL_OWNERS_CONCURRENT" ? ["ALL"] : OWNERS;
    for (const owner of owners) {
      for (const workload of WORKLOADS) {
        for (const distribution of DISTRIBUTIONS) {
          for (const clients of CLIENTS) {
            for (const threads of THREADS) {
              if (threads > clients) continue;
              const batches =
                workload === "W3_PUBLISHER_DB_PATH" ? PUBLISHER_BATCHES : [null];
              for (const batch of batches) {
                for (const repetition of REPETITIONS) {
                  cells.push({
                    mode,
                    owner,
                    workload,
                    distribution,
                    clients,
                    threads,
                    batch,
                    repetition,
                    cell_id: [
                      mode,
                      owner,
                      workload,
                      distribution,
                      `c${clients}`,
                      `t${threads}`,
                      batch == null ? "bNA" : `b${batch}`,
                      `r${repetition}`,
                    ].join("|"),
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  return cells;
}

/**
 * @param {Array<{cell_id: string, status: string}>} results
 */
export function evaluatePgbenchCompleteness(results) {
  const expected = enumerateExpectedPgbenchCells();
  const byId = new Map(results.map((r) => [r.cell_id, r]));
  const missing = [];
  const blocked = [];
  const passed = [];
  for (const cell of expected) {
    const got = byId.get(cell.cell_id);
    if (!got) {
      missing.push(cell.cell_id);
      continue;
    }
    if (got.status === "PASS") passed.push(cell.cell_id);
    else if (got.status === "BLOCKED") blocked.push({ id: cell.cell_id, reason: got.blocked_reason });
    else missing.push(cell.cell_id);
  }
  const unexplainedBlocked = blocked.filter((b) => !b.reason);
  const complete =
    missing.length === 0 &&
    unexplainedBlocked.length === 0 &&
    blocked.length === 0 &&
    passed.length === expected.length;
  return {
    expected_cell_count: expected.length,
    pass_count: passed.length,
    blocked_count: blocked.length,
    missing_count: missing.length,
    unexplained_blocked_count: unexplainedBlocked.length,
    missing: missing.slice(0, 50),
    complete,
    pgbench_ceiling_complete_allowed: complete,
  };
}
