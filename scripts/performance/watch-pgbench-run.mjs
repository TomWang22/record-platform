#!/usr/bin/env node
/**
 * Read-only Gate-3 sequential run watchdog + monotonic history/ETA.
 * Detects STALLED / STOPPED / RUNNING without changing benchmark semantics.
 *
 * Allowed writes: <run>/watchdog/latest.json, <run>/watchdog/history.json
 * Forbidden writes: owner-review artifacts, checkpoints, authorization/parity.
 *
 * Exit codes:
 *   0 = RUNNING (or STOPPED after owner_complete)
 *   2 = STALLED / STOPPED incomplete / WAITING
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProgressLog,
  evaluateRunWatchdog,
  appendWatchdogHistory,
  estimateOwnerEta,
  resolveLastProgressAtMs,
  writeJsonAtomic,
} from "../lib/pgbench_run_watchdog.mjs";
import { evaluateOwnerReview } from "../lib/pgbench_owner_review.mjs";
import { classifyMonitorHealth } from "../lib/pgbench_in_flight.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN =
  process.env.GATE3_RESUME_DIR ||
  "reports/performance/pgbench/pgbench-contract-20260812-011924-ef21a35e";
const reportDir = RUN.startsWith("/") ? RUN : join(ROOT, RUN);
const logPath =
  process.env.GATE3_WATCH_LOG ||
  join(ROOT, "reports/performance/pgbench/logs/gate3-contract-envaware.log");
const stallAfterMs = Number(process.env.GATE3_STALL_AFTER_MS || 20 * 60 * 1000);
const owner = process.env.GATE3_OWNER || "records";

function pgrep(pattern) {
  const r = spawnSync("pgrep", ["-fl", pattern], { encoding: "utf8" });
  const lines = String(r.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines;
}

const runnerLines = pgrep("run-pgbench-matrix");
const pgbenchLines = pgrep("pgbench -h");
const supervisorLines = pgrep("supervise-pgbench-contract");
const runner_alive = runnerLines.some((l) => l.includes("run-pgbench-matrix"));
const pgbench_alive = pgbenchLines.some((l) => /\bpgbench\b/.test(l));
const supervisor_alive = supervisorLines.some((l) => l.includes("supervise-pgbench-contract"));

const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
const events = parseProgressLog(logText);
const last = events.length ? events[events.length - 1] : null;

const runId = reportDir.split("/").pop();
let owner_valid = 0;
let owner_expected = 1218;
let owner_complete = false;
try {
  const review = evaluateOwnerReview(reportDir, owner, runId);
  owner_valid = review.valid_owner_cells;
  owner_expected = review.expected_owner_cells;
  owner_complete = review.owner_complete === true;
} catch {
  // review optional for watchdog liveness
}

const now = Date.now();
const outDir = join(reportDir, "watchdog");
mkdirSync(outDir, { recursive: true });
const historyPath = join(outDir, "history.json");
let priorHistory = { samples: [] };
if (existsSync(historyPath)) {
  try {
    priorHistory = JSON.parse(readFileSync(historyPath, "utf8"));
  } catch {
    priorHistory = { samples: [] };
  }
}

const last_progress_at_ms = resolveLastProgressAtMs({
  now_ms: now,
  log_mtime_ms: null,
  events,
  history_samples: priorHistory.samples || [],
  owner_valid_cells: owner_valid,
});

const verdict = evaluateRunWatchdog({
  now_ms: now,
  runner_alive,
  pgbench_alive,
  supervisor_alive,
  last_progress_at_ms,
  stall_after_ms: stallAfterMs,
  expected_cell_seconds: 150,
  last_progress: last,
  owner_valid_cells: owner_valid,
  owner_expected_cells: owner_expected,
  owner_complete,
});
const monitor_health = classifyMonitorHealth({
  runner_alive,
  supervisor_alive,
  run_incomplete: !owner_complete,
});

const history = appendWatchdogHistory(priorHistory, {
  at: new Date(now).toISOString(),
  at_ms: now,
  state: verdict.state,
  stalled: verdict.stalled,
  owner_valid_cells: owner_valid,
  owner_expected_cells: owner_expected,
  executed: last?.executed ?? null,
  cell_id: last?.cell_id ?? null,
  last_progress_at_ms,
  runner_alive,
  pgbench_alive,
});
writeJsonAtomic(historyPath, history);

const eta = estimateOwnerEta({
  owner_valid_cells: owner_valid,
  owner_expected_cells: owner_expected,
  samples: history.samples
    .filter((s) => s.at_ms != null && s.owner_valid_cells != null)
    .map((s) => ({ at_ms: Number(s.at_ms), owner_valid_cells: Number(s.owner_valid_cells) })),
  fallback_seconds_per_cell: 150,
});

const report = {
  schema: "record-platform-pgbench-run-watchdog/v1",
  checked_at: new Date(now).toISOString(),
  report_dir: reportDir,
  log_path: logPath,
  runner_alive,
  pgbench_alive,
  supervisor_alive,
  runner_sample: runnerLines.slice(0, 3),
  pgbench_sample: pgbenchLines.slice(0, 3),
  progress_events: events.length,
  last_progress: last,
  last_progress_at_ms,
  owner,
  owner_valid_cells: owner_valid,
  owner_expected_cells: owner_expected,
  owner_complete,
  watchdog: verdict,
  monitor_health,
  eta,
  history_samples: history.samples.length,
  history_path: historyPath,
  history_kind: "monotonic_json_rewrite",
  pgbench_ceiling_complete: false,
  tuning: "NO_GO",
  protocol: "NO_GO",
  note: "Read-only except monotonic watchdog history/latest. Stall timer ignores log mtime.",
};

const outPath = join(outDir, "latest.json");
writeJsonAtomic(outPath, report);

console.log(JSON.stringify(report, null, 2));

if (verdict.state === "RUNNING") process.exit(0);
if (verdict.state === "STOPPED" && owner_complete) process.exit(0);
if (verdict.state === "UNSUPERVISED_RUNNER" || monitor_health.incident === "UNSUPERVISED_RUNNER") {
  process.exit(2);
}
process.exit(2);
