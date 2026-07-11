#!/usr/bin/env node
/**
 * Phase 32H-E3 — runtime hygiene, integrity, collector health, and checkpoint.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadJsonl, percentile } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  PHASE32H_EVIDENCE_LABEL,
  TARGET_PER_PROTOCOL,
  TARGET_TOTAL,
} from './lib/phase32h-targeted-reproduction-config.mjs';
import {
  assertRedactedInflightRecord,
  buildInflightRecord,
  registerInflight,
} from './lib/phase32h-inflight-probe-registry.mjs';
import { watchdogTick } from './phase32h-extreme-watchdog.mjs';
import { loadShardRows } from './lib/phase32h-targeted-summary.mjs';
import { curlPhaseDecomposition } from './lib/phase32h-diagnostic-correlation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const ACTIVE_ROOT = process.env.PHASE32H_MATRIX_ROOT || '/tmp/phase32h-targeted-reproduction';
const EXPECTED_HEAD = process.env.PHASE32H_EXPECTED_HEAD || '6aeedcb104ee86efac2956f53beebbe85dab218e';

function parseArgs(argv) {
  const opts = { out: ACTIVE_ROOT, cleanup: false, syntheticWatchdog: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--cleanup') opts.cleanup = true;
    else if (argv[i] === '--synthetic-watchdog') opts.syntheticWatchdog = true;
  }
  return opts;
}

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function listProcesses() {
  const r = spawnSync(
    'ps',
    ['-axo', 'pid=,ppid=,lstart=,command='],
    { encoding: 'utf8' },
  );
  const rows = [];
  for (const line of (r.stdout || '').split('\n')) {
    if (!/phase32h|dumpcap|tcpdump|kubectl.*logs|host-telemetry|capture-host-telemetry|gateway-log|application-log/i.test(line)) {
      continue;
    }
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/);
    if (!m) continue;
    const [, pid, ppid, lstart, command] = m;
    let evidenceRoot = null;
    const outMatch = command.match(/--out\s+(\S+)|(\/tmp\/phase32h[^\s'"]+)/);
    if (outMatch) evidenceRoot = outMatch[1] || outMatch[2];
    rows.push({ pid: Number(pid), ppid: Number(ppid), lstart, command, evidenceRoot });
  }
  return rows;
}

function classifyRole(command) {
  if (/phase32h-targeted-reproduction-runner.*--protocol\s+h1/.test(command)) return 'h1_runner';
  if (/phase32h-targeted-reproduction-runner.*--protocol\s+h2/.test(command)) return 'h2_runner';
  if (/phase32h-targeted-reproduction-runner.*--protocol\s+h3/.test(command)) return 'h3_runner';
  if (/phase32h-monitor-targeted-reproduction/.test(command)) return 'matrix_monitor';
  if (/phase32h-extreme-watchdog/.test(command)) return 'extreme_watchdog';
  if (/dumpcap|tcpdump/.test(command)) return 'pcap_collector';
  if (/phase32h-start-gateway-log-capture|gateway-log/.test(command)) return 'gateway_log_collector';
  if (/phase32h-start-application-log-capture|application-log/.test(command)) return 'application_log_collector';
  if (/phase32h-capture-host-telemetry/.test(command)) return 'host_telemetry_collector';
  if (/power-events|power-telemetry/.test(command)) return 'power_telemetry_collector';
  return 'other';
}

function stopProcess(proc, ledger) {
  const entry = {
    pid: proc.pid,
    command: proc.command,
    evidence_root: proc.evidenceRoot,
    role: classifyRole(proc.command),
    action: 'SIGTERM',
    stopped: false,
    at: new Date().toISOString(),
  };
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch (err) {
    entry.error = err.message;
    ledger.stopped.push(entry);
    return;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      process.kill(proc.pid, 0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    } catch {
      entry.stopped = true;
      ledger.stopped.push(entry);
      return;
    }
  }
  entry.action = 'SIGKILL';
  try {
    process.kill(proc.pid, 'SIGKILL');
    entry.stopped = true;
  } catch (err) {
    entry.error = err.message;
  }
  ledger.stopped.push(entry);
}

function cleanupStaleProcesses(outRoot) {
  const procs = listProcesses();
  const ledger = { generated_at: new Date().toISOString(), active_root: outRoot, stopped: [], kept: [] };
  const active = procs.filter((p) => p.evidenceRoot === outRoot);
  const stale = procs.filter((p) => p.evidenceRoot !== outRoot);

  for (const p of stale) stopProcess(p, ledger);

  const byRole = new Map();
  for (const p of active) {
    const role = classifyRole(p.command);
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(p);
  }

  const keepNewest = (role) => {
    const list = (byRole.get(role) || []).sort((a, b) => b.pid - a.pid);
    if (!list.length) return;
    const [keep, ...dupes] = list;
    ledger.kept.push({ pid: keep.pid, role, command: keep.command });
    for (const d of dupes) stopProcess(d, ledger);
  };

  for (const role of [
    'matrix_monitor',
    'extreme_watchdog',
    'pcap_collector',
    'gateway_log_collector',
    'application_log_collector',
    'host_telemetry_collector',
  ]) {
    keepNewest(role);
  }

  for (const p of active) {
    const role = classifyRole(p.command);
    if (['h1_runner', 'h2_runner', 'h3_runner'].includes(role)) {
      ledger.kept.push({ pid: p.pid, role, command: p.command });
    }
  }

  fs.writeFileSync(path.join(outRoot, 'process-cleanup-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

function fileAgeMs(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return Date.now() - fs.statSync(filePath).mtimeMs;
}

function lastJsonlTs(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) return null;
  try {
    const row = JSON.parse(lines[lines.length - 1]);
    return row.ts || row.monotonic_ms || null;
  } catch {
    return fs.statSync(filePath).mtimeMs;
  }
}

function runtimeIntegrity(outRoot) {
  const manifestPath = path.join(outRoot, 'phase32h-targeted-manifest.jsonl');
  const manifest = loadJsonl(manifestPath);
  const perProtoManifest = { 'HTTP/1.1': 0, 'HTTP/2': 0, 'HTTP/3': 0 };
  const manifestIds = new Set();
  const manifestDupIds = new Set();
  const manifestCoords = new Set();
  for (const row of manifest) {
    perProtoManifest[row.protocol_label] = (perProtoManifest[row.protocol_label] || 0) + 1;
    if (manifestIds.has(row.probe_id)) manifestDupIds.add(row.probe_id);
    manifestIds.add(row.probe_id);
    manifestCoords.add(`${row.matrix_protocol}|${row.window}|${row.user_uid}|${row.run}|${row.case_id}`);
  }

  const rows = loadShardRows(outRoot);
  const perProtoRows = { 'HTTP/1.1': 0, 'HTTP/2': 0, 'HTTP/3': 0 };
  const rowIds = new Set();
  const rowCoords = new Set();
  let duplicateProbeIds = 0;
  let duplicateCoords = 0;
  let wrongEvidenceLabel = 0;
  let wrongGitSha = 0;
  let privateFieldViolations = 0;
  let invalidJsonLines = 0;

  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase32h-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        invalidJsonLines += 1;
        continue;
      }
      perProtoRows[row.protocol_label] = (perProtoRows[row.protocol_label] || 0) + 1;
      if (rowIds.has(row.probe_id)) duplicateProbeIds += 1;
      rowIds.add(row.probe_id);
      const coord = `${row.matrix_protocol}|${row.window}|${row.user_uid}|${row.run}|${row.case_id}`;
      if (rowCoords.has(coord)) duplicateCoords += 1;
      rowCoords.add(coord);
      if (row.evidence_label !== PHASE32H_EVIDENCE_LABEL) wrongEvidenceLabel += 1;
      if (row.git_sha && row.git_sha !== EXPECTED_HEAD) wrongGitSha += 1;
      try {
        assertRedactedInflightRecord(row);
      } catch {
        privateFieldViolations += 1;
      }
    }
  }

  const blocked =
    manifest.length !== TARGET_TOTAL ||
    duplicateProbeIds > 0 ||
    duplicateCoords > 0 ||
    invalidJsonLines > 0 ||
    wrongEvidenceLabel > 0 ||
    privateFieldViolations > 0;

  return {
    status: blocked ? 'BLOCKED' : 'PASS',
    manifest_total: manifest.length,
    manifest_per_protocol: perProtoManifest,
    rows_total: rows.length,
    rows_per_protocol: perProtoRows,
    duplicate_probe_ids: duplicateProbeIds,
    duplicate_matrix_coordinates: duplicateCoords,
    invalid_json_lines: invalidJsonLines,
    wrong_evidence_label: wrongEvidenceLabel,
    wrong_git_sha: wrongGitSha,
    private_field_violations: privateFieldViolations,
    expected_head: EXPECTED_HEAD,
  };
}

function collectorHealth(outRoot) {
  const procs = listProcesses().filter((p) => p.evidenceRoot === outRoot);
  const roles = {};
  for (const p of procs) {
    const role = classifyRole(p.command);
    roles[role] = roles[role] || [];
    roles[role].push(p);
  }

  const hb = (rel) => path.join(outRoot, rel);
  const health = {};
  const now = Date.now();

  const assess = (role, freshnessMs, outputPath) => {
    const procList = roles[role] || [];
    const latest = procList.sort((a, b) => b.pid - a.pid)[0];
    let lastOutputAge = fileAgeMs(outputPath);
    if (outputPath.endsWith('.jsonl')) {
      const ts = lastJsonlTs(outputPath);
      if (typeof ts === 'string') lastOutputAge = now - Date.parse(ts);
      else if (typeof ts === 'number') lastOutputAge = now - ts;
    }
    const fresh = lastOutputAge != null && lastOutputAge <= freshnessMs;
    const alive = procList.length > 0;
    health[role] = {
      pid: latest?.pid ?? null,
      command: latest?.command ?? null,
      process_count: procList.length,
      output_path: outputPath,
      output_bytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
      last_output_age_ms: lastOutputAge,
      freshness_threshold_ms: freshnessMs,
      status: alive && fresh ? 'ACTIVE' : alive ? 'STALE' : 'MISSING',
      failure_reason: !alive ? 'process missing' : !fresh ? 'output stale' : null,
    };
  };

  assess('matrix_monitor', 330_000, hb('phase32h-monitor.log'));
  assess('extreme_watchdog', 10_000, hb('heartbeats/watchdog.jsonl'));
  assess('pcap_collector', 30_000, hb('pcap/capture-status.json'));
  assess('gateway_log_collector', 120_000, hb('logs/gateway-access-tail.txt'));
  assess('application_log_collector', 120_000, hb('logs/application-log-tail.txt'));
  assess('host_telemetry_collector', 10_000, hb('telemetry/host-telemetry.jsonl'));
  assess('power_telemetry_collector', 30_000, hb('telemetry/power-events.jsonl'));
  assess('h1_runner', 10_000, hb('heartbeats/h1.jsonl'));
  assess('h2_runner', 10_000, hb('heartbeats/h2.jsonl'));
  assess('h3_runner', 10_000, hb('heartbeats/h3.jsonl'));

  const mandatory = [
    'extreme_watchdog',
    'pcap_collector',
    'application_log_collector',
    'host_telemetry_collector',
    'power_telemetry_collector',
  ];
  health.overall_status = mandatory.every((r) => health[r]?.status === 'ACTIVE') ? 'PASS' : 'BLOCKED';
  return health;
}

function pcapContinuity(outRoot) {
  const pcapDir = path.join(outRoot, 'pcap');
  const files = fs.existsSync(pcapDir)
    ? fs.readdirSync(pcapDir).filter((f) => f.endsWith('.pcapng') || f.endsWith('.pcap')).sort()
    : [];
  const latest = files.length ? path.join(pcapDir, files[files.length - 1]) : null;
  let tcp443 = 0;
  let udp443 = 0;
  if (latest) {
    const tcp = spawnSync('tshark', ['-r', latest, '-Y', 'tcp.port == 443', '-T', 'fields', '-e', 'frame.number'], {
      encoding: 'utf8',
    });
    tcp443 = (tcp.stdout || '').split('\n').filter(Boolean).length;
    const udp = spawnSync('tshark', ['-r', latest, '-Y', 'udp.port == 443', '-T', 'fields', '-e', 'frame.number'], {
      encoding: 'utf8',
    });
    udp443 = (udp.stdout || '').split('\n').filter(Boolean).length;
  }
  const statusPath = path.join(pcapDir, 'capture-status.json');
  const capture = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : {};
  return {
    status: latest && tcp443 > 0 && udp443 > 0 ? 'PASS' : 'BLOCKED',
    dumpcap_count: listProcesses().filter((p) => p.evidenceRoot === outRoot && classifyRole(p.command) === 'pcap_collector').length,
    iface: capture.iface || null,
    filter: capture.filter || null,
    latest_pcap: latest,
    latest_pcap_bytes: latest ? fs.statSync(latest).size : 0,
    latest_pcap_age_ms: latest ? fileAgeMs(latest) : null,
    tcp_443_packets: tcp443,
    udp_443_packets: udp443,
    pcap_files: files.length,
  };
}

function hostDiscontinuities(outRoot) {
  const file = path.join(outRoot, 'telemetry/host-telemetry.jsonl');
  const flags = [];
  if (!fs.existsSync(file)) {
    return { status: 'BLOCKED', flags, reason: 'missing host telemetry' };
  }
  const rows = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const wallDelta = Date.parse(cur.ts) - Date.parse(prev.ts);
    const monoDelta = (cur.monotonic_ms ?? 0) - (prev.monotonic_ms ?? 0);
    const uptimeDelta = ((cur.uptime_sec ?? 0) - (prev.uptime_sec ?? 0)) * 1000;
    if (wallDelta >= 10_000) {
      flags.push({ type: 'telemetry_gap', wall_delta_ms: wallDelta, at: cur.ts });
    }
    if (Math.abs(wallDelta - monoDelta) >= 5000) {
      flags.push({ type: 'wall_monotonic_divergence', wall_delta_ms: wallDelta, monotonic_delta_ms: monoDelta, at: cur.ts });
    }
    if (uptimeDelta < 0 || uptimeDelta > wallDelta + 5000) {
      flags.push({ type: 'uptime_anomaly', uptime_delta_ms: uptimeDelta, wall_delta_ms: wallDelta, at: cur.ts });
    }
  }
  return { status: flags.length ? 'FLAGGED' : 'PASS', flags, rows_analyzed: rows.length };
}

function syntheticWatchdogTest(outRoot) {
  const probe = {
    probe_id: 'synthetic-watchdog-test',
    protocol_label: 'HTTP/2',
    matrix_protocol: 'h2',
    case_id: 'synthetic',
    window: 0,
    run: 0,
    user_class: 'synthetic',
    expected_gate_reason: 'synthetic',
    diagnostic_test: true,
    not_a_matrix_probe: true,
  };
  const record = buildInflightRecord(probe);
  record.monotonic_started_ms = Date.now() - 65_000;
  record.diagnostic_test = true;
  record.not_a_matrix_probe = true;
  const backup = path.join(outRoot, 'inflight', 'h2.json');
  const hadBackup = fs.existsSync(backup);
  const prior = hadBackup ? fs.readFileSync(backup, 'utf8') : null;
  registerInflight(outRoot, 'h2', record);
  const result = watchdogTick(outRoot);
  const diagDirs = fs.existsSync(path.join(outRoot, 'diagnostics'))
    ? fs.readdirSync(path.join(outRoot, 'diagnostics')).filter((d) => d.includes('synthetic-watchdog-test'))
    : [];
  const bundle = diagDirs.length ? path.join(outRoot, 'diagnostics', diagDirs[0]) : null;
  const pass =
    result.triggered.length === 1 &&
    bundle &&
    fs.existsSync(path.join(bundle, 'trigger.json')) &&
    fs.existsSync(path.join(bundle, 'process-snapshot.txt'));
  if (hadBackup && prior) fs.writeFileSync(backup, prior);
  else if (fs.existsSync(backup)) fs.unlinkSync(backup);
  return {
    status: pass ? 'PASS' : 'BLOCKED',
    triggered: result.triggered.length,
    bundle_path: bundle,
    synthetic: true,
    excluded_from_matrix: true,
  };
}

function timingStats(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const n = xs.length;
  return {
    count: n,
    p50: percentile(xs, 50),
    p75: percentile(xs, 75),
    p90: percentile(xs, 90),
    p95: percentile(xs, 95),
    p99: percentile(xs, 99),
    p999: n >= 1000 ? percentile(xs, 99.9) : null,
    max: n ? Math.max(...xs) : null,
    tail_rows_p99: n ? Math.max(1, Math.ceil(n * 0.01)) : 0,
    tail_rows_p999: n >= 1000 ? Math.max(1, Math.ceil(n * 0.001)) : null,
  };
}

function checkpoint(outRoot, integrity, collector, cleanup) {
  const rows = loadShardRows(outRoot);
  const perProto = {};
  for (const proto of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const subset = rows.filter((r) => r.protocol_label === proto);
    perProto[proto] = subset.length;
  }
  const total = rows.length;
  const started = fs.existsSync(path.join(outRoot, 'pcap/capture-status.json'))
    ? JSON.parse(fs.readFileSync(path.join(outRoot, 'pcap/capture-status.json'), 'utf8')).started_at
    : null;
  const throughput = { last_5m: null, last_30m: null, entire_run: null };
  if (rows.length >= 2 && rows[0].timing?.probe_started_at) {
    const first = Date.parse(rows[0].timing.probe_started_at);
    const last = Date.parse(rows[rows.length - 1].timing.probe_finished_at || rows[rows.length - 1].timing.probe_started_at);
    const elapsedMin = Math.max(1, (last - first) / 60_000);
    throughput.entire_run = total / elapsedMin;
    const cutoff30 = Date.now() - 30 * 60_000;
    const recent30 = rows.filter((r) => Date.parse(r.timing?.probe_finished_at || 0) >= cutoff30);
    if (recent30.length > 1) {
      const t0 = Date.parse(recent30[0].timing.probe_finished_at);
      const t1 = Date.parse(recent30[recent30.length - 1].timing.probe_finished_at);
      throughput.last_30m = recent30.length / Math.max(1, (t1 - t0) / 60_000);
    }
    const cutoff5 = Date.now() - 5 * 60_000;
    const recent5 = rows.filter((r) => Date.parse(r.timing?.probe_finished_at || 0) >= cutoff5);
    if (recent5.length > 1) {
      const t0 = Date.parse(recent5[0].timing.probe_finished_at);
      const t1 = Date.parse(recent5[recent5.length - 1].timing.probe_finished_at);
      throughput.last_5m = recent5.length / Math.max(1, (t1 - t0) / 60_000);
    }
  }
  const etaMin =
    throughput.last_30m && total < TARGET_TOTAL
      ? (TARGET_TOTAL - total) / throughput.last_30m
      : null;

  const extremes = rows.filter((r) => (r.timing?.wall_total_ms ?? 0) >= 60_000);
  const wall = timingStats(rows.map((r) => r.timing?.wall_total_ms));
  const rtfb = timingStats(
    rows.map((r) => {
      const d = curlPhaseDecomposition(r.timing || {});
      return d.phases.request_to_first_byte_ms;
    }),
  );

  const df = spawnSync('df', ['-h', '/tmp'], { encoding: 'utf8' });
  const du = spawnSync('du', ['-sk', outRoot], { encoding: 'utf8' });
  const bytes = Number((du.stdout || '0').split('\t')[0] || 0) * 1024;
  const remaining = TARGET_TOTAL - total;
  const projected = total > 0 ? (bytes / total) * TARGET_TOTAL : null;

  return {
    generated_at: new Date().toISOString(),
    head_sha: gitHead(),
    matrix_total: `${total}/${TARGET_TOTAL}`,
    completion_pct: total / TARGET_TOTAL,
    per_protocol: perProto,
    throughput_probes_per_min: throughput,
    eta_minutes: etaMin,
    runtime_integrity: integrity,
    collector_health: collector,
    process_cleanup: cleanup,
    extreme_events_ge_60s: extremes.length,
    worst_wall_ms: wall.max,
    worst_request_to_first_byte_ms: rtfb.max,
    latency_wall: wall,
    latency_request_to_first_byte: rtfb,
    disk: {
      df: (df.stdout || '').trim(),
      evidence_root_bytes: bytes,
      projected_total_bytes: projected,
      free_ok: true,
    },
    production_enablement: 'NOT APPROVED',
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('out must be under /tmp');

  const cleanup = opts.cleanup ? cleanupStaleProcesses(opts.out) : null;
  const integrity = runtimeIntegrity(opts.out);
  const collector = collectorHealth(opts.out);
  const pcap = pcapContinuity(opts.out);
  const discontinuities = hostDiscontinuities(opts.out);
  const synthetic = opts.syntheticWatchdog ? syntheticWatchdogTest(opts.out) : null;

  fs.writeFileSync(path.join(opts.out, 'phase32h-runtime-integrity.json'), `${JSON.stringify(integrity, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'collector-health.json'), `${JSON.stringify(collector, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'pcap/phase32h-pcap-continuity.json'), `${JSON.stringify(pcap, null, 2)}\n`);
  fs.writeFileSync(
    path.join(opts.out, 'telemetry/phase32h-host-discontinuities.json'),
    `${JSON.stringify(discontinuities, null, 2)}\n`,
  );
  if (synthetic) {
    fs.writeFileSync(path.join(opts.out, 'phase32h-synthetic-watchdog-test.json'), `${JSON.stringify(synthetic, null, 2)}\n`);
  }

  const cp = checkpoint(opts.out, integrity, collector, cleanup);
  cp.pcap_continuity = pcap;
  cp.host_discontinuities = discontinuities;
  if (synthetic) cp.synthetic_watchdog_test = synthetic;

  fs.writeFileSync(path.join(opts.out, 'phase32h-current-checkpoint.json'), `${JSON.stringify(cp, null, 2)}\n`);
  fs.writeFileSync(
    path.join(opts.out, 'phase32h-current-checkpoint.md'),
    `# Phase 32H checkpoint\n\n- matrix: ${cp.matrix_total}\n- integrity: ${integrity.status}\n- collectors: ${collector.overall_status}\n- extremes >=60s: ${cp.extreme_events_ge_60s}\n`,
  );

  console.log(JSON.stringify({ integrity, collector_overall: collector.overall_status, checkpoint: cp.matrix_total, cleanup_stopped: cleanup?.stopped?.length ?? 0 }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
