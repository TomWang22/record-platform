#!/usr/bin/env node
/**
 * Active Gate-3 completion supervisor.
 * Distinct from the read-only watchdog. Keeps one frozen contract runner alive.
 *
 * Allowed writes:
 *   <run>/supervisor/state.json
 *   <run>/supervisor/history.json
 *   <run>/supervisor/incidents/*.json
 *   <run>/supervisor/status.json
 *   <run>/supervisor/lock.json
 * plus owner-review artifacts only when that owner is complete,
 * plus global completion artifacts only at 14616/14616 with zero anomalies.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProgressLog,
  appendWatchdogHistory,
  estimateOwnerEta,
  writeJsonAtomic,
} from "../lib/pgbench_run_watchdog.mjs";
import { evaluateOwnerReview, writeOwnerReviewArtifacts } from "../lib/pgbench_owner_review.mjs";
import { validateMergedCompleteness, writeMergedArtifacts } from "../lib/pgbench_merge.mjs";
import { cellsPerOwner } from "../lib/pgbench_shard.mjs";
import {
  CONTRACT_WARMUP_SECONDS,
  CONTRACT_MEASURED_SECONDS,
  WORKLOAD_REVISION,
  loadCheckpointIndex,
  nextMissingCells,
} from "../lib/pgbench_resume.mjs";
import {
  MAX_RESTARTS_PER_CELL,
  assertFrozenRunIdentity,
  countCellRestarts,
  decideSupervisorAction,
  evaluateGlobalCeiling,
  evaluateSupervisorLock,
  frozenOwnerSequence,
  resolveSupervisorProgressAtMs,
  nextRequiredFromCatalog,
  planSupervisorShutdown,
  releaseSupervisorLock,
  buildSupervisorStatus,
} from "../lib/pgbench_contract_supervisor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RESUME =
  process.env.GATE3_RESUME_DIR ||
  "reports/performance/pgbench/pgbench-contract-20260812-011924-ef21a35e";
const reportDir = RESUME.startsWith("/") ? RESUME : join(ROOT, RESUME);
const logPath =
  process.env.GATE3_WATCH_LOG ||
  join(ROOT, "reports/performance/pgbench/logs/gate3-contract-envaware.log");
const stallAfterMs = Number(process.env.GATE3_STALL_AFTER_MS || 20 * 60 * 1000);
const pollMs = Number(process.env.GATE3_SUPERVISOR_POLL_MS || 30_000);
const runId = reportDir.split("/").pop();
const supDir = join(reportDir, "supervisor");
const lockPath = join(supDir, "lock.json");
const statePath = join(supDir, "state.json");
const historyPath = join(supDir, "history.json");
const statusPath = join(supDir, "status.json");
const fatalPath = join(supDir, "fatal.json");
const incidentsDir = join(supDir, "incidents");

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitSha() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return String(r.stdout || "").trim();
}

function pgrep(pattern) {
  const r = spawnSync("pgrep", ["-fl", pattern], { encoding: "utf8" });
  return String(r.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function parsePids(lines) {
  return lines
    .map((l) => Number(String(l).split(/\s+/)[0]))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function releaseOwnedLock() {
  const plan = planSupervisorShutdown({ adopted_runner_alive: true });
  if (!plan.release_lock || plan.terminate_runner) return;
  const existing = readJson(lockPath, null);
  if (!releaseSupervisorLock({ existing, self_pid: process.pid }).release) return;
  try {
    unlinkSync(lockPath);
  } catch {
    // stale-lock recovery will run after this PID is proven dead
  }
}

function persistFatal(decision) {
  mkdirSync(supDir, { recursive: true });
  writeJsonAtomic(fatalPath, {
    at: new Date().toISOString(),
    action: decision.action,
    reason: decision.reason || decision.action,
    pgbench_ceiling_complete: false,
  });
}

function environmentFingerprint() {
  const dirs = [join(reportDir, "cells")];
  const shards = join(reportDir, "shards");
  if (existsSync(shards)) {
    for (const sid of readdirSync(shards)) dirs.push(join(shards, sid, "cells"));
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const row = JSON.parse(readFileSync(join(dir, name), "utf8"));
        const e = row.environment;
        if (e?.environment_id && e?.contention_domain_id && e?.postgres_config_hash) {
          return `${e.environment_id}|${e.contention_domain_id}|${e.postgres_config_hash}`;
        }
      } catch {
        // skip
      }
    }
  }
  return null;
}

function observeIdentity() {
  const catalogPath = join(reportDir, "expected-cells.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  return {
    resume_dir: RESUME,
    git_sha: gitSha(),
    catalog_sha: sha256File(catalogPath),
    environment_fingerprint: environmentFingerprint(),
    warmup_seconds: Number(catalog.warmup_seconds),
    measured_seconds: Number(catalog.measured_seconds),
    expected_cell_count: Number(catalog.cell_count),
    expected_owner_cells: cellsPerOwner(),
    workload_revision: catalog.workload_revision,
  };
}

function acquireLock() {
  mkdirSync(supDir, { recursive: true });
  mkdirSync(incidentsDir, { recursive: true });
  const existing = readJson(lockPath, null);
  const verdict = evaluateSupervisorLock({
    existing,
    self_pid: process.pid,
    isPidAlive,
  });
  if (!verdict.acquire) {
    console.error(JSON.stringify({ error: verdict.reason, existing }));
    process.exit(2);
  }
  writeJsonAtomic(lockPath, {
    pid: process.pid,
    started_at: new Date().toISOString(),
    run_dir: reportDir,
    resume_dir: RESUME,
    git_sha: gitSha(),
    catalog_sha: existsSync(join(reportDir, "expected-cells.json"))
      ? sha256File(join(reportDir, "expected-cells.json"))
      : null,
    environment_fingerprint: environmentFingerprint(),
    recovered_stale: Boolean(verdict.recover_stale),
  });
}

function launchRunner(launchEnv) {
  const still = pgrep("run-pgbench-matrix").filter((l) => l.includes("run-pgbench-matrix"));
  if (still.length) return null;
  mkdirSync(dirname(logPath), { recursive: true });
  const fd = openSync(logPath, "a");
  const child = spawn(process.execPath, ["scripts/performance/run-pgbench-matrix.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...launchEnv,
      GATE3_RESUME_DIR: RESUME,
      PGPASSWORD: process.env.PGPASSWORD || "postgres",
    },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  return child.pid;
}

async function terminatePids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid))) return;
    await sleep(500);
  }
  for (const pid of pids) {
    if (!isPidAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  await sleep(500);
}

function logTail(path, n = 40) {
  if (!existsSync(path)) return "";
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  return lines.slice(-n).join("\n");
}

function currentOwnerFromProgress(last, fallback) {
  const id = last?.cell_id || "";
  const parts = String(id).split("|");
  if (parts[0] === "ALL_OWNERS_CONCURRENT") return "ALL";
  if (parts[1] && frozenOwnerSequence().includes(parts[1])) return parts[1];
  return fallback;
}

function globalSnapshot(currentOwner, currentReview) {
  const merge = validateMergedCompleteness(reportDir);
  const ownerReviews = {};
  if (currentOwner && currentOwner !== "ALL") ownerReviews[currentOwner] = currentReview;
  const nearOwnerDone = Number(merge.pass_cell_count || 0) >= cellsPerOwner() * 11;
  if (nearOwnerDone) {
    for (const owner of frozenOwnerSequence()) {
      if (!ownerReviews[owner]) ownerReviews[owner] = evaluateOwnerReview(reportDir, owner, runId);
    }
  }
  const owners_complete = {};
  let every = nearOwnerDone;
  for (const owner of frozenOwnerSequence()) {
    const complete = ownerReviews[owner]?.owner_complete === true;
    owners_complete[owner] = complete;
    if (!complete) every = false;
  }
  const idx = loadCheckpointIndex(reportDir);
  if (existsSync(join(reportDir, "shards"))) {
    for (const sid of readdirSync(join(reportDir, "shards"))) {
      for (const [id, row] of loadCheckpointIndex(join(reportDir, "shards", sid))) idx.set(id, row);
    }
  }
  const concurrent = [...idx.values()].filter(
    (r) => r.mode === "ALL_OWNERS_CONCURRENT" && r.status === "PASS",
  );
  const complete = merge.complete === true && merge.merge_ok === true;
  return evaluateGlobalCeiling({
    expected_cell_count: merge.expected_cell_count ?? 14616,
    valid_cell_count: merge.pass_cell_count ?? 0,
    missing: merge.missing_count ?? 0,
    duplicates: 0,
    invalid_environment: (merge.invalid || []).length,
    interference: 0,
    legacy_checkpoint_cells_used: merge.invalid_legacy_checkpoint_count ?? 0,
    cross_environment_w1_w2_pairs: 0,
    execution_failures: merge.invalid_cell_count ?? 0,
    unresolved_cells: merge.missing_count ?? 0,
    every_required_owner_complete: every,
    all_owners_concurrent_complete: concurrent.length === cellsPerOwner() && every,
    required_30_120_present: complete,
    required_repetitions_present: complete,
    required_distributions_present: complete,
    required_batches_present: complete,
    required_client_thread_pairs_present: complete,
    required_latency_stat_samples_present: complete,
    merge_validation_pass: merge.merge_ok === true && (merge.invalid || []).length === 0,
  });
}

async function applyAction(decision, ctx) {
  if (decision.action === "GENERATE_OWNER_REVIEW") {
    writeOwnerReviewArtifacts(reportDir, decision.generate_owner_review, runId);
    const written = new Set(ctx.owner_reviews_written || []);
    written.add(decision.generate_owner_review);
    ctx.owner_reviews_written = [...written];
    return;
  }
  if (decision.action === "STALL_RESTART") {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    writeJsonAtomic(join(incidentsDir, `${ts}.json`), {
      at: new Date().toISOString(),
      cell_id: ctx.cell_id,
      executed: ctx.executed,
      owner_valid_cells: ctx.owner_valid_cells,
      runner_pids: ctx.runner_pids,
      pgbench_pids: ctx.pgbench_pids,
      environment_fingerprint: ctx.frozen_identity.environment_fingerprint,
      last_progress_at_ms: ctx.last_progress_at_ms,
      stdout_stderr_tail: logTail(logPath),
      restart_number: ctx.restarts_for_current_cell + 1,
    });
    await terminatePids([...ctx.runner_pids, ...ctx.pgbench_pids]);
    launchRunner(decision.launch_env);
    return;
  }
  if (decision.action === "LAUNCH") {
    launchRunner(decision.launch_env);
    return;
  }
  if (decision.action === "COMPLETE") {
    const written = writeMergedArtifacts(reportDir);
    if (!written.written) process.exit(2);
    writeJsonAtomic(join(reportDir, "gate3-completion.json"), {
      schema: "record-platform-gate3-completion/v1",
      pgbench_ceiling_complete: written.written === true,
      git_sha: ctx.frozen_identity.git_sha,
      catalog_sha: ctx.frozen_identity.catalog_sha,
      environment_identity: ctx.frozen_identity.environment_fingerprint,
      expected_cell_count: 14616,
      valid_cell_count: written.completeness?.pass_cell_count ?? null,
      merge_written: written.written === true,
      shas: written.shas || {},
      protocol_execution_authorized: false,
      execution_authorized: false,
      end_harness_execution_authorized: false,
      track_c_acceptance_pass: false,
      platform_pass: false,
      tuning: "NO_GO",
      protocol: "NO_GO",
    });
  }
}

async function main() {
  acquireLock();
  let state = readJson(statePath, {});
  if (!state.frozen_identity) {
    state.frozen_identity = observeIdentity();
    writeJsonAtomic(statePath, state);
  }

  const ownerReviewsWritten = new Set(state.owner_reviews_written || []);
  for (const name of existsSync(join(reportDir, "owner-reviews"))
    ? readdirSync(join(reportDir, "owner-reviews"))
    : []) {
    const m = /^([a-z_]+)-owner-review\.json$/.exec(name);
    if (!m) continue;
    const doc = readJson(join(reportDir, "owner-reviews", name), null);
    if (doc?.owner_complete === true) ownerReviewsWritten.add(m[1]);
  }

  while (true) {
    const observed = observeIdentity();
    if (observed.warmup_seconds !== CONTRACT_WARMUP_SECONDS) process.exit(2);
    if (observed.measured_seconds !== CONTRACT_MEASURED_SECONDS) process.exit(2);
    if (observed.workload_revision !== WORKLOAD_REVISION) process.exit(2);
    const identity = assertFrozenRunIdentity(state.frozen_identity, observed);
    if (!identity.ok) {
      console.error(JSON.stringify({ error: identity.code, field: identity.field, identity }));
      process.exit(2);
    }

    const now = Date.now();
    const runnerLines = pgrep("run-pgbench-matrix").filter((l) => l.includes("run-pgbench-matrix"));
    const pgbenchLines = pgrep("pgbench -h").filter((l) => /\bpgbench\b/.test(l));
    const runner_pids = parsePids(runnerLines);
    const pgbench_pids = parsePids(pgbenchLines);
    const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    const events = parseProgressLog(logText);
    const last = events.length ? events[events.length - 1] : null;
    const catalog = JSON.parse(readFileSync(join(reportDir, "expected-cells.json"), "utf8"));
    const checkpoint = loadCheckpointIndex(reportDir);
    if (existsSync(join(reportDir, "shards"))) {
      for (const sid of readdirSync(join(reportDir, "shards"))) {
        for (const [id, row] of loadCheckpointIndex(join(reportDir, "shards", sid))) {
          checkpoint.set(id, row);
        }
      }
    }
    const pending_cells = nextMissingCells(catalog, checkpoint);
    const catalogProgress = nextRequiredFromCatalog(pending_cells);
    const owner =
      currentOwnerFromProgress(last, catalogProgress.next_owner || frozenOwnerSequence()[0]);
    const review =
      owner && owner !== "ALL" ? evaluateOwnerReview(reportDir, owner, runId) : { owner_complete: false, valid_owner_cells: 0, expected_owner_cells: 1218 };
    const priorHistory = readJson(historyPath, { samples: [] });
    const last_progress_at_ms = resolveSupervisorProgressAtMs({
      now_ms: now,
      log_mtime_ms: null,
      events,
      history_samples: priorHistory.samples || [],
      owner_valid_cells: review.valid_owner_cells,
    });
    const incidents = existsSync(incidentsDir)
      ? readdirSync(incidentsDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => readJson(join(incidentsDir, f), null))
          .filter(Boolean)
      : [];
    const global_ceiling = globalSnapshot(owner, review);
    const decision = decideSupervisorAction({
      now_ms: now,
      frozen_identity: state.frozen_identity,
      observed_identity: observed,
      runner_alive: runner_pids.some(isPidAlive),
      pgbench_alive: pgbench_pids.some(isPidAlive),
      runner_pids,
      pgbench_pids,
      concurrent_runner_count: runner_pids.length,
      last_progress_at_ms,
      stall_after_ms: stallAfterMs,
      owner,
      cell_id: last?.cell_id,
      executed: last?.executed,
      owner_valid_cells: review.valid_owner_cells,
      owner_expected_cells: review.expected_owner_cells,
      owner_complete: review.owner_complete === true,
      owner_reviews_written: [...ownerReviewsWritten],
      pending_cells,
      restarts_for_current_cell: countCellRestarts(incidents, last?.cell_id),
      max_restarts_per_cell: MAX_RESTARTS_PER_CELL,
      resume_dir: RESUME,
      global_valid_cells: global_ceiling.valid_cell_count,
      all_owners_concurrent_complete: global_ceiling.all_owners_concurrent_complete === true,
      global_ceiling,
      authorization: {
        protocol_execution_authorized: false,
        execution_authorized: false,
        end_harness_execution_authorized: false,
        track_c_acceptance_pass: false,
        platform_pass: false,
        tuning: "NO_GO",
        protocol: "NO_GO",
      },
    });

    const eta = estimateOwnerEta({
      owner_valid_cells: review.valid_owner_cells || 0,
      owner_expected_cells: review.expected_owner_cells || 1218,
      samples: (priorHistory.samples || [])
        .filter((s) => s.at_ms != null && s.owner_valid_cells != null)
        .map((s) => ({ at_ms: Number(s.at_ms), owner_valid_cells: Number(s.owner_valid_cells) })),
      fallback_seconds_per_cell: 150,
    });

    const etaGlobal = estimateOwnerEta({
      owner_valid_cells: global_ceiling.valid_cell_count || 0,
      owner_expected_cells: 14616,
      samples: (priorHistory.samples || [])
        .filter((s) => s.at_ms != null && s.global_valid_cells != null)
        .map((s) => ({ at_ms: Number(s.at_ms), owner_valid_cells: Number(s.global_valid_cells) })),
      fallback_seconds_per_cell: 150,
    });

    const report = {
      schema: "record-platform-pgbench-contract-supervisor/v1",
      checked_at: new Date(now).toISOString(),
      action: decision.action,
      owner,
      owner_valid_cells: review.valid_owner_cells,
      owner_expected_cells: review.expected_owner_cells,
      global_valid_cells: global_ceiling.valid_cell_count,
      global_expected_cells: 14616,
      current_cell: last?.cell_id || null,
      last_progress_at_ms,
      observed_sec_per_cell: eta.seconds_per_cell_observed,
      eta,
      restart_count: incidents.length,
      incident_count: incidents.length,
      runner_pids,
      pgbench_pids,
      pgbench_ceiling_complete: decision.pgbench_ceiling_complete === true,
      tuning: "NO_GO",
      protocol: "NO_GO",
    };
    console.log(JSON.stringify(report));

    await applyAction(decision, {
      ...decision,
      cell_id: last?.cell_id,
      executed: last?.executed,
      owner_valid_cells: review.valid_owner_cells,
      runner_pids,
      pgbench_pids,
      last_progress_at_ms,
      frozen_identity: state.frozen_identity,
      restarts_for_current_cell: countCellRestarts(incidents, last?.cell_id),
      owner_reviews_written: [...ownerReviewsWritten],
    });
    if (decision.generate_owner_review) ownerReviewsWritten.add(decision.generate_owner_review);

    const history = appendWatchdogHistory(priorHistory, {
      at: new Date(now).toISOString(),
      at_ms: now,
      action: decision.action,
      owner,
      owner_valid_cells: review.valid_owner_cells,
      global_valid_cells: global_ceiling.valid_cell_count,
      executed: last?.executed ?? null,
      cell_id: last?.cell_id ?? null,
      last_progress_at_ms,
    });
    writeJsonAtomic(historyPath, history);
    const status = buildSupervisorStatus({
      checked_at: report.checked_at,
      supervisor_pid: process.pid,
      runner_pid: runner_pids[0] || null,
      owner,
      current_cell: last?.cell_id || catalogProgress.next_cell?.cell_id || null,
      owner_valid: review.valid_owner_cells,
      owner_expected: review.expected_owner_cells,
      global_valid: global_ceiling.valid_cell_count,
      last_logical_progress_at: last_progress_at_ms,
      seconds_per_cell_observed: eta.seconds_per_cell_observed,
      eta_owner: eta.eta_hours_observed,
      eta_global: etaGlobal.eta_hours_observed,
      restart_count: incidents.length,
      incident_count: incidents.length,
      action: decision.action,
      pgbench_ceiling_complete: decision.pgbench_ceiling_complete === true,
    });
    writeJsonAtomic(statusPath, status);
    state = {
      frozen_identity: state.frozen_identity,
      owner_reviews_written: [...ownerReviewsWritten],
      last_action: decision.action,
      last_report: report,
    };
    writeJsonAtomic(statePath, state);

    if (decision.stop) {
      if (decision.exit_code === 2) persistFatal(decision);
      releaseOwnedLock();
      process.exit(decision.exit_code || 0);
    }
    await sleep(pollMs);
  }
}

process.on("SIGTERM", () => {
  releaseOwnedLock();
  process.exit(0);
});
process.on("SIGINT", () => {
  releaseOwnedLock();
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
