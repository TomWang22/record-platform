/**
 * Full-contract Gate 3 runner: resumable, sequential per-owner ceilings,
 * latency percentiles, postgres samples, cell-matched outbox tax.
 * Does not tune. Does not promote scout cells.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  OWNERS,
  WORKLOAD_FILES,
  scanPgbenchStubSql,
  PGBENCH_STUB_BLOCKED,
} from "./pgbench_completeness.mjs";
import {
  WORKLOAD_REVISION,
  CONTRACT_WARMUP_SECONDS,
  CONTRACT_MEASURED_SECONDS,
  buildExpectedCellCatalog,
  writeCellCheckpoint,
  loadCheckpointIndex,
  nextMissingCells,
  evaluateContractCompleteness,
  classifyCheckpointReuse,
  isSourceLockedReusable,
  shouldStopAtCellBoundary,
} from "./pgbench_resume.mjs";
import { parsePgbenchLatencyLog, percentilesFromSamples } from "./pgbench_latency.mjs";
import { samplePostgresMetrics, sampleHostResources, metricUnavailable } from "./pgbench_postgres_sample.mjs";
import {
  computeCellMatchedOutboxTax,
  summarizeOutboxTax,
} from "./pgbench_outbox_tax.mjs";
import { OWNER_DB } from "./pgbench_runner.mjs";
import { filterCellsForShard, ownerAffinityShardIndex } from "./pgbench_shard.mjs";
import {
  captureEnvironmentForOwner,
  detectInterference,
  discoverLocalPgEnvironments,
} from "./pgbench_environment.mjs";
import { buildSourceBundle } from "./pgbench_source_bundle.mjs";
import {
  captureCellSourceProvenance,
  evaluateSourceBeforeAccept,
  SOURCE_CHANGED_DURING_CELL,
} from "./pgbench_cell_provenance.mjs";
import { CLEANUP_SQL_REL, SEED_SQL_REL, INDEXES_SQL_REL } from "./pgbench_seed_cleanup.mjs";

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

function postgresConfigHash(owner) {
  const db = OWNER_DB[owner] || OWNER_DB.media;
  const r = spawnSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(db.port),
      "-U",
      "postgres",
      "-d",
      db.database,
      "-t",
      "-A",
      "-c",
      `SELECT md5(string_agg(name || '=' || setting, ',' ORDER BY name))
       FROM pg_settings
       WHERE name IN (
         'shared_buffers','effective_cache_size','work_mem','maintenance_work_mem',
         'max_connections','synchronous_commit','fsync','wal_buffers',
         'checkpoint_timeout','max_wal_size','autovacuum'
       )`,
    ],
    { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" },
  );
  if (r.status !== 0) {
    return `METRIC_UNAVAILABLE:${String(r.stderr || "").slice(0, 80)}`;
  }
  return String(r.stdout || "").trim() || "empty";
}

function applyHarnessIndexes(root, owner) {
  const db = OWNER_DB[owner];
  spawnSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(db.port),
      "-U",
      "postgres",
      "-d",
      db.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      join(root, INDEXES_SQL_REL),
    ],
    { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" },
  );
}

function prepareOwnerFixtures(root, owner) {
  const db = OWNER_DB[owner];
  const env = { ...process.env, PGPASSWORD: "postgres" };
  const psql = (rel) =>
    spawnSync(
      "psql",
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(db.port),
        "-U",
        "postgres",
        "-d",
        db.database,
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        join(root, rel),
      ],
      { env, encoding: "utf8" },
    );
  psql(CLEANUP_SQL_REL);
  psql(SEED_SQL_REL);
}

function runOneContractPgbench({
  root,
  owner,
  clients,
  threads,
  batch,
  distribution,
  seed,
  warmup,
  measured,
  sqlPath,
  latencyLogPath,
}) {
  const db = OWNER_DB[owner];
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
    "-n",
    "--log",
    "--log-prefix",
    latencyLogPath.replace(/\.log$/, ""),
    db.database,
  ];
  if (batch != null) args.push("-D", `batch=${batch}`);
  args.push("-D", `seed=${seed}`, "-D", `distribution=${distribution}`);

  const env = {
    ...process.env,
    PGPASSWORD: process.env.PGPASSWORD || "postgres",
    PGBENCH_DISTRIBUTION: distribution,
    PGBENCH_SEED: String(seed),
  };

  if (warmup > 0) {
    const warmArgs = [...args];
    // warmup must not write latency logs into measured samples
    const li = warmArgs.indexOf("--log");
    if (li >= 0) warmArgs.splice(li, 3); // remove --log --log-prefix path
    const ti = warmArgs.indexOf("-T");
    if (ti >= 0) warmArgs[ti + 1] = String(warmup);
    spawnSync("pgbench", warmArgs, {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  }

  const beforePg = samplePostgresMetrics({
    host: "127.0.0.1",
    port: db.port,
    database: db.database,
  });
  const beforeHost = sampleHostResources();
  const started = Date.now();
  const result = spawnSync("pgbench", args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const elapsed_ms = Date.now() - started;
  const afterPg = samplePostgresMetrics({
    host: "127.0.0.1",
    port: db.port,
    database: db.database,
  });
  const afterHost = sampleHostResources();

  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  const tpsMatch = out.match(/tps = ([0-9.]+)/);
  const latMatch = out.match(/latency average = ([0-9.]+) ms/);
  const stddevMatch = out.match(/latency stddev = ([0-9.]+) ms/);
  const failedMatch = out.match(/number of failed transactions: ([0-9]+)/);
  const processedMatch = out.match(/number of transactions actually processed: ([0-9]+)/);

  // Collect latency log shards written by pgbench threads
  let latencyText = "";
  const logDir = join(latencyLogPath, "..");
  const prefix = latencyLogPath.replace(/\.log$/, "").split("/").pop();
  try {
    for (const name of readdirSync(logDir)) {
      if (name.startsWith(prefix)) {
        latencyText += readFileSync(join(logDir, name), "utf8") + "\n";
      }
    }
  } catch {
    latencyText = "";
  }
  const samples = parsePgbenchLatencyLog(latencyText);
  const percentiles = percentilesFromSamples(samples);
  if (percentiles.status === "OK") {
    writeFileSync(`${latencyLogPath}.samples.json`, JSON.stringify({ n: samples.length, percentiles }, null, 2));
  }

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
    p50: percentiles.p50,
    p95: percentiles.p95,
    p99: percentiles.p99,
    max_latency_ms: percentiles.max,
    latency_sample_n: percentiles.n,
    latency_status: percentiles.status,
    latency_unavailable_reason: percentiles.reason || null,
    postgres_samples: { before: beforePg, after: afterPg },
    host_samples: { before: beforeHost, after: afterHost },
  };
}

function deriveSaturation(results) {
  const thresholds = {
    tps_scale_min: 1.25,
    latency_accel_min: 1.6,
    note: "TPS_SCALE_KNEE when client doubles and tps_ratio < 1.25; P95_ACCELERATION when p95_ratio > 1.6",
  };
  /** @type {Record<string, any>} */
  const byOwner = {};
  for (const owner of OWNERS) {
    byOwner[owner] = {};
    for (const workload of [
      "W1_DOMAIN_ONLY",
      "W2_DOMAIN_PLUS_OUTBOX",
      "W3_PUBLISHER_DB_PATH",
      "WMIX_OWNER_RANDOMIZED",
    ]) {
      for (const distribution of ["UNIFORM", "ZIPFIAN_HOTSET"]) {
        const rows = results
          .filter(
            (r) =>
              r.owner === owner &&
              r.workload === workload &&
              r.distribution === distribution &&
              r.mode === "PER_OWNER_CEILING" &&
              r.status === "PASS",
          )
          .sort((a, b) => a.clients - b.clients || a.threads - b.threads);
        // Prefer primary-ish: max threads per clients
        /** @type {Map<number, any>} */
        const best = new Map();
        for (const r of rows) {
          const prev = best.get(r.clients);
          if (!prev || r.threads > prev.threads) best.set(r.clients, r);
        }
        const series = [...best.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, r]) => r);
        let tps_knee = null;
        let p95_knee = null;
        let p99_knee = null;
        for (let i = 1; i < series.length; i++) {
          const prev = series[i - 1];
          const cur = series[i];
          if (cur.clients / prev.clients >= 1.9) {
            if (
              tps_knee == null &&
              prev.tps > 0 &&
              cur.tps / prev.tps < thresholds.tps_scale_min
            ) {
              tps_knee = cur.clients;
            }
            if (
              p95_knee == null &&
              prev.p95 != null &&
              cur.p95 != null &&
              cur.p95 / prev.p95 > thresholds.latency_accel_min
            ) {
              p95_knee = cur.clients;
            }
            if (
              p99_knee == null &&
              prev.p99 != null &&
              cur.p99 != null &&
              cur.p99 / prev.p99 > thresholds.latency_accel_min
            ) {
              p99_knee = cur.clients;
            }
          }
        }
        byOwner[owner][`${workload}|${distribution}`] = {
          TPS_SCALE_KNEE: tps_knee,
          P95_ACCELERATION: p95_knee,
          P99_ACCELERATION: p99_knee,
          CONNECTION_SATURATION: metricUnavailable("requires time-aligned connection series; see postgres-samples"),
          CPU_SATURATION: metricUnavailable("host ps aggregate only; not cgroup-isolated"),
          LOCK_WAIT_ACCELERATION: metricUnavailable("lock wait deltas not yet attributed"),
          IO_DOMINANCE: metricUnavailable("blks_read deltas in postgres-samples; dominance classifier TBD"),
          WAL_DOMINANCE: metricUnavailable("WAL rate not captured in this sampler"),
          series: series.map((r) => ({
            clients: r.clients,
            threads: r.threads,
            tps: r.tps,
            p50: r.p50,
            p95: r.p95,
            p99: r.p99,
            avg_latency_ms: r.avg_latency_ms,
          })),
        };
      }
    }
  }
  return { thresholds, owners: byOwner };
}

