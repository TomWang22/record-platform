#!/usr/bin/env node
/**
 * Phase 33F — committed capability-gauntlet canary / smoke launcher.
 * Does NOT create REAL_CANARY_ROOT unless PHASE33F_OWNER_LAUNCH_APPROVED_SHA === HEAD.
 * This implementation pass never sets that env.
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
} from './lib/phase32h-run-integrity.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';
import {
  REAL_CANARY_ROOT,
  REAL_TARGET_ROOT,
  SMOKE_ROOT,
  dimensionsForMode,
  isRealGauntletRoot,
} from './lib/phase33f-canary-config.mjs';
import { writeManifest, hashManifest } from './lib/phase33f-canary-manifest.mjs';
import {
  runPhase33fCanaryPreflight,
  assertRealGauntletRootsAbsent,
  offlineAuthSmokeStub,
  offlineQuicPcapPreflightStub,
  PRELAUNCH_BLOCKED_CODE,
} from './lib/phase33f-canary-preflight.mjs';
import { liveAuthSmoke } from './lib/phase33f-auth-smoke.mjs';
import { liveQuicPcapPreflight } from './lib/phase33f-quic-pcap-preflight.mjs';
import { runCapabilityMatrix } from './lib/phase33f-capability-runner.mjs';
import { finalizePhase33fRun } from './lib/phase33f-run-finalize.mjs';
import { evaluateTerminalVerdictWithDelay } from './lib/phase33f-terminal-verdict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    out: null,
    mode: 'smoke',
    skipPreflight: false,
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--mode') opts.mode = argv[++i];
    else if (a === '--skip-preflight') opts.skipPreflight = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
  }
  if (!opts.out) {
    opts.out = opts.mode === 'smoke' ? SMOKE_ROOT : REAL_CANARY_ROOT;
  }
  return opts;
}

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

function refuseRealRootWithoutOwnerApproval(out, headSha) {
  if (!isRealGauntletRoot(out)) return;
  const approved = process.env.PHASE33F_OWNER_LAUNCH_APPROVED_SHA || '';
  if (!approved || approved !== headSha) {
    const err = new Error(
      `refusing to create ${out}: PHASE33F_OWNER_LAUNCH_APPROVED_SHA must equal HEAD (${headSha})`,
    );
    err.code = PRELAUNCH_BLOCKED_CODE;
    throw err;
  }
  if (out === REAL_TARGET_ROOT) {
    const err = new Error('target root launch is not authorized from canary launcher');
    err.code = PRELAUNCH_BLOCKED_CODE;
    throw err;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) {
    throw new Error('out must be under /tmp');
  }

  assertRealGauntletRootsAbsent();

  let preflight = {
    headSha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim(),
    originMainSha: null,
    manifest_rows: null,
    manifest_sha: null,
  };

  if (!opts.skipPreflight) {
    preflight = runPhase33fCanaryPreflight({
      out: opts.out,
      mode: opts.mode,
      repoRoot: REPO_ROOT,
      skipCiApproval: opts.mode === 'smoke',
      skipDirtySourceCheck: process.env.PHASE33F_ALLOW_DIRTY_LAUNCHER === '1',
      skipEdgeHealth: process.env.PHASE33F_PREFLIGHT_OFFLINE === '1',
      skipOfflineVerify: process.env.PHASE33F_SKIP_OFFLINE_VERIFY === '1',
      skipCoverage: process.env.PHASE33F_SKIP_COVERAGE === '1',
      skipSemantic: process.env.PHASE33F_SKIP_SEMANTIC === '1',
      skipAttribution: process.env.PHASE33F_SKIP_ATTRIBUTION === '1',
      skipDiskPreflight: opts.mode === 'smoke' || process.env.PHASE33F_SKIP_DISK === '1',
      skipCollectorExclusivity: process.env.PHASE33F_SKIP_EXCLUSIVITY === '1',
      ...(process.env.PHASE33F_PREFLIGHT_OFFLINE === '1'
        ? {
            runAuthSmoke: offlineAuthSmokeStub,
            runQuicPcapPreflight: offlineQuicPcapPreflightStub,
          }
        : {
            runAuthSmoke: liveAuthSmoke,
            runQuicPcapPreflight: liveQuicPcapPreflight,
          }),
    });
  }

  refuseRealRootWithoutOwnerApproval(opts.out, preflight.headSha);

  // After preflight PASS: create out root (never real canary without owner env).
  fs.mkdirSync(opts.out, { recursive: true });
  const dims = dimensionsForMode(opts.mode);
  const rows = preflight.manifest_rows;
  if (!rows?.length) {
    throw new Error('preflight did not return manifest rows; refuse launch without validated manifest');
  }
  const manifestPath = path.join(opts.out, 'phase33f-capability-manifest.json');
  writeManifest(manifestPath, rows, { batchesPerCapability: dims.batchesPerCapability });
  const manifestSha = preflight.manifest_sha || hashManifest(rows);
  const runId = generateRunId();
  initRunState(opts.out, {
    runId,
    launchHead: preflight.headSha,
    evidenceLabel: `Phase 33F ${opts.mode} capability gauntlet`,
    manifestPath,
  });
  acquireLauncherLock(opts.out, { pid: process.pid, run_id: runId, role: 'launcher' });

  const env = {
    ...process.env,
    PHASE33F_MATRIX_ROOT: opts.out,
    CA_CERT:
      process.env.CA_CERT ||
      (fs.existsSync(path.join(REPO_ROOT, 'certs/dev-chain.pem'))
        ? path.join(REPO_ROOT, 'certs/dev-chain.pem')
        : process.env.CA_CERT),
  };

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
  });
  registerPcapCollector(opts.out, {
    run_id: runId,
    launch_head: preflight.headSha,
    manifest_sha: sha256File(manifestPath),
  });
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-gateway-log-capture.sh'), opts.out], env);
  startDetached(
    'bash',
    [path.join(REPO_ROOT, 'scripts/phase32h-start-application-log-capture.sh'), opts.out],
    env,
  );
  const telemetryPid = startDetached(
    'bash',
    [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), opts.out],
    env,
  );
  const supervisorPid = startDetached(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'), '--out', opts.out],
    env,
  );

  let runnerResult;
  try {
    runnerResult = await runCapabilityMatrix({
      rows,
      outRoot: opts.out,
      mode: opts.mode,
      runId,
      launchHead: preflight.headSha,
      manifestSha,
      limit: opts.limit,
      caCert: env.CA_CERT,
    });
  } catch (err) {
    finalizePhase33fRun({
      outRoot: opts.out,
      repoRoot: REPO_ROOT,
      status: 'BLOCKED',
      failureClass: err.code || 'RUNNER_EXCEPTION',
      failureDetails: { message: err.message },
      mode: opts.mode,
      launchHead: preflight.headSha,
      manifestSha,
      supervisorPid,
      telemetryPid,
    });
    throw err;
  }

  const verdict = await evaluateTerminalVerdictWithDelay(opts.out, {
    expectedProbes: opts.limit || dims.probes,
    expectedBatches: opts.limit ? Math.ceil((opts.limit || 0) / 3) : dims.batches,
    delayMs: Number(process.env.PHASE33F_VERDICT_DELAY_MS || 5000),
  });

  const pass = runnerResult.status === 'PASS' && verdict.status === 'PASS';
  const failureClass = pass
    ? null
    : runnerResult.failure_class ||
      (verdict.flags?.matrix_complete === false
        ? 'UNEXPECTED_PROBE_FAILURE'
        : 'TERMINAL_VERDICT_FAIL');
  const freeze = finalizePhase33fRun({
    outRoot: opts.out,
    repoRoot: REPO_ROOT,
    status: pass ? 'PASS' : 'BLOCKED',
    failureClass,
    failureDetails: pass
      ? null
      : {
          runner: runnerResult,
          verdict,
        },
    mode: opts.mode,
    launchHead: preflight.headSha,
    manifestSha,
    runner: runnerResult,
    verdict,
    supervisorPid,
    telemetryPid,
  }).freeze;

  const launchRecord = {
    status: pass ? 'PASS' : 'FAIL',
    phase: '33F',
    mode: opts.mode,
    out: opts.out,
    run_id: readRunId(opts.out),
    launch_head: preflight.headSha,
    manifest_sha256: manifestSha,
    target_total: dims.probes,
    triplet_batches: dims.batches,
    real_canary_root: REAL_CANARY_ROOT,
    real_canary_exists: fs.existsSync(REAL_CANARY_ROOT),
    freeze,
    production_enablement: 'NOT APPROVED',
  };
  fs.writeFileSync(
    path.join(opts.out, 'phase33f-launch.json'),
    `${JSON.stringify(launchRecord, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(launchRecord, null, 2));
  if (!pass) process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    const payload = {
      status: 'BLOCKED',
      code: err.code || PRELAUNCH_BLOCKED_CODE,
      message: err.message,
      details: err.details || null,
      real_canary_exists: fs.existsSync(REAL_CANARY_ROOT),
      real_target_exists: fs.existsSync(REAL_TARGET_ROOT),
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(err.code === PRELAUNCH_BLOCKED_CODE ? 3 : 1);
  });
}

export { parseArgs, refuseRealRootWithoutOwnerApproval, main };
