#!/usr/bin/env node
/**
 * Phase 32H-R1 — launch baseline or caffeinate-protected validation arm.
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
import {
  evidenceLabelForArm,
  rootForArm,
  R1_CANARY_TOTAL,
  R1_CANARY_PER_PROTOCOL,
} from './lib/phase32h-r1-config.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';
import { runBaselineLaunchPreflight } from './lib/phase32h-baseline-launch-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { arm: 'baseline', out: null, skipPreflight: false, canary: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--arm') opts.arm = argv[++i];
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--skip-preflight') opts.skipPreflight = true;
    if (argv[i] === '--canary') opts.canary = true;
  }
  opts.out = opts.out || rootForArm(opts.arm, { canary: opts.canary });
  return opts;
}

function recordPowerSnapshot(outRoot) {
  const dir = path.join(outRoot, 'power');
  fs.mkdirSync(dir, { recursive: true });
  const cmds = [
    ['date', ['-u']],
    ['uptime', []],
    ['pmset', ['-g']],
    ['pmset', ['-g', 'assertions']],
    ['pmset', ['-g', 'custom']],
    ['pmset', ['-g', 'batt']],
    ['scutil', ['--nwi']],
    ['scutil', ['--dns']],
    ['route', ['-n', 'get', 'record-platform.test']],
  ];
  const snapshot = { captured_at: new Date().toISOString(), commands: {} };
  for (const [cmd, args] of cmds) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    snapshot.commands[[cmd, ...args].join(' ')] = {
      status: r.status,
      stdout: r.stdout || '',
      stderr: r.stderr || '',
    };
  }
  fs.writeFileSync(path.join(dir, 'pre-launch-power-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

function launchTripletRunner(opts, env) {
  const logPath = path.join(opts.out, 'runner-triplet.log');
  const args = [
    path.join(REPO_ROOT, 'scripts/phase32h-r1-triplet-runner.mjs'),
    '--out',
    opts.out,
    '--arm',
    opts.arm,
  ];
  if (opts.canary) args.push('--canary');
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: ['ignore', fs.openSync(logPath, 'a'), fs.openSync(logPath, 'a')],
  });
  child.unref();
  return child.pid;
}

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

function writeManifest(outRoot, rows) {
  const manifestPath = path.join(outRoot, 'phase32h-r1-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  return manifestPath;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('R1 out must be under /tmp');

  const preflight = runBaselineLaunchPreflight(opts, {
    repoRoot: REPO_ROOT,
    skipPreflight: opts.skipPreflight,
  });

  const runId = generateRunId();
  const launchHead = preflight.headSha;
  const evidenceLabel = preflight.evidenceLabel;

  fs.mkdirSync(opts.out, { recursive: true });
  const manifestPath = writeManifest(opts.out, preflight.manifestRows);
  initRunState(opts.out, { runId, launchHead, evidenceLabel, manifestPath });
  acquireLauncherLock(opts.out, { pid: process.pid, run_id: runId, role: 'launcher' });

  recordPowerSnapshot(opts.out);

  const env = {
    ...process.env,
    PHASE32H_MATRIX_ROOT: opts.out,
    T20_EVAL_RAG_PAUSE_SEC: '0.15',
  };

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
  });
  registerPcapCollector(opts.out, {
    run_id: runId,
    launch_head: launchHead,
    manifest_sha: sha256File(manifestPath),
  });
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-gateway-log-capture.sh'), opts.out], env);
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-application-log-capture.sh'), opts.out], env);
  const watchdogPid = startDetached(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/phase32h-extreme-watchdog.mjs'), '--out', opts.out],
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

  let caffeinatePid = null;
  if (opts.arm === 'protected' || opts.arm === 'caffeinate') {
    caffeinatePid = startDetached('caffeinate', ['-dimsu', '-w', String(supervisorPid)], env);
    fs.writeFileSync(
      path.join(opts.out, 'power/caffeinate-assertion.json'),
      `${JSON.stringify(
        {
          caffeinate_pid: caffeinatePid,
          supervisor_pid: supervisorPid,
          started_at: new Date().toISOString(),
          command: `caffeinate -dimsu -w ${supervisorPid}`,
        },
        null,
        2,
      )}\n`,
    );
  }

  const tripletRunnerPid = launchTripletRunner(opts, env);
  const monitorLog = path.join(opts.out, 'phase32h-monitor.log');
  const monitorPid = startDetached(
    'bash',
    [
      '-c',
      `exec >>"${monitorLog}" 2>&1; export PHASE32H_MATRIX_ROOT="${opts.out}"; while true; do "${path.join(REPO_ROOT, 'scripts/phase32h-monitor-targeted-reproduction.sh')}"; sleep 5; done`,
    ],
    env,
  );

  const launchRecord = {
    status: 'IN_PROGRESS',
    phase: '32H-R1',
    arm: opts.arm,
    mode: opts.canary ? 'canary' : 'full',
    evidence_label: evidenceLabel,
    out: opts.out,
    run_id: readRunId(opts.out),
    launch_head: launchHead,
    manifest_sha256: sha256File(manifestPath),
    target_total: opts.canary ? R1_CANARY_TOTAL : 8640,
    target_per_protocol: opts.canary ? R1_CANARY_PER_PROTOCOL : 2880,
    triplet_batches: opts.canary ? R1_CANARY_PER_PROTOCOL : 2880,
    orchestrator: 'phase32h-r1-triplet-runner',
    supervisor_pid: supervisorPid,
    caffeinate_pid: caffeinatePid,
    watchdog_pid: watchdogPid,
    telemetry_pid: telemetryPid,
    monitor_pid: monitorPid,
    triplet_runner_pid: tripletRunnerPid,
    production_enablement: 'NOT APPROVED',
  };
  fs.writeFileSync(
    path.join(opts.out, 'phase32h-r1-launch.json'),
    `${JSON.stringify(launchRecord, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(launchRecord, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
