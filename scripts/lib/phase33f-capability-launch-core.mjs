/**
 * Shared Phase 33F capability-gauntlet launch orchestration.
 * Used by canary launcher, target launcher, and target-launcher smoke.
 * Does not encode owner-approval policy (callers enforce that before invoke).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  acquireLauncherLock,
  generateRunId,
  initRunState,
  readRunId,
  sha256File,
} from './phase32h-run-integrity.mjs';
import { registerPcapCollector } from './phase32h-collector-registry.mjs';
import { writeManifest } from './phase33f-canary-manifest.mjs';
import { dimensionsForMode } from './phase33f-canary-config.mjs';
import { runCapabilityMatrix } from './phase33f-capability-runner.mjs';
import { finalizePhase33fRun } from './phase33f-run-finalize.mjs';
import { evaluateTerminalVerdictWithDelay } from './phase33f-terminal-verdict.mjs';
import {
  INTER_BATCH_INTERVAL_MS,
  assertTargetInterBatchInterval,
} from './phase33f-rate-limit.mjs';
import {
  formatHumanCheckpointLine,
  shouldEmitHumanCheckpoint,
  summarizeRunnerResult,
} from './phase33f-human-checkpoint.mjs';
import {
  buildBoundedFinalization,
  writeBoundedFinalizationReports,
} from './phase34-bounded-finalization.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export { formatHumanCheckpointLine, shouldEmitHumanCheckpoint, summarizeRunnerResult };

export function startDetached(cmd, args, env = process.env, { cwd = REPO_ROOT } = {}) {
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

/**
 * Create evidence root, pin manifest, start collectors, run synchronized H1/H2/H3 matrix,
 * evaluate dual terminal snapshots, and freeze PASS/BLOCKED.
 */
