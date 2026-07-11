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
  const opts = { out: `${DEFAULT_PHASE32H_OUT}-capture-smoke` };
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

function fileHasLines(filePath, minLines = 1) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).length >= minLines;
}

function chmodbpfCheck() {
  const check = spawnSync('bash', ['-c', 'source scripts/lib/phase32h-pcap-chmodbpf.sh && phase32h_assert_chmodbpf'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const iface = spawnSync('bash', ['-c', 'source scripts/lib/phase32h-pcap-chmodbpf.sh && phase32h_resolve_capture_iface'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return {
    ok: check.status === 0,
    stderr: check.stderr,
    iface: (iface.stdout || '').trim(),
  };
}

function probeGateSummary(rows, proto) {
  const subset = rows.filter((r) => r.matrix_protocol === proto);
  const contract = subset.find((r) => r.expected_gate_reason === 'allowlist');
  const preview = subset.find((r) => r.expected_gate_reason === 'preview_opt_in');
  const ok = (row) =>
    row &&
    row.http_status === 200 &&
    row.version_ok !== false &&
    row.gate_reason === row.expected_gate_reason &&
    row.timing?.wall_total_ms != null;
  return {
    contract: contract ? ok(contract) : false,
    preview: preview ? ok(preview) : false,
    contract_probe_id: contract?.probe_id ?? null,
    preview_probe_id: preview?.probe_id ?? null,
  };
}

function logCoverage(logPath) {
  if (!fs.existsSync(logPath)) return { status: 'MISSING', lines: 0 };
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
  if (lines < 5) return { status: 'PARTIAL', lines };
  return { status: 'ACTIVE', lines };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('smoke out must be under /tmp');
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.mkdirSync(opts.out, { recursive: true });

  const bpf = chmodbpfCheck();
  if (!bpf.ok) {
    const blocked = { status: 'BLOCKED', reason: 'ChmodBPF prerequisites failed', detail: bpf.stderr };
    console.error(JSON.stringify(blocked, null, 2));
    process.exit(2);
  }

  const previewUser = loadN5Participants().find((u) => u.user_class === 'real_participant');
  const smokeRows = buildPhase32hSmokeManifest(previewUser);
  const manifestPath = path.join(opts.out, 'phase32h-smoke-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${smokeRows.map((r) => JSON.stringify(r)).join('\n')}\n`);

  const smokeStartedAt = new Date().toISOString();
  const pcapStart = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const pcapStatusPath = path.join(opts.out, 'pcap/capture-status.json');
  let pcapStatus = { status: 'MISSING' };
  if (fs.existsSync(pcapStatusPath)) {
    pcapStatus = JSON.parse(fs.readFileSync(pcapStatusPath, 'utf8'));
  }
  if (pcapStatus.status === 'BLOCKED' || pcapStart.status !== 0) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: pcapStatus.reason || pcapStart.stderr }, null, 2));
    process.exit(2);
  }

  const env = { ...process.env, PHASE32H_MATRIX_ROOT: opts.out };
  startDetached(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32h-extreme-watchdog.mjs'), '--out', opts.out], env);
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), opts.out], env);
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-gateway-log-capture.sh'), opts.out], env);
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-application-log-capture.sh'), opts.out], env);

  // Allow collectors to start before probes.
  spawnSync('sleep', ['2']);

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

  const pcapStop = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const pcapValidate = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-validate-pcap-smoke.sh'), opts.out], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  let pcapValidation = { status: 'BLOCKED' };
  const pcapValidationPath = path.join(opts.out, 'pcap/pcap-smoke-validation.json');
  if (fs.existsSync(pcapValidationPath)) {
    pcapValidation = JSON.parse(fs.readFileSync(pcapValidationPath, 'utf8'));
  }

  const gatewayCoverage = logCoverage(path.join(opts.out, 'logs/gateway-access-tail.txt'));
  const applicationCoverage = logCoverage(path.join(opts.out, 'logs/application-log-tail.txt'));
  const hostTelemetry = fileHasLines(path.join(opts.out, 'telemetry/host-telemetry.jsonl'), 3);
  const powerTelemetry =
    fileHasLines(path.join(opts.out, 'telemetry/power-events.jsonl'), 0) ||
    fs.existsSync(path.join(opts.out, 'telemetry/host-baseline.txt'));

  const gates = {
    http_200: rows.every((r) => r.http_status === 200),
    wrong_protocol: rows.filter((r) => r.version_ok === false).length,
    wrong_gate: rows.filter((r) => r.gate_reason !== r.expected_gate_reason).length,
    timing_complete: rows.every((r) => r.timing?.wall_total_ms != null),
    inflight_archive: fs.existsSync(path.join(opts.out, 'inflight', 'archive')),
    runner_heartbeats: ['h1', 'h2', 'h3'].every((p) =>
      fileHasLines(path.join(opts.out, 'heartbeats', `${p}.jsonl`), 1),
    ),
    watchdog_heartbeat: fileHasLines(path.join(opts.out, 'heartbeats', 'watchdog.jsonl'), 0),
    pcap_started_before_probes: pcapStatus.status === 'ACTIVE' && Boolean(pcapStatus.started_at),
    pcap_stopped_cleanly: pcapStop.status === 0,
    pcap_sha_manifest: fs.existsSync(path.join(opts.out, 'pcap/pcap-sha256-manifest.json')),
    tcp_443: (pcapValidation.tcp_443_packets ?? 0) > 0,
    udp_443: (pcapValidation.udp_443_packets ?? 0) > 0,
    transport_validator: pcapValidation.transport_validator_pass === 1,
    gateway_log_coverage: gatewayCoverage.status,
    application_log_coverage: applicationCoverage.status,
    host_telemetry: hostTelemetry,
    power_telemetry: powerTelemetry,
    private_scan: scanPrivateFields(rows).pass,
  };

  const h1 = probeGateSummary(rows, 'h1');
  const h2 = probeGateSummary(rows, 'h2');
  const h3 = probeGateSummary(rows, 'h3');

  const status =
    rows.length === 6 &&
    gates.http_200 &&
    gates.wrong_protocol === 0 &&
    gates.wrong_gate === 0 &&
    gates.timing_complete &&
    gates.inflight_archive &&
    gates.runner_heartbeats &&
    gates.pcap_started_before_probes &&
    gates.pcap_stopped_cleanly &&
    gates.pcap_sha_manifest &&
    gates.tcp_443 &&
    gates.udp_443 &&
    gates.transport_validator &&
    gates.host_telemetry &&
    gates.power_telemetry &&
    gates.private_scan &&
    h1.contract &&
    h1.preview &&
    h2.contract &&
    h2.preview &&
    h3.contract &&
    h3.preview &&
    failures.length === 0
      ? 'PASS'
      : 'BLOCKED';

  const report = {
    status,
    phase: '32H-E2',
    evidence_label: PHASE32H_EVIDENCE_LABEL,
    out: opts.out,
    smoke_started_at: smokeStartedAt,
    smoke_finished_at: new Date().toISOString(),
    capture_interface: pcapStatus.iface || bpf.iface,
    chmodbpf: true,
    probes: rows.length,
    h1,
    h2,
    h3,
    gates,
    pcap_validation: pcapValidation,
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
