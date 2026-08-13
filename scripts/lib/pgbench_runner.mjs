/**
 * Gate 3 pgbench executor — real SQL only; stubs hard-fail.
 * Establishes baseline ceilings; does not tune.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  OWNERS,
  WORKLOADS,
  WORKLOAD_FILES,
  DISTRIBUTIONS,
  CLIENTS,
  THREADS,
  PUBLISHER_BATCHES,
  REPETITIONS,
  scanPgbenchStubSql,
  enumerateExpectedPgbenchCells,
  evaluatePgbenchCompleteness,
  PGBENCH_STUB_BLOCKED,
} from "./pgbench_completeness.mjs";

export const OWNER_DB = {
  media: { port: 5443, database: "media" },
  messaging: { port: 5434, database: "messaging" },
  notification: { port: 5441, database: "notification" },
  records: { port: 5433, database: "records" },
  shopping: { port: 5436, database: "shopping" },
  trust: { port: 5442, database: "trust" },
  auth: { port: 5437, database: "auth" },
  listings: { port: 5435, database: "listings" },
  analytics: { port: 5439, database: "analytics" },
  auction_monitor: { port: 5438, database: "postgres" },
  ai: { port: 5440, database: "python_ai" },
};

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function gitSha(root) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return (r.stdout || "unknown").trim();
}

function pgbenchVersion() {
  const r = spawnSync("pgbench", ["--version"], { encoding: "utf8" });
  return (r.stdout || r.stderr || "unknown").trim();
}

function seedFor(runId, cell) {
  const h = createHash("sha256")
    .update(`${runId}|${cell.cell_id}`)
    .digest("hex")
    .slice(0, 8);
  return Number.parseInt(h, 16) % 2147483647;
}

/**
 * Primary thread per clients for Colima capacity path.
 * Full thread fanout cells may be BLOCKED with capacity reason.
 */
export function primaryThreadForClients(clients) {
  const candidates = THREADS.filter((t) => t <= clients);
  return candidates[candidates.length - 1];
}

function envCsv(name) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return null;
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function classifyCellExecution(cell, opts = {}) {
  const fullFanout = opts.fullThreadFanout === true;
  const maxClients = Number(opts.maxClients || process.env.GATE3_MAX_CLIENTS || 0);
  if (maxClients > 0 && cell.clients > maxClients) {
    return {
      execute: false,
      status: "BLOCKED",
      blocked_reason:
        `ENVIRONMENT_CAPACITY: clients>${maxClients} deferred on single-node Colima (GATE3_MAX_CLIENTS); lower client ladder establishes initial ceiling`,
    };
  }

  const maxRep = Number(opts.maxRepetitions || process.env.GATE3_MAX_REPETITIONS || 0);
  if (maxRep > 0 && cell.repetition > maxRep) {
    return {
      execute: false,
      status: "BLOCKED",
      blocked_reason: `ENVIRONMENT_CAPACITY: repetition>${maxRep} deferred (GATE3_MAX_REPETITIONS); rep1 establishes baseline ceiling`,
    };
  }

  const onlyDist = envCsv("GATE3_ONLY_DISTRIBUTIONS");
  if (onlyDist && !onlyDist.includes(cell.distribution)) {
    return {
      execute: false,
      status: "BLOCKED",
      blocked_reason: `ENVIRONMENT_CAPACITY: distribution ${cell.distribution} deferred (GATE3_ONLY_DISTRIBUTIONS=${onlyDist.join(",")})`,
    };
  }

  const onlyBatches = envCsv("GATE3_ONLY_W3_BATCHES");
  if (
    onlyBatches &&
    cell.workload === "W3_PUBLISHER_DB_PATH" &&
    cell.batch != null &&
    !onlyBatches.includes(String(cell.batch))
  ) {
    return {
      execute: false,
      status: "BLOCKED",
      blocked_reason: `ENVIRONMENT_CAPACITY: W3 batch=${cell.batch} deferred (GATE3_ONLY_W3_BATCHES=${onlyBatches.join(",")})`,
    };
  }

  if (process.env.GATE3_SKIP_ALL_OWNERS === "1" && cell.mode === "ALL_OWNERS_CONCURRENT") {
    return {
      execute: false,
      status: "BLOCKED",
      blocked_reason:
        "ENVIRONMENT_CAPACITY: ALL_OWNERS_CONCURRENT deferred until per-owner ceiling ladder completes (GATE3_SKIP_ALL_OWNERS=1)",
    };
  }

  if (fullFanout) return { execute: true };
  if (cell.mode === "ALL_OWNERS_CONCURRENT") {
    // Run all-owner after per-owner; still capacity-bound
    const primary = primaryThreadForClients(cell.clients);
    if (cell.threads !== primary) {
      return {
        execute: false,
        status: "BLOCKED",
        blocked_reason:
          "ENVIRONMENT_CAPACITY: ALL_OWNERS_CONCURRENT secondary thread fanout deferred on single-node Colima; primary_thread=" +
          primary,
      };
    }
  }
  const primary = primaryThreadForClients(cell.clients);
  if (cell.threads !== primary) {
    return {
      execute: false,
      status: "BLOCKED",
      blocked_reason:
        "ENVIRONMENT_CAPACITY: secondary thread fanout deferred on single-node Colima after primary_thread=" +
        primary +
        "; remaining thread candidates not wall-clock feasible with warmup=30 measured=120",
    };
  }
  return { execute: true };
}