export async function runPhase33fCapabilityLaunch({
  out,
  mode,
  rows,
  manifestSha,
  headSha,
  repoRoot = REPO_ROOT,
  limit = null,
  interBatchIntervalMs = null,
  enforceTargetPacing = false,
  caCert = null,
  evidenceLabel = null,
  skipCollectors = false,
  /** Optional override for Phase 34 live gauntlet (20k logical / 2,500 per capability). */
  batchesPerCapabilityOverride = null,
  verdictDelayMs = Number(process.env.PHASE33F_VERDICT_DELAY_MS || 5000),
} = {}) {
  if (!out?.startsWith('/tmp/')) {
    throw new Error(`out must be under /tmp: ${out}`);
  }
  if (!rows?.length) {
    throw new Error('launch requires validated manifest rows');
  }
  if (!manifestSha) {
    throw new Error('launch requires manifestSha');
  }
  if (!headSha) {
    throw new Error('launch requires headSha');
  }

  const dims = dimensionsForMode(mode === 'target-smoke' ? 'smoke' : mode);
  let pacedMs = interBatchIntervalMs;
  if (pacedMs == null) {
    if (mode === 'canary' || mode === 'target' || mode === 'target-smoke') {
      pacedMs = INTER_BATCH_INTERVAL_MS;
    } else {
      pacedMs = 0;
    }
  }
  if (enforceTargetPacing || mode === 'target' || mode === 'target-smoke') {
    assertTargetInterBatchInterval(pacedMs);
  }

  fs.mkdirSync(out, { recursive: true });
  const batchesPerCapability =
    batchesPerCapabilityOverride != null
      ? Number(batchesPerCapabilityOverride)
      : mode === 'target'
        ? dims.batchesPerCapability
        : mode === 'target-smoke'
          ? 3
          : dims.batchesPerCapability;
  const manifestPath = path.join(out, 'phase33f-capability-manifest.json');
  writeManifest(manifestPath, rows, { batchesPerCapability });
  const runId = generateRunId();
  initRunState(out, {
    runId,
    launchHead: headSha,
    evidenceLabel: evidenceLabel || `Phase 33F ${mode} capability gauntlet`,
    manifestPath,
  });
  acquireLauncherLock(out, { pid: process.pid, run_id: runId, role: 'launcher' });

  const env = {
    ...process.env,
    PHASE33F_MATRIX_ROOT: out,
    CA_CERT:
      caCert ||
      process.env.CA_CERT ||
      (fs.existsSync(path.join(repoRoot, 'certs/dev-chain.pem'))
        ? path.join(repoRoot, 'certs/dev-chain.pem')
        : process.env.CA_CERT),
  };

  let supervisorPid = null;
  let telemetryPid = null;
  if (!skipCollectors) {
    spawnSync('bash', [path.join(repoRoot, 'scripts/phase32h-start-pcap-capture.sh'), out], {
      cwd: repoRoot,
    });
    registerPcapCollector(out, {
      run_id: runId,
      launch_head: headSha,
      manifest_sha: sha256File(manifestPath),
    });
    startDetached('bash', [path.join(repoRoot, 'scripts/phase32h-start-gateway-log-capture.sh'), out], env, {
      cwd: repoRoot,
    });
    startDetached(
      'bash',
      [path.join(repoRoot, 'scripts/phase32h-start-application-log-capture.sh'), out],
      env,
      { cwd: repoRoot },
    );
    telemetryPid = startDetached(
      'bash',
      [path.join(repoRoot, 'scripts/phase32h-capture-host-telemetry.sh'), out],
      env,
      { cwd: repoRoot },
    );
    supervisorPid = startDetached(
      process.execPath,
      [path.join(repoRoot, 'scripts/phase32h-collector-supervisor.mjs'), '--out', out],
      env,
      { cwd: repoRoot },
    );
  }

  const runnerMode = mode === 'target' || mode === 'target-smoke' ? 'canary' : mode;
  let runnerResult;
  try {
    runnerResult = await runCapabilityMatrix({
      rows,
      outRoot: out,
      mode: runnerMode,
      runId,
      launchHead: headSha,
      manifestSha,
      limit,
      caCert: env.CA_CERT,
      interBatchIntervalMs: pacedMs,
    });
  } catch (err) {
    finalizePhase33fRun({
      outRoot: out,
      repoRoot,
      status: 'BLOCKED',
      failureClass: err.code || 'RUNNER_EXCEPTION',
      failureDetails: { message: err.message },
      mode,
      launchHead: headSha,
      manifestSha,
      supervisorPid,
      telemetryPid,
    });
    throw err;
  }

  const expectedProbes = limit || rows.length;
  const expectedBatches = limit ? Math.ceil(expectedProbes / 3) : Math.floor(rows.length / 3);
  const verdict = await evaluateTerminalVerdictWithDelay(out, {
    expectedProbes,
    expectedBatches,
    delayMs: verdictDelayMs,
  });

  const runnerSummary = summarizeRunnerResult(runnerResult);
  const bounded = buildBoundedFinalization(out, {
    expectedLogicalSessions: expectedBatches,
    expectedProtocolRows: expectedProbes,
    runnerSummary,
  });
  const written = writeBoundedFinalizationReports(out, bounded);

  // Protocol-row acceptance is authoritative; queue COMPLETE alone cannot PASS.
  const pass =
    runnerResult.status === 'PASS' &&
    verdict.status === 'PASS' &&
    bounded.acceptance.status === 'PASS' &&
    bounded.acceptance.protocol_rows_fail === 0 &&
    bounded.acceptance.logical_sessions_fail === 0;

  const failureClass = pass
    ? null
    : runnerResult.failure_class ||
      (bounded.acceptance.protocol_rows_fail > 0
        ? 'PROTOCOL_ROW_FAILURE'
        : verdict.flags?.matrix_complete === false
          ? 'UNEXPECTED_PROBE_FAILURE'
          : 'TERMINAL_VERDICT_FAIL');

  const boundedVerdict = {
    status: verdict.status,
    matching_snapshots: verdict.matching_snapshots,
    acceptance: bounded.acceptance,
    summary_path: path.relative(out, written.summaryPath),
    failure_index_path: path.relative(out, written.failureIndexPath),
    summary_bytes: written.summaryBytes,
  };

  const freeze = finalizePhase33fRun({
    outRoot: out,
    repoRoot,
    status: pass ? 'PASS' : 'BLOCKED',
    failureClass,
    failureDetails: pass
      ? null
      : {
          runner: runnerSummary,
          verdict: boundedVerdict,
          protocol_failures: bounded.failures.slice(0, 50),
        },
    mode,
    launchHead: headSha,
    manifestSha,
    runner: runnerSummary,
    verdict: boundedVerdict,
    supervisorPid,
    telemetryPid,
  }).freeze;

  const launchRecord = {
    status: pass ? 'PASS' : 'FAIL',
    phase: '33F',
    mode,
    out,
    run_id: readRunId(out),
    launch_head: headSha,
    manifest_sha256: manifestSha,
    target_total: expectedProbes,
    triplet_batches: expectedBatches,
    inter_batch_interval_ms: pacedMs,
    freeze,
    production_enablement: 'NOT APPROVED',
    runner: {
      status: runnerResult.status,
      failure_class: runnerResult.failure_class || null,
      http_429: runnerResult.http_429 ?? null,
    },
    verdict: boundedVerdict,
    acceptance: bounded.acceptance,
  };
  fs.writeFileSync(path.join(out, 'phase33f-launch.json'), `${JSON.stringify(launchRecord, null, 2)}\n`, 'utf8');
  return { pass, launchRecord, runnerResult: runnerSummary, verdict: boundedVerdict, freeze, runId, acceptance: bounded.acceptance };
}
