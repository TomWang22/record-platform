#!/usr/bin/env node
/**
 * Phase 32H-E2 — six-probe capture-integrity smoke (contract + preview × H1/H2/H3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadN5Participants } from './lib/phase22-full-replay-common.mjs';
import { DEFAULT_PHASE32H_OUT, PHASE32H_EVIDENCE_LABEL } from './lib/phase32h-targeted-reproduction-config.mjs';
import { buildPhase32hSmokeManifest } from './lib/phase32h-smoke-manifest.mjs';
import { runPhase32hTargeted } from './phase32h-targeted-reproduction-runner.mjs';
import { watchdogTick } from './phase32h-extreme-watchdog.mjs';
import { scanPrivateFields } from './lib/phase32h-targeted-summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: `${DEFAULT_PHASE32H_OUT}-smoke-${Date.now()}` };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('smoke out must be under /tmp');
  fs.mkdirSync(opts.out, { recursive: true });

  const previewUser = loadN5Participants().find((u) => u.user_class === 'real_participant');
  const smokeRows = buildPhase32hSmokeManifest(previewUser);
  const manifestPath = path.join(opts.out, 'phase32h-smoke-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${smokeRows.map((r) => JSON.stringify(r)).join('\n')}\n`);

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
  });
  const pcapStatusPath = path.join(opts.out, 'pcap/capture-status.json');
  if (fs.existsSync(pcapStatusPath)) {
    const pcapStatus = JSON.parse(fs.readFileSync(pcapStatusPath, 'utf8'));
    if (pcapStatus.status === 'BLOCKED') {
      console.error(JSON.stringify({ status: 'BLOCKED', reason: pcapStatus.reason }, null, 2));
      process.exit(2);
    }
  }

  const env = { ...process.env, PHASE32H_MATRIX_ROOT: opts.out };
  startDetached(process.execPath, [
    path.join(REPO_ROOT, 'scripts/phase32h-extreme-watchdog.mjs'),
    '--out',
    opts.out,
  ], env);
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), opts.out], env);

  const failures = [];
  for (const proto of ['h1', 'h2', 'h3']) {
    const protoRows = smokeRows.filter((r) => r.matrix_protocol === proto);
    const protoManifest = path.join(opts.out, `phase32h-smoke-${proto}.jsonl`);
    fs.writeFileSync(protoManifest, `${protoRows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const result = runPhase32hTargeted({
      protocol: proto,
      out: opts.out,
      manifest: protoManifest,
      smoke: true,
      resume: false,
      failFast: true,
    });
    if (result.failures.length) failures.push(...result.failures);
  }

  watchdogTick(opts.out);

  const rows = [];
  for (const proto of ['h1', 'h2', 'h3']) {
    const file = path.join(opts.out, `shard-${proto}`, 'phase32h-matrix.jsonl');
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (line) rows.push(JSON.parse(line));
      }
    }
  }

  const gates = {
    http_200: rows.every((r) => r.http_status === 200),
    wrong_protocol: rows.filter((r) => r.protocol_mismatch).length,
    wrong_gate: rows.filter((r) => r.gate_reason !== r.expected_gate_reason).length,
    timing_complete: rows.every((r) => r.timing?.wall_total_ms != null),
    inflight_archive: fs.existsSync(path.join(opts.out, 'inflight', 'archive')),
    heartbeats: ['h1', 'h2', 'h3'].every((p) =>
      fs.existsSync(path.join(opts.out, 'heartbeats', `${p}.jsonl`)),
    ),
    host_telemetry: fs.existsSync(path.join(opts.out, 'telemetry', 'host-telemetry.jsonl')),
    private_scan: scanPrivateFields(rows).pass,
  };

  const status =
    rows.length === 6 &&
    gates.http_200 &&
    gates.wrong_protocol === 0 &&
    gates.wrong_gate === 0 &&
    gates.timing_complete &&
    gates.heartbeats &&
    gates.host_telemetry &&
    gates.private_scan &&
    failures.length === 0
      ? 'PASS'
      : 'BLOCKED';

  const report = {
    status,
    phase: '32H-E2',
    evidence_label: PHASE32H_EVIDENCE_LABEL,
    out: opts.out,
    probes: rows.length,
    gates,
    failures,
    production_enablement: 'NOT APPROVED',
  };
  fs.writeFileSync(path.join(opts.out, 'phase32h-smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(status === 'PASS' ? 0 : 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