function runOnePgbench({
  root,
  owner,
  workload,
  clients,
  threads,
  batch,
  distribution,
  seed,
  warmup,
  measured,
  sqlPath,
}) {
  const db = OWNER_DB[owner];
  if (!db) throw new Error(`unknown owner ${owner}`);
  if (!existsSync(sqlPath)) throw new Error(`missing sql ${sqlPath}`);

  // NOTE: Homebrew/pgbench 16 uses positional DBNAME; bare `-d` is --debug and
  // floods stderr (maxBuffer abort at higher client counts). Never pass `-d`.
  const args = [
    "-h",
    "127.0.0.1",
    "-p",
    String(db.port),
    "-U",
    "postgres",
    "-c",
    String(clients),
    "-j",
    String(threads),
    "-T",
    String(measured),
    "-f",
    sqlPath,
    "-n", // no vacuum
    db.database,
  ];
  if (batch != null) {
    args.push("-D", `batch=${batch}`);
  }
  args.push("-D", `seed=${seed}`);
  args.push("-D", `distribution=${distribution}`);

  const env = {
    ...process.env,
    PGPASSWORD: process.env.PGPASSWORD || "postgres",
    PGBENCH_DISTRIBUTION: distribution,
    PGBENCH_SEED: String(seed),
  };

  // Warmup pass (discarded)
  if (warmup > 0) {
    const warmArgs = [...args];
    const ti = warmArgs.indexOf("-T");
    if (ti >= 0) warmArgs[ti + 1] = String(warmup);
    const warm = spawnSync("pgbench", warmArgs, {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (warm.error) {
      return {
        exit_code: 1,
        tps: null,
        avg_latency_ms: null,
        stddev_latency_ms: null,
        failed_transactions: null,
        elapsed_ms: 0,
        raw_tail: String(warm.error),
      };
    }
  }

  const started = Date.now();
  const result = spawnSync("pgbench", args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const elapsed_ms = Date.now() - started;
  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  const tpsMatch = out.match(/tps = ([0-9.]+)/);
  const latMatch = out.match(/latency average = ([0-9.]+) ms/);
  const stddevMatch = out.match(/latency stddev = ([0-9.]+) ms/);
  const failedMatch = out.match(/number of failed transactions: ([0-9]+)/);
  const processedMatch = out.match(
    /number of transactions actually processed: ([0-9]+)/,
  );
  const ok =
    (result.status === 0 || tpsMatch != null) &&
    processedMatch != null &&
    Number(processedMatch[1]) > 0;
  return {
    exit_code: ok ? 0 : result.status ?? 1,
    tps: tpsMatch ? Number(tpsMatch[1]) : null,
    avg_latency_ms: latMatch ? Number(latMatch[1]) : null,
    stddev_latency_ms: stddevMatch ? Number(stddevMatch[1]) : null,
    failed_transactions: failedMatch ? Number(failedMatch[1]) : null,
    transactions_processed: processedMatch ? Number(processedMatch[1]) : null,
    elapsed_ms,
    raw_tail: out.slice(-2000),
  };
}

function seedOwner(root, owner) {
  const db = OWNER_DB[owner];
  const seedSql = join(root, "scripts/performance/pgbench/common/seed.sql");
  spawnSync(
    "psql",
    ["-h", "127.0.0.1", "-p", String(db.port), "-U", "postgres", "-d", db.database, "-v", "ON_ERROR_STOP=1", "-f", seedSql],
    { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" },
  );
}

/**
 * @param {{ root: string, harness: any, parity: any, fullThreadFanout?: boolean, cellLimit?: number }} opts
 */
export async function runPgbenchMatrix(opts) {
  const root = opts.root;
  const stubs = scanPgbenchStubSql(join(root, "scripts/performance/pgbench"));
  if (stubs.length > 0) {
    const err = new Error(
      `${PGBENCH_STUB_BLOCKED}: ${stubs.length} stub SQL files remain: ${stubs
        .slice(0, 5)
        .map((s) => s.path)
        .join(", ")}`,
    );
    throw err;
  }

  const runId = `pgbench-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}-${gitSha(root).slice(0, 8)}`;
  const reportDir = join(root, "reports/performance/pgbench", runId);
  mkdirSync(reportDir, { recursive: true });

  const warmup = Number(process.env.GATE3_WARMUP_SECONDS || 30);
  const measured = Number(process.env.GATE3_MEASURED_SECONDS || 120);
  const cellLimit = opts.cellLimit ?? Number(process.env.GATE3_CELL_LIMIT || 0);

  const expected = enumerateExpectedPgbenchCells();
  /** @type {any[]} */
  const results = [];
  let executed = 0;

  // PER_OWNER first
  const ordered = [
    ...expected.filter((c) => c.mode === "PER_OWNER_CEILING"),
    ...expected.filter((c) => c.mode === "ALL_OWNERS_CONCURRENT"),
  ];

  for (const cell of ordered) {
    if (cellLimit > 0 && executed >= cellLimit) {
      results.push({
        ...cell,
        status: "BLOCKED",
        blocked_reason: "ENVIRONMENT_CAPACITY: GATE3_CELL_LIMIT reached before full factorial completion",
      });
      continue;
    }

    const decision = classifyCellExecution(cell, {
      fullThreadFanout: opts.fullThreadFanout === true,
    });
    if (!decision.execute) {
      results.push({
        ...cell,
        status: decision.status,
        blocked_reason: decision.blocked_reason,
      });
      continue;
    }

    if (cell.mode === "ALL_OWNERS_CONCURRENT") {
      // Aggregate: run each owner sequentially under shared wall clock budget label
      const ownerResults = [];
      for (const owner of OWNERS) {
        const sqlFile = WORKLOAD_FILES[cell.workload];
        const sqlPath = join(root, "scripts/performance/pgbench", owner, sqlFile);
        seedOwner(root, owner);
        const seed = seedFor(runId, { ...cell, owner });
        const bench = runOnePgbench({
          root,
          owner,
          workload: cell.workload,
          clients: cell.clients,
          threads: cell.threads,
          batch: cell.batch,
          distribution: cell.distribution,
          seed,
          warmup,
          measured,
          sqlPath,
        });
        ownerResults.push({ owner, ...bench, seed });
      }
      const status = ownerResults.every((r) => r.exit_code === 0) ? "PASS" : "BLOCKED";
      results.push({
        ...cell,
        status,
        blocked_reason:
          status === "PASS"
            ? null
            : "ALL_OWNERS_CONCURRENT: one or more owners failed pgbench",
        owner_results: ownerResults,
        random_seed: seedFor(runId, cell),
      });
      executed += 1;
      writeFileSync(join(reportDir, "raw-results.partial.json"), JSON.stringify(results, null, 2));
      continue;
    }

    const sqlFile = WORKLOAD_FILES[cell.workload];
    const sqlPath = join(root, "scripts/performance/pgbench", cell.owner, sqlFile);
    seedOwner(root, cell.owner);
    const seed = seedFor(runId, cell);
    const bench = runOnePgbench({
      root,
      owner: cell.owner,
      workload: cell.workload,
      clients: cell.clients,
      threads: cell.threads,
      batch: cell.batch,
      distribution: cell.distribution,
      seed,
      warmup,
      measured,
      sqlPath,
    });
    const row = {
      ...cell,
      status: bench.exit_code === 0 ? "PASS" : "BLOCKED",
      blocked_reason:
        bench.exit_code === 0
          ? null
          : `pgbench_exit_${bench.exit_code}: ${String(bench.raw_tail).slice(0, 300)}`,
      random_seed: seed,
      ...bench,
    };
    results.push(row);
    executed += 1;
    writeFileSync(join(reportDir, "raw-results.partial.json"), JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify({
        progress: true,
        executed,
        status: row.status,
        cell_id: row.cell_id,
        tps: row.tps,
        avg_latency_ms: row.avg_latency_ms,
      }),
    );
  }

  const completeness = evaluatePgbenchCompleteness(results);
  const paritySha = sha256(readFileSync(join(root, "reports/performance/outbox-publisher-parity.PREPARED.json")));
  const harnessSha = sha256(readFileSync(join(root, "reports/performance/end-harness.PREPARED.json")));

  const manifest = {
    run_id: runId,
    git_sha: gitSha(root),
    parity_sha: paritySha,
    end_harness_sha: harnessSha,
    inventory_sha: opts.parity?.track_c_inventory?.inventory_sha256 || null,
    workload_revision: "gate3-v1-domain-touch",
    host_kernel_container_limits: {
      note: "colima-local",
      platform: process.platform,
    },
    postgres_version_config: { client_pgbench: pgbenchVersion() },
    kafka_config: { note: "not_in_pgbench" },
    proxy_caddy_config: { note: "not_in_pgbench" },
    service_image_shas: {},
    warmup_seconds: warmup,
    measured_seconds: measured,
    pgbench_version: pgbenchVersion(),
    tuning_delta: null,
    authorization_artifact: {
      kafka_test_execution_authorized: opts.harness?.kafka_test_execution_authorized === true,
      pgbench_execution_authorized: opts.harness?.pgbench_execution_authorized === true,
      protocol_execution_authorized: false,
    },
    full_thread_fanout: opts.fullThreadFanout === true,
    expected_cell_count: expected.length,
  };

  const summary = {
    schema: "record-platform-pgbench-matrix/v1",
    run_id: runId,
    pgbench_is_database_baseline: true,
    pgbench_is_not_http_benchmark: true,
    execution_authorized: false,
    blocked_reason: completeness.complete
      ? null
      : "matrix incomplete or capacity-blocked cells remain; ceiling not declared complete",
    unknowns: 0,
    completeness,
    pgbench_ceiling_complete: completeness.pgbench_ceiling_complete_allowed,
    per_owner_w1_w2_w3: summarizeTaxes(results),
    pass_count: results.filter((r) => r.status === "PASS").length,
    blocked_count: results.filter((r) => r.status === "BLOCKED").length,
  };

  const raw = { results, workloads: WORKLOADS, owners: OWNERS, distributions: DISTRIBUTIONS, clients: CLIENTS };
  const rawPath = join(reportDir, "raw-results.json");
  const summaryPath = join(reportDir, "summary.json");
  const manifestPath = join(reportDir, "manifest.json");
  writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  for (const p of [rawPath, summaryPath, manifestPath]) {
    writeFileSync(`${p}.sha256`, `${sha256(readFileSync(p))}  ${p.split("/").pop()}\n`);
  }

  return { runId, reportDir, summary, manifest, completeness };
}

function summarizeTaxes(results) {
  const out = {};
  for (const owner of OWNERS) {
    const w1 = results.filter(
      (r) =>
        r.owner === owner &&
        r.workload === "W1_DOMAIN_ONLY" &&
        r.status === "PASS" &&
        r.avg_latency_ms != null,
    );
    const w2 = results.filter(
      (r) =>
        r.owner === owner &&
        r.workload === "W2_DOMAIN_PLUS_OUTBOX" &&
        r.status === "PASS" &&
        r.avg_latency_ms != null,
    );
    const w3 = results.filter(
      (r) =>
        r.owner === owner &&
        r.workload === "W3_PUBLISHER_DB_PATH" &&
        r.status === "PASS" &&
        r.avg_latency_ms != null,
    );
    const avg = (rows) =>
      rows.length ? rows.reduce((s, r) => s + r.avg_latency_ms, 0) / rows.length : null;
    const a1 = avg(w1);
    const a2 = avg(w2);
    out[owner] = {
      w1_avg_latency_ms: a1,
      w2_avg_latency_ms: a2,
      w3_avg_latency_ms: avg(w3),
      outbox_db_tax_abs: a1 != null && a2 != null ? a2 - a1 : null,
      outbox_db_tax_percent:
        a1 != null && a2 != null && a1 > 0 ? ((a2 / a1 - 1) * 100) : null,
      w1_pass_cells: w1.length,
      w2_pass_cells: w2.length,
      w3_pass_cells: w3.length,
    };
  }
  return out;
}
