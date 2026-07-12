#!/usr/bin/env node
/**
 * Phase 32H-R1-C2 — 60-probe synchronized repair smoke after manifest-contract hardening.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  acquireLauncherLock,
  assertLaunchableEvidenceRoot,
  generateRunId,
  initRunState,
  readRunId,
  sha256File,
} from './lib/phase32h-run-integrity.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';
import { assertManifestContract } from './lib/phase32h-manifest-contract.mjs';
import {
  REPAIR_SMOKE_EVIDENCE_LABEL,
  buildRepairSmokeManifest,
} from './lib/phase32h-repair-smoke-manifest.mjs';
import { runTripletMatrix } from './phase32h-r1-triplet-runner.mjs';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
export const REPAIR_SMOKE_ROOT = '/tmp/phase32h-r1-preview-422-repair-smoke-v1';

function parseArgs(argv) {
  const opts = { out: REPAIR_SMOKE_ROOT, skipPreflight: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--skip-preflight') opts.skipPreflight = true;
    if (argv[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

function summarizeRepairSmoke(outRoot) {
  const shards = ['h1', 'h2', 'h3'];
  const rows = shards.flatMap((proto) =>
    loadJsonl(path.join(outRoot, `shard-${proto}`, 'phase32h-matrix.jsonl')),
  );
  const perProtocol = Object.fromEntries(
    shards.map((proto) => [proto, rows.filter((r) => r.matrix_protocol === proto).length]),
  );
  const http200 = rows.filter((r) => Number(r.http_status) === 200).length;
  const http422 = rows.filter((r) => Number(r.http_status) === 422).length;
  const deterministic4xx = rows.filter((r) => r.deterministic_4xx === true || r.failure_class === 'deterministic').length;
  const wrongGate = rows.filter((r) => r.gate_reason !== r.expected_gate_reason).length;
  const contractRows = rows.filter((r) => r.expected_gate_reason === 'allowlist');
  const previewRows = rows.filter((r) => r.expected_gate_reason === 'preview_opt_in');
  const redTeamRows = rows.filter((r) => r.red_team_case);
  const summary = {
    status: 'BLOCKED',
    total: rows.length,
    per_protocol: perProtocol,
    http_200: http200,
    http_422: http422,
    deterministic_4xx: deterministic4xx,
    wrong_gate: wrongGate,
    contract_allowlist_observed: contractRows.every((r) => r.gate_reason === 'allowlist'),
    preview_opt_in_observed: previewRows.every((r) => r.gate_reason === 'preview_opt_in'),
    retries: rows.reduce((sum, r) => sum + Number(r.retry_count || r.timing?.retry_count || 0), 0),
    response_pass: rows.filter((r) => r.response_pass === 'PASS').length,
    sentiment_pass: rows.filter((r) => r.sentiment_pass === 'PASS' || r.sentiment_pass === 'SKIP').length,
    red_team_safety_pass:
      redTeamRows.length === 0
        ? rows.length
        : redTeamRows.filter((r) => r.response_pass === 'PASS').length,
    red_team_rows: redTeamRows.length,
  };
  const pass =
    summary.total === 60 &&
    perProtocol.h1 === 20 &&
    perProtocol.h2 === 20 &&
    perProtocol.h3 === 20 &&
    http200 === 60 &&
    http422 === 0 &&
    deterministic4xx === 0 &&
    wrongGate === 0 &&
    summary.retries === 0 &&
    summary.contract_allowlist_observed &&
    summary.preview_opt_in_observed &&
    summary.response_pass === 60 &&
    summary.sentiment_pass === 60 &&
    (redTeamRows.length === 0 || summary.red_team_safety_pass === redTeamRows.length);
  summary.status = pass ? 'PASS' : 'BLOCKED';
  return summary;
}

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertLaunchableEvidenceRoot(opts.out);
  if (!opts.out.startsWith('/tmp/')) throw new Error('repair smoke out must be under /tmp');
  if (fs.existsSync(path.join(opts.out, 'FROZEN_BLOCKED_EVIDENCE'))) {
    throw new Error('refusing repair smoke in frozen evidence root');
  }
  if (fs.existsSync(opts.out) && fs.readdirSync(opts.out).length > 0) {
    throw new Error(`evidence root ${opts.out} must be fresh`);
  }

  if (!opts.skipPreflight) {
    const preflight = spawnSync('make', ['ai-platform-verify-phase32h-manifest-contract'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (preflight.status !== 0) {
      console.error(preflight.stderr || preflight.stdout);
      process.exit(2);
    }
  }

  const repair = buildRepairSmokeManifest();
  const contractReport = assertManifestContract(repair.rows, {
    evidenceLabel: repair.evidence_label,
    expectedTotal: repair.target_total,
    expectedPerProtocol: repair.target_per_protocol,
  });

  const runId = generateRunId();
  const launchHead = gitSha();
  fs.mkdirSync(opts.out, { recursive: true });
  const manifestPath = path.join(opts.out, 'phase32h-r1-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${repair.rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  initRunState(opts.out, { runId, launchHead, evidenceLabel: repair.evidence_label, manifestPath });
  acquireLauncherLock(opts.out, { pid: process.pid, run_id: runId, role: 'repair-smoke-launcher' });

  const launchRecord = {
    status: 'PREFLIGHT_PASS',
    phase: '32H-R1-C2',
    evidence_label: REPAIR_SMOKE_EVIDENCE_LABEL,
    out: opts.out,
    run_id: readRunId(opts.out),
    launch_head: launchHead,
    manifest_sha256: sha256File(manifestPath),
    manifest_contract: contractReport,
    target_total: repair.target_total,
    target_per_protocol: repair.target_per_protocol,
    triplet_batches: repair.triplet_batches,
  };
  fs.writeFileSync(path.join(opts.out, 'phase32h-r1-repair-smoke-launch.json'), `${JSON.stringify(launchRecord, null, 2)}\n`);

  if (opts.dryRun) {
    console.log(JSON.stringify({ status: 'PASS', mode: 'dry-run', ...launchRecord }, null, 2));
    return;
  }

  const env = {
    ...process.env,
    PHASE32H_MATRIX_ROOT: opts.out,
    T20_EVAL_RAG_PAUSE_SEC: '0.15',
  };

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
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

  await runTripletMatrix({
    out: opts.out,
    arm: 'baseline',
    canary: false,
    evidenceLabel: repair.evidence_label,
    expectedTotal: repair.target_total,
    expectedPerProtocol: repair.target_per_protocol,
  });

  const summary = summarizeRepairSmoke(opts.out);
  summary.run_id = readRunId(opts.out);
  summary.launch_head = launchHead;
  summary.manifest_sha256 = sha256File(manifestPath);
  summary.watchdog_pid = watchdogPid;
  summary.telemetry_pid = telemetryPid;
  summary.supervisor_pid = supervisorPid;
  fs.writeFileSync(path.join(opts.out, 'phase32h-r1-repair-smoke-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.status === 'PASS' ? 0 : 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
