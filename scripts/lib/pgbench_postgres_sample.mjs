/**
 * PostgreSQL telemetry sampling for Gate 3 measured windows.
 * Missing capabilities → METRIC_UNAVAILABLE (never invent 0).
 */
import { spawnSync } from "node:child_process";

const SAMPLE_SQL = `
SELECT json_build_object(
  'captured_at', clock_timestamp(),
  'num_backends', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
  'waiting_backends', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type IS NOT NULL),
  'deadlocks', (SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()),
  'blks_read', (SELECT blks_read FROM pg_stat_database WHERE datname = current_database()),
  'blks_hit', (SELECT blks_hit FROM pg_stat_database WHERE datname = current_database()),
  'xact_commit', (SELECT xact_commit FROM pg_stat_database WHERE datname = current_database()),
  'temp_bytes', (SELECT temp_bytes FROM pg_stat_database WHERE datname = current_database()),
  'checkpoints_timed', (SELECT checkpoints_timed FROM pg_stat_bgwriter),
  'checkpoints_req', (SELECT checkpoints_req FROM pg_stat_bgwriter),
  'buffers_checkpoint', (SELECT buffers_checkpoint FROM pg_stat_bgwriter),
  'max_connections', current_setting('max_connections')::int
) AS sample;
`;

/**
 * @param {{ host: string, port: number, database: string, user?: string, password?: string }} db
 */
export function samplePostgresMetrics(db) {
  const r = spawnSync(
    "psql",
    [
      "-h",
      db.host || "127.0.0.1",
      "-p",
      String(db.port),
      "-U",
      db.user || "postgres",
      "-d",
      db.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      SAMPLE_SQL,
    ],
    {
      env: { ...process.env, PGPASSWORD: db.password || process.env.PGPASSWORD || "postgres" },
      encoding: "utf8",
    },
  );
  if (r.status !== 0) {
    return {
      status: "METRIC_UNAVAILABLE",
      reason: `psql_exit_${r.status}: ${String(r.stderr || r.stdout).slice(0, 200)}`,
      sample: null,
    };
  }
  try {
    const sample = JSON.parse(String(r.stdout).trim());
    return { status: "OK", reason: null, sample };
  } catch (err) {
    return {
      status: "METRIC_UNAVAILABLE",
      reason: `json_parse: ${err instanceof Error ? err.message : String(err)}`,
      sample: null,
    };
  }
}

/**
 * Host CPU/mem are OS-level; on Darwin we may not have container cgroup stats.
 */
export function sampleHostResources() {
  const r = spawnSync("ps", ["-A", "-o", "%cpu=", "-o", "rss="], { encoding: "utf8" });
  if (r.status !== 0) {
    return {
      status: "METRIC_UNAVAILABLE",
      reason: "ps_failed",
      cpu_percent_sum: null,
      rss_kb_sum: null,
    };
  }
  let cpu = 0;
  let rss = 0;
  for (const line of String(r.stdout).split(/\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    cpu += Number(parts[0]) || 0;
    rss += Number(parts[1]) || 0;
  }
  return {
    status: "OK",
    reason: null,
    note: "host-wide ps aggregate; not cgroup-isolated — interpret cautiously",
    cpu_percent_sum: cpu,
    rss_kb_sum: rss,
  };
}

export function metricUnavailable(reason) {
  return { status: "METRIC_UNAVAILABLE", reason, value: null };
}