/**
 * @param {{
 *   root: string,
 *   harness: any,
 *   parity: any,
 *   resumeDir?: string,
 *   cellLimit?: number,
 * }} opts
 */
export async function runPgbenchContractMatrix(opts) {
  const root = opts.root;
  const stubs = scanPgbenchStubSql(join(root, "scripts/performance/pgbench"));
  if (stubs.length > 0) {
    throw new Error(
      `${PGBENCH_STUB_BLOCKED}: ${stubs.length} stub SQL files remain`,
    );
  }

  const warmup = CONTRACT_WARMUP_SECONDS;
  const measured = CONTRACT_MEASURED_SECONDS;
  const cfgHash = postgresConfigHash("media");

  const resumeDir = opts.resumeDir || process.env.GATE3_RESUME_DIR || "";
  let runId;
  let reportDir;
  if (resumeDir) {
    reportDir = resumeDir.startsWith("/")
      ? resumeDir
      : join(root, resumeDir);
    runId = reportDir.split("/").pop();
  } else {
    runId = `pgbench-contract-${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")
      .replace("T", "-")}-${gitSha(root).slice(0, 8)}`;
    reportDir = join(root, "reports/performance/pgbench", runId);
  }
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(join(reportDir, "latency-samples"), { recursive: true });
  mkdirSync(join(reportDir, "postgres-samples"), { recursive: true });
  mkdirSync(join(reportDir, "cells"), { recursive: true });
  for (const owner of OWNERS) {
    applyHarnessIndexes(root, owner);
  }

  const shardId = process.env.GATE3_SHARD_ID || opts.shardId || null;
  const shardOwner = process.env.GATE3_OWNER || opts.owner || null;
  const shardIndex =
    process.env.GATE3_SHARD_INDEX != null
      ? Number(process.env.GATE3_SHARD_INDEX)
      : opts.shardIndex != null
        ? Number(opts.shardIndex)
        : shardOwner
          ? ownerAffinityShardIndex(shardOwner)
          : null;
  const shardCount = Number(process.env.GATE3_SHARD_COUNT || opts.shardCount || 11);
  const shardMode = process.env.GATE3_SHARD_MODE || opts.shardMode || "OWNER_AFFINITY";
  const environmentId = process.env.GATE3_ENVIRONMENT_ID || opts.environmentId || null;

  if (shardId) {
    mkdirSync(join(reportDir, "shards", shardId, "cells"), { recursive: true });
    mkdirSync(join(reportDir, "shards", shardId, "latency-samples"), { recursive: true });
    mkdirSync(join(reportDir, "shards", shardId, "postgres-samples"), { recursive: true });
  }

  const discovery = discoverLocalPgEnvironments();
  if (
    shardIndex != null &&
    process.env.GATE3_ALLOW_SHARED_CONTENTION_PARALLEL === "1" &&
    discovery.isolated_contention_domain_count < 2
  ) {
    console.error(
      JSON.stringify({
        warning:
          "GATE3_ALLOW_SHARED_CONTENTION_PARALLEL set but host has a single contention domain — measurements may be INVALID_ENVIRONMENT_INTERFERENCE",
        discovery,
      }),
    );
  }
  const database_targets = Object.fromEntries(
    Object.entries(OWNER_DB).map(([o, db]) => [
      o,
      `127.0.0.1:${db.port}/${db.database}`,
    ]),
  );
  database_targets.ALL = "ALL_OWNERS_SHARED";

  const catalog = buildExpectedCellCatalog({
    workload_revision: WORKLOAD_REVISION,
    postgres_config_hash: cfgHash,
    database_targets,
    run_id: runId,
  });
  writeFileSync(join(reportDir, "expected-cells.json"), JSON.stringify(catalog, null, 2) + "\n");
  const catalog_sha = sha256(readFileSync(join(reportDir, "expected-cells.json")));
  const sourceBundle = buildSourceBundle({
    repoRoot: root,
    gitSha: gitSha(root),
    workloadRevision: WORKLOAD_REVISION,
  });
  if (!sourceBundle.ok) {
    throw new Error(`SOURCE_BUNDLE_NOT_FROZEN: ${(sourceBundle.reasons || []).join("; ")}`);
  }
  const freeze = {
    run_id: runId,
    git_sha: sourceBundle.git_sha,
    source_bundle_sha: sourceBundle.bundle_sha256,
    catalog_sha,
    workload_revision: WORKLOAD_REVISION,
    contention_domain_id: environmentId || "colima-shared-domain",
    files: sourceBundle.files,
  };
  writeFileSync(
    join(reportDir, "run-identity.json"),
    JSON.stringify(
      {
        schema: "record-platform-pgbench-run-identity/v1",
        run_id: runId,
        git_sha: freeze.git_sha,
        source_bundle_sha: freeze.source_bundle_sha,
        catalog_sha,
        workload_revision: WORKLOAD_REVISION,
        contention_domain_id: freeze.contention_domain_id,
        environment_fingerprint: null,
        expected_total_cells: 14616,
        lineage: "SEQUENTIAL_SINGLE_CONTENTION_DOMAIN",
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(reportDir, "source-bundle.json"), JSON.stringify(sourceBundle, null, 2) + "\n");

  // Load checkpoints from top-level cells/ and shards/<id>/cells/
  const checkpoint = loadCheckpointIndex(reportDir);
  if (existsSync(join(reportDir, "shards"))) {
    for (const sid of readdirSync(join(reportDir, "shards"))) {
      const sub = loadCheckpointIndex(join(reportDir, "shards", sid));
      for (const [id, row] of sub) checkpoint.set(id, row);
    }
  }

  // Classify legacy checkpoints (preserve files; do not reuse)
  let legacyInsufficient = 0;
  for (const [id, row] of checkpoint) {
    const cls = classifyCheckpointReuse(row);
    if (cls.reason === "LEGACY_CHECKPOINT_INSUFFICIENT") {
      legacyInsufficient += 1;
      writeFileSync(
        join(reportDir, "cells", `${String(id).replace(/\|/g, "__")}.LEGACY_CHECKPOINT_INSUFFICIENT`),
        `${cls.reason}\n`,
      );
    }
  }

  let pending = nextMissingCells(catalog, checkpoint, freeze);
  if (shardIndex != null && shardMode === "OWNER_AFFINITY") {
    pending = filterCellsForShard(pending, {
      mode: "OWNER_AFFINITY",
      shard_count: shardCount,
      shard_index: shardIndex,
      phase: process.env.GATE3_PHASE || "PER_OWNER_CEILING",
      owner: shardOwner || undefined,
    });
  } else if (shardIndex != null && shardMode === "HASH") {
    pending = filterCellsForShard(pending, {
      mode: "HASH",
      shard_count: shardCount,
      shard_index: shardIndex,
      phase: process.env.GATE3_PHASE || "ALL_OWNERS_CONCURRENT",
    });
  }

  const cellLimit = opts.cellLimit ?? Number(process.env.GATE3_CELL_LIMIT || 0);

  /** @type {any[]} */
  const results = [];
  for (const cell of catalog.cells) {
    const got = checkpoint.get(cell.cell_id);
    if (got && isSourceLockedReusable(got, freeze)) results.push(got);
  }

  function persistCell(row) {
    writeCellCheckpoint(reportDir, row);
    if (shardId) {
      writeCellCheckpoint(join(reportDir, "shards", shardId), row);
    }
  }

  function envFor(owner) {
    const db = OWNER_DB[owner];
    return captureEnvironmentForOwner({
      owner,
      shard_id: shardId || owner,
      environment_id: environmentId || undefined,
      database_target: `127.0.0.1:${db.port}/${db.database}`,
      postgres_config_hash: cfgHash,
      postgres_version: opts.postgres_version,
    });
  }

  let executed = 0;
  for (const cell of pending) {
    if (shouldStopAtCellBoundary({ reportDir, env: process.env })) {
      break;
    }
    if (cellLimit > 0 && executed >= cellLimit) {
      break;
    }

    // Sequential PER_OWNER — never parallelize ceilings on same instance.
    if (cell.mode === "ALL_OWNERS_CONCURRENT") {
      const ownerResults = [];
      let concurrentSourceReason = null;
      for (const owner of OWNERS) {
        const sqlPath = join(
          root,
          "scripts/performance/pgbench",
          owner,
          WORKLOAD_FILES[cell.workload],
        );
        const environment = envFor(owner);
        const startProv = captureCellSourceProvenance({
          root,
          freeze,
          owner,
          workload: cell.workload,
          environment: {
            ...environment,
            environment_fingerprint: `${environment.environment_id}|${environment.contention_domain_id}|${environment.postgres_config_hash}`,
          },
          cell: { ...cell, owner },
        });
        prepareOwnerFixtures(root, owner);
        const latencyLogPath = join(
          reportDir,
          shardId ? join("shards", shardId, "latency-samples") : "latency-samples",
          `${cell.cell_id.replace(/\|/g, "__")}__${owner}.log`,
        );
        const bench = runOneContractPgbench({
          root,
          owner,
          clients: cell.clients,
          threads: cell.threads,
          batch: cell.batch,
          distribution: cell.distribution,
          seed: cell.random_seed,
          warmup,
          measured,
          sqlPath,
          latencyLogPath,
        });
        const sourceVerdict = evaluateSourceBeforeAccept({
          root,
          start: startProv,
          freeze,
          owner,
          workload: cell.workload,
          environment,
          cell: { ...cell, owner },
        });
        if (!sourceVerdict.ok) concurrentSourceReason = sourceVerdict.reason;
        ownerResults.push({ owner, ...bench, environment, ...startProv });
        writeFileSync(
          join(
            reportDir,
            shardId ? join("shards", shardId, "postgres-samples") : "postgres-samples",
            `${cell.cell_id.replace(/\|/g, "__")}__${owner}.json`,
          ),
          JSON.stringify({ before: bench.postgres_samples.before, after: bench.postgres_samples.after }, null, 2),
        );
      }
      const env0 = ownerResults[0]?.environment || null;
      const startProv0 = captureCellSourceProvenance({
        root,
        freeze,
        owner: "records",
        workload: cell.workload,
        environment: env0 || {},
        cell,
      });
      const status = concurrentSourceReason
        ? "INVALID"
        : ownerResults.every((r) => r.exit_code === 0)
          ? "PASS"
          : "BLOCKED";
      const row = {
        ...cell,
        ...startProv0,
        status,
        blocked_reason: concurrentSourceReason
          ? concurrentSourceReason
          : status === "PASS"
            ? null
            : "ALL_OWNERS_CONCURRENT: one or more owners failed pgbench",
        owner_results: ownerResults,
        warmup_seconds: warmup,
        measured_seconds: measured,
        shard_id: shardId,
        environment_id: environmentId,
        environment: env0,
      };
      results.push(row);
      persistCell(row);
      executed += 1;
      console.log(JSON.stringify({ progress: true, executed, status: row.status, cell_id: row.cell_id }));
      continue;
    }

    const inter = detectInterference({
      active_pgbench_targets: [cell.database_target, cell.database_target].slice(
        0,
        process.env.GATE3_SIMULATE_INTERFERENCE === "1" ? 2 : 1,
      ),
      database_target: cell.database_target,
      swap_used_bytes: 0,
      cpu_throttled: false,
    });
    if (!inter.ok) {
      const row = {
        ...cell,
        status: "INVALID_ENVIRONMENT_INTERFERENCE",
        blocked_reason: inter.reason,
        warmup_seconds: warmup,
        measured_seconds: measured,
        environment: envFor(cell.owner),
        shard_id: shardId,
      };
      results.push(row);
      persistCell(row);
      executed += 1;
      console.log(JSON.stringify({ progress: true, executed, status: row.status, cell_id: row.cell_id }));
      continue;
    }

    const sqlPath = join(
      root,
      "scripts/performance/pgbench",
      cell.owner,
      WORKLOAD_FILES[cell.workload],
    );
    const environment = envFor(cell.owner);
    const startProv = captureCellSourceProvenance({
      root,
      freeze,
      owner: cell.owner,
      workload: cell.workload,
      environment: {
        ...environment,
        environment_fingerprint: `${environment.environment_id}|${environment.contention_domain_id}|${environment.postgres_config_hash}`,
      },
      cell,
    });
    prepareOwnerFixtures(root, cell.owner);
    const latencyBase = shardId
      ? join(reportDir, "shards", shardId, "latency-samples")
      : join(reportDir, "latency-samples");
    mkdirSync(latencyBase, { recursive: true });
    const latencyLogPath = join(latencyBase, `${cell.cell_id.replace(/\|/g, "__")}.log`);
    const bench = runOneContractPgbench({
      root,
      owner: cell.owner,
      clients: cell.clients,
      threads: cell.threads,
      batch: cell.batch,
      distribution: cell.distribution,
      seed: cell.random_seed,
      warmup,
      measured,
      sqlPath,
      latencyLogPath,
    });
    const pgSampleDir = shardId
      ? join(reportDir, "shards", shardId, "postgres-samples")
      : join(reportDir, "postgres-samples");
    mkdirSync(pgSampleDir, { recursive: true });
    writeFileSync(
      join(pgSampleDir, `${cell.cell_id.replace(/\|/g, "__")}.json`),
      JSON.stringify(bench.postgres_samples, null, 2),
    );
    const sourceVerdict = evaluateSourceBeforeAccept({
      root,
      start: startProv,
      freeze,
      owner: cell.owner,
      workload: cell.workload,
      environment,
      cell,
    });
    let status = bench.exit_code === 0 ? "PASS" : "BLOCKED";
    let blocked_reason =
      bench.exit_code === 0
        ? null
        : `pgbench_exit_${bench.exit_code}: ${String(bench.raw_tail).slice(0, 300)}`;
    if (!sourceVerdict.ok) {
      status = "INVALID";
      blocked_reason = sourceVerdict.reason || SOURCE_CHANGED_DURING_CELL;
    }
    const row = {
      ...cell,
      ...startProv,
      status,
      blocked_reason,
      warmup_seconds: warmup,
      measured_seconds: measured,
      environment,
      shard_id: shardId || cell.owner,
      environment_id: environmentId || undefined,
      ...bench,
      status,
      blocked_reason,
    };
    results.push(row);
    persistCell(row);
    executed += 1;
    console.log(
      JSON.stringify({
        progress: true,
        executed,
        pending_remaining: pending.length - executed,
        status: row.status,
        cell_id: row.cell_id,
        tps: row.tps,
        p95: row.p95,
        avg_latency_ms: row.avg_latency_ms,
        shard_id: row.shard_id,
        legacy_insufficient_seen: legacyInsufficient,
      }),
    );
  }

  // Re-load all checkpoints for final aggregation (includes prior resumes + shards)
  const finalIndex = loadCheckpointIndex(reportDir);
  if (existsSync(join(reportDir, "shards"))) {
    for (const sid of readdirSync(join(reportDir, "shards"))) {
      const sub = loadCheckpointIndex(join(reportDir, "shards", sid));
      for (const [id, row] of sub) finalIndex.set(id, row);
    }
  }
  const finalResults = catalog.cells.map((c) => finalIndex.get(c.cell_id)).filter(Boolean);

  const completeness = evaluateContractCompleteness(finalResults);
  const taxes = computeCellMatchedOutboxTax(finalResults);
  const taxSummary = summarizeOutboxTax(taxes);
  const saturation = deriveSaturation(finalResults);
  const blocked = finalResults.filter((r) => r.status === "BLOCKED");

  const paritySha = sha256(
    readFileSync(join(root, "reports/performance/outbox-publisher-parity.PREPARED.json")),
  );
  const harnessSha = sha256(
    readFileSync(join(root, "reports/performance/end-harness.PREPARED.json")),
  );

  const manifest = {
    run_id: runId,
    contract: true,
    git_sha: gitSha(root),
    parity_sha: paritySha,
    end_harness_sha: harnessSha,
    inventory_sha: opts.parity?.track_c_inventory?.inventory_sha256 || null,
    workload_revision: WORKLOAD_REVISION,
    warmup_seconds: warmup,
    measured_seconds: measured,
    postgres_config_hash: cfgHash,
    host_kernel_container_limits: { note: "colima-local", platform: process.platform },
    postgres_version_config: { client_pgbench: pgbenchVersion() },
    kafka_config: { note: "not_in_pgbench" },
    proxy_caddy_config: { note: "not_in_pgbench" },
    service_image_shas: {},
    pgbench_version: pgbenchVersion(),
    tuning_delta: null,
    scout_promotion_forbidden: true,
    parallel_per_owner_ceiling_forbidden_on_shared_contention_domain: true,
    shard: {
      shard_id: shardId,
      shard_index: shardIndex,
      shard_count: shardCount,
      shard_mode: shardMode,
      environment_id: environmentId,
      discovery,
      legacy_checkpoint_insufficient_count: legacyInsufficient,
    },
    authorization_artifact: {
      kafka_test_execution_authorized: opts.harness?.kafka_test_execution_authorized === true,
      pgbench_execution_authorized: opts.harness?.pgbench_execution_authorized === true,
      protocol_execution_authorized: false,
    },
    expected_cell_count: catalog.cell_count,
  };

  const summary = {
    schema: "record-platform-pgbench-contract-matrix/v1",
    run_id: runId,
    pgbench_is_database_baseline: true,
    pgbench_is_not_http_benchmark: true,
    execution_authorized: false,
    unknowns: completeness.unknowns,
    completeness,
    pgbench_ceiling_complete: completeness.pgbench_ceiling_complete_allowed === true,
    pass_cell_count: completeness.pass_cell_count,
    blocked_cell_count: completeness.blocked_cell_count,
    invalid_cell_count: completeness.invalid_cell_count,
    required_cell_count: completeness.expected_cell_count,
    outbox_tax_summary: taxSummary,
    blocked_reason: completeness.complete
      ? null
      : "matrix incomplete or capacity-blocked cells remain; ceiling not declared complete",
  };

  const files = {
    "expected-cells.json": catalog,
    "manifest.json": manifest,
    "raw-results.json": { results: finalResults },
    "summary.json": summary,
    "saturation.json": saturation,
    "outbox-tax.json": { pairs: taxes, summary: taxSummary },
    "blocked-cells.json": { cells: blocked },
  };

  for (const [name, obj] of Object.entries(files)) {
    const p = join(reportDir, name);
    writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
    writeFileSync(`${p}.sha256`, `${sha256(readFileSync(p))}  ${name}\n`);
  }

  // Never auto-set harness.pgbench_ceiling_complete here unless complete — caller decides.
  return {
    runId,
    reportDir,
    summary,
    manifest,
    completeness,
    shas: Object.fromEntries(
      Object.keys(files).map((name) => [
        name,
        readFileSync(join(reportDir, `${name}.sha256`), "utf8").trim().split(/\s+/)[0],
      ]),
    ),
  };
}
