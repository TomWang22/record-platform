#!/usr/bin/env node
/**
 * Phase 32H-R1 — freeze canary-v2 terminal PASS evidence (immutable /tmp only).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from './lib/phase22-full-replay-common.mjs';
import { loadJsonl, classifyMatrixProbeFailure } from './lib/phase31-controlled-matrix-summary.mjs';
import { validateManifestContract } from './lib/phase32h-manifest-contract.mjs';
import {
  R1_CANARY_PER_PROTOCOL,
  R1_CANARY_TOTAL,
  R1_EVIDENCE_LABEL_CANARY,
  R1_PER_PROTOCOL,
  R1_TOTAL,
} from './lib/phase32h-r1-config.mjs';
import { buildR1Manifest } from './phase32h-build-r1-manifest.mjs';
import { collectPcapStats } from './phase32h-pcap-stats-readonly.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import {
  DISK_EVIDENCE_BUDGET_BYTES,
  DISK_HARD_MIN_BYTES,
  DISK_PCAP_RING_BUDGET_BYTES,
  DISK_PREFERRED_MIN_BYTES,
  DISK_WORST_CASE_COMBINED_BYTES,
  evaluateDiskPreflight,
} from './lib/phase32h-disk-preflight.mjs';
import { scanPrivateFields } from './lib/phase32h-targeted-summary.mjs';
import { evaluateCollectorHealth } from './lib/phase32h-collector-supervision.mjs';
import { sha256File, readRunId, readLaunchHead } from './lib/phase32h-run-integrity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = '/tmp/phase32h-r1-baseline-r2-canary-v2';
const GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);

function parseArgs(argv) {
  const opts = { out: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function sha256FileSync(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

function loadShardRows(outRoot) {
  const rows = [];
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase32h-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    rows.push(...loadJsonl(file));
  }
  return rows;
}

function listProcesses() {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  const rows = [];
  for (const line of (ps.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
}

function roleForCommand(command, outRoot) {
  if (!command.includes(outRoot)) return null;
  if (command.includes('phase32h-collector-supervisor.mjs')) return 'collector_supervisor';
  if (command.includes('phase32h-extreme-watchdog.mjs')) return 'extreme_watchdog';
  if (command.includes('phase32h-capture-host-telemetry.sh')) return 'host_power_telemetry';
  if (command.includes('phase32h-start-gateway-log-capture.sh')) return 'gateway_log_collector';
  if (command.includes('phase32h-start-application-log-capture.sh')) return 'application_log_collector';
  if (command.includes('phase32h-monitor-targeted-reproduction.sh')) return 'matrix_monitor';
  if (command.includes('dumpcap') && command.includes(outRoot)) return 'pcap_collector';
  if (command.includes('phase32h-r1-triplet-runner.mjs')) return 'triplet_runner';
  return 'other';
}

function stopProcessesForRoot(outRoot) {
  const ledger = [];
  const seen = new Set();

  const attemptStop = (proc, signal) => {
    const key = `${proc.pid}:${signal}`;
    if (seen.has(key)) return;
    seen.add(key);
    const role = roleForCommand(proc.command, outRoot);
    if (!role || role === 'triplet_runner') return;
    const entry = {
      pid: proc.pid,
      role,
      command: proc.command,
      signal,
      signal_at: new Date().toISOString(),
      exit_at: null,
      exit_code: null,
      sigkill_required: false,
    };
    try {
      process.kill(proc.pid, signal);
      ledger.push(entry);
    } catch (err) {
      entry.exit_at = new Date().toISOString();
      entry.exit_code = err.code === 'ESRCH' ? 0 : null;
      entry.note = err.message;
      ledger.push(entry);
    }
    return entry;
  };

  const procs = listProcesses().filter((p) => roleForCommand(p.command, outRoot));
  for (const proc of procs) {
    attemptStop(proc, 'SIGTERM');
  }

  const deadline = Date.now() + GRACEFUL_MS;
  while (Date.now() < deadline) {
    const alive = ledger
      .filter((e) => e.signal === 'SIGTERM' && e.exit_at == null)
      .filter((e) => {
        try {
          process.kill(e.pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    if (!alive.length) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }

  for (const entry of ledger.filter((e) => e.signal === 'SIGTERM' && e.exit_at == null)) {
    try {
      process.kill(entry.pid, 0);
      const proc = procs.find((p) => p.pid === entry.pid);
      if (proc) {
        attemptStop(proc, 'SIGKILL');
        const killEntry = ledger[ledger.length - 1];
        if (killEntry) {
          killEntry.sigkill_required = true;
          entry.sigkill_required = true;
        }
      }
    } catch {
      entry.exit_at = new Date().toISOString();
      entry.exit_code = 0;
    }
  }

  for (const entry of ledger) {
    if (entry.exit_at) continue;
    try {
      process.kill(entry.pid, 0);
    } catch {
      entry.exit_at = new Date().toISOString();
      entry.exit_code = 0;
    }
  }

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), outRoot], {
    cwd: REPO_ROOT,
  });

  return ledger;
}

function pcapStats(pcapPath) {
  const stats = {
    file: pcapPath,
    bytes: fs.existsSync(pcapPath) ? fs.statSync(pcapPath).size : 0,
    sha256: fs.existsSync(pcapPath) ? sha256FileSync(pcapPath) : null,
    packets: null,
    drops: null,
    first_frame_ts: null,
    last_frame_ts: null,
  };
  if (!fs.existsSync(pcapPath)) return stats;
  if (spawnSync('which', ['capinfos']).status === 0) {
    const cap = spawnSync('capinfos', ['-c', '-s', pcapPath], { encoding: 'utf8' });
    const countMatch = (cap.stdout || '').match(/Number of packets:\s*(\d+)/);
    if (countMatch) stats.packets = Number(countMatch[1]);
  }
  if (spawnSync('which', ['tshark']).status === 0) {
    const frames = spawnSync(
      'tshark',
      ['-r', pcapPath, '-T', 'fields', '-e', 'frame.number', '-e', 'frame.time_epoch'],
      { encoding: 'utf8' },
    );
    const lines = (frames.stdout || '').split('\n').filter(Boolean);
    if (lines.length) {
      stats.packets = lines.length;
      const first = lines[0].split('\t');
      const last = lines[lines.length - 1].split('\t');
      stats.first_frame_ts = first[1] ? new Date(Number(first[1]) * 1000).toISOString() : null;
      stats.last_frame_ts = last[1] ? new Date(Number(last[1]) * 1000).toISOString() : null;
    }
    const quic = spawnSync('tshark', ['-r', pcapPath, '-Y', 'quic', '-T', 'fields', '-e', 'quic.version'], {
      encoding: 'utf8',
    });
    const versions = [...new Set((quic.stdout || '').split('\n').map((v) => v.trim()).filter(Boolean))];
    stats.quic_versions = versions;
    stats.udp_443_packets = Number(
      spawnSync('bash', ['-lc', `source "${REPO_ROOT}/scripts/lib/phase32h-pcap-chmodbpf.sh"; phase32h_pcap_udp_443_count "${pcapPath}"`], {
        encoding: 'utf8',
      }).stdout?.trim() || 0,
    );
    stats.tcp_443_packets = Number(
      spawnSync('bash', ['-lc', `source "${REPO_ROOT}/scripts/lib/phase32h-pcap-chmodbpf.sh"; phase32h_pcap_tcp_443_count "${pcapPath}"`], {
        encoding: 'utf8',
      }).stdout?.trim() || 0,
    );
  }
  const dumpcapLog = path.join(path.dirname(pcapPath), 'dumpcap.log');
  if (fs.existsSync(dumpcapLog)) {
    const text = fs.readFileSync(dumpcapLog, 'utf8');
    const dropMatch = text.match(/dropped:\s*(\d+)/i);
    if (dropMatch) stats.drops = Number(dropMatch[1]);
  }
  return stats;
}

function summarizeMatrix(rows, outRoot) {
  const perProtocol = { h1: 0, h2: 0, h3: 0 };
  for (const row of rows) perProtocol[row.matrix_protocol] = (perProtocol[row.matrix_protocol] || 0) + 1;
  const http200 = rows.filter((r) => Number(r.http_status) === 200).length;
  const http422 = rows.filter((r) => Number(r.http_status) === 422).length;
  const wrongGate = rows.filter((r) => r.gate_reason !== r.expected_gate_reason).length;
  const wrongProtocol = rows.filter((r) => r.version_ok === false).length;
  const fallback = rows.reduce((s, r) => s + Number(r.fallback_count || 0), 0);
  const leakage = rows.filter((r) => r.leakage_pass === 'FAIL').length;
  const retries = rows.reduce((s, r) => s + Number(r.timing?.retry_count || 0), 0);
  const launchHead = readLaunchHead(outRoot);
  const runId = readRunId(outRoot);
  const wrongSha = rows.filter((r) => r.git_sha && r.git_sha !== launchHead).length;
  const wrongRun = rows.filter((r) => r.run_id && r.run_id !== runId).length;
  const probeIds = rows.map((r) => r.probe_id);
  const dupProbe = probeIds.length - new Set(probeIds).size;
  const coords = new Set(
    rows.map((r) =>
      [r.matrix_protocol, r.window, r.run, r.case_id, r.user_uid_hash || r.user_class].join('|'),
    ),
  );
  const dupCoord = rows.length - coords.size;
  const timestamps = rows
    .map((r) => r.timing?.probe_started_at || r.completed_at)
    .filter(Boolean)
    .sort();
  const redTeam = rows.filter((r) => r.red_team_case);
  return {
    total: rows.length,
    per_protocol: perProtocol,
    batches: fs.existsSync(path.join(outRoot, 'batches'))
      ? fs.readdirSync(path.join(outRoot, 'batches')).filter((f) => f.endsWith('.json')).length
      : 0,
    http_200: http200,
    http_422: http422,
    deterministic_4xx: rows.filter((r) => classifyMatrixProbeFailure(r) === 'deterministic').length,
    retries,
    wrong_gate: wrongGate,
    wrong_protocol: wrongProtocol,
    fallback,
    leakage,
    duplicate_probe_ids: dupProbe,
    duplicate_coordinates: dupCoord,
    wrong_git_sha: wrongSha,
    wrong_run_id: wrongRun,
    response_pass: rows.filter((r) => r.response_pass === 'PASS').length,
    sentiment_pass: rows.filter((r) => r.sentiment_pass === 'PASS' || r.sentiment_pass === 'SKIP').length,
    red_team_safety_pass: redTeam.filter((r) => r.response_pass === 'PASS').length,
    red_team_rows: redTeam.length,
    timing_coverage: rows.filter((r) => r.timing).length,
    first_probe_at: timestamps[0] || null,
    final_probe_at: timestamps[timestamps.length - 1] || null,
  };
}

function walkFiles(root, { exclude = [] } = {}) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full, { exclude }));
    else if (!exclude.some((suffix) => full.endsWith(suffix))) files.push(full);
  }
  return files;
}

function buildBaselineLaunchPackage() {
  const manifestRows = buildR1Manifest({ evidenceLabel: 'Phase 32H-R1 baseline synchronized-stall validation' });
  const manifestJson = `${manifestRows.map((r) => JSON.stringify(r)).join('\n')}\n`;
  const manifestSha = crypto.createHash('sha256').update(manifestJson).digest('hex');
  const disk = evaluateDiskPreflight('/tmp/phase32h-r1-baseline-r2');
  return {
    status: 'APPROVAL_PENDING',
    proposed_root: '/tmp/phase32h-r1-baseline-r2',
    forbidden_roots: [
      '/tmp/phase32h-r1-baseline',
      '/tmp/phase32h-r1-baseline-r2-canary',
      '/tmp/phase32h-r1-baseline-r2-canary-v2',
      '/tmp/phase32h-targeted-reproduction',
    ],
    manifest_sha256: manifestSha,
    target_total: R1_TOTAL,
    per_protocol: { h1: R1_PER_PROTOCOL, h2: R1_PER_PROTOCOL, h3: R1_PER_PROTOCOL },
    triplet_batches: R1_PER_PROTOCOL,
    dimensions: '3 protocols × 8 windows × 6 users × 10 runs × 6 cases = 8,640',
    expected_runtime_hours: '3–6 (staging-dependent; not guaranteed)',
    expected_disk_gb: {
      evidence_logs_indexes_gb: 'up to 15',
      pcap_ring_gb: 'up to 12',
      worst_case_combined_gb: 'approximately 27',
    },
    minimum_free_disk_gb: DISK_HARD_MIN_BYTES / 1024 ** 3,
    preferred_free_disk_gb: DISK_PREFERRED_MIN_BYTES / 1024 ** 3,
    disk_reserve_policy: {
      pcap_ring_budget_bytes: DISK_PCAP_RING_BUDGET_BYTES,
      evidence_budget_bytes: DISK_EVIDENCE_BUDGET_BYTES,
      safety_margin_bytes: DISK_WORST_CASE_COMBINED_BYTES - DISK_PCAP_RING_BUDGET_BYTES - DISK_EVIDENCE_BUDGET_BYTES,
      hard_minimum_bytes: DISK_HARD_MIN_BYTES,
      preferred_minimum_bytes: DISK_PREFERRED_MIN_BYTES,
      fail_when_free_below_bytes: DISK_HARD_MIN_BYTES,
      warn_when_free_below_bytes: DISK_PREFERRED_MIN_BYTES,
      never_delete_frozen_evidence: true,
    },
    disk_preflight: disk,
    pcap_policy: {
      ring_files: 48,
      ring_filesize_kb: 250_000,
      filter: 'tcp port 443 or udp port 443 or port 53 or icmp or icmp6',
      interface: 'bridge100 (resolved at launch)',
    },
    collector_freshness_thresholds_ms: {
      runner: 10_000,
      watchdog: 10_000,
      host_telemetry: 10_000,
      power_telemetry: 30_000,
      pcap_active: 30_000,
      application_log: 90_000,
      gateway_log: 90_000,
    },
    restart_policy: 'Fail closed — no JSONL repair/resume after collector block or deterministic 4xx',
    checkpoint_schedule: 'Supervisor tick every batch; progress logged every 10 triplet batches',
    fail_closed: [
      'HTTP 422 or any deterministic 4xx',
      'missing/blank question',
      'wrong gate/protocol/fallback/leakage',
      'duplicate probe/coordinate',
      'wrong SHA/run_id',
      'collector death or PCAP gap',
      'manifest mutation',
    ],
    terminal_pass: {
      total: 8640,
      per_protocol: 2880,
      triplet_batches: 2880,
      http_200: 8640,
      http_422: 0,
      wrong_gate: 0,
      collector_coverage: 'PASS',
      pcap_continuity: 'PASS',
    },
    launch_command:
      'node scripts/phase32h-launch-r1-arm.mjs --arm baseline --out /tmp/phase32h-r1-baseline-r2',
    owner_approval_command:
      'Explicit owner message: APPROVE Phase 32H-R1 baseline 8640 launch at /tmp/phase32h-r1-baseline-r2',
    production_enablement: 'NOT APPROVED',
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outRoot = opts.out;
  if (!fs.existsSync(outRoot)) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: `missing root ${outRoot}` }, null, 2));
    process.exit(2);
  }
  if (fs.existsSync(path.join(outRoot, 'FROZEN_PASS_EVIDENCE'))) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'already frozen PASS evidence' }, null, 2));
    process.exit(2);
  }

  const frozenAt = new Date().toISOString();
  const jsonlPaths = ['h1', 'h2', 'h3'].map((s) => path.join(outRoot, `shard-${s}`, 'phase32h-matrix.jsonl'));
  const jsonlHashesBefore = Object.fromEntries(
    jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]),
  );

  const pcapDir = path.join(outRoot, 'pcap');
  const pcapFilesBefore = fs.existsSync(pcapDir)
    ? fs
        .readdirSync(pcapDir)
        .filter((f) => f.endsWith('.pcap') || f.endsWith('.pcapng'))
        .map((f) => path.join(pcapDir, f))
    : [];
  const pcapPreStop = pcapFilesBefore.map((f) => pcapStats(f));

  const stopLedger = stopProcessesForRoot(outRoot);

  const pcapFilesAfter = fs.existsSync(pcapDir)
    ? fs
        .readdirSync(pcapDir)
        .filter((f) => f.endsWith('.pcap') || f.endsWith('.pcapng'))
        .map((f) => path.join(pcapDir, f))
    : [];
  const pcapPostStop = pcapFilesAfter.map((f) => pcapStats(f));

  const transport = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-validate-pcap-smoke.sh'), outRoot], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  let transportReport = { status: 'BLOCKED', reason: 'transport validation failed' };
  const transportPath = path.join(outRoot, 'pcap', 'pcap-smoke-validation.json');
  if (fs.existsSync(transportPath)) {
    transportReport = JSON.parse(fs.readFileSync(transportPath, 'utf8'));
  }

  const rows = loadShardRows(outRoot);
  const matrix = summarizeMatrix(rows, outRoot);
  const launch = JSON.parse(fs.readFileSync(path.join(outRoot, 'phase32h-r1-launch.json'), 'utf8'));
  const manifestPath = path.join(outRoot, 'phase32h-r1-manifest.jsonl');
  const manifestRows = loadJsonl(manifestPath);
  const manifestContract = validateManifestContract(manifestRows, {
    evidenceLabel: R1_EVIDENCE_LABEL_CANARY,
    expectedTotal: R1_CANARY_TOTAL,
    expectedPerProtocol: R1_CANARY_PER_PROTOCOL,
    launchHead: launch.launch_head,
    runId: launch.run_id,
  });

  const privateScan = scanPrivateFields(rows);
  const batchIndexCount = fs.existsSync(path.join(outRoot, 'batch-packet-index'))
    ? fs.readdirSync(path.join(outRoot, 'batch-packet-index')).filter((f) => f.endsWith('.json')).length
    : 0;
  const packetIndexReport = evaluatePacketIndexCoverage(outRoot, {
    expectedProbeIndexes: 90,
    expectedBatchCorrelations: 30,
    requirePerProbeIndexes: false,
  });
  const probeIndexCount = packetIndexReport.probe_index_count;

  const captureStatus = fs.existsSync(path.join(pcapDir, 'capture-status.json'))
    ? JSON.parse(fs.readFileSync(path.join(pcapDir, 'capture-status.json'), 'utf8'))
    : {};
  const pcapContinuity = {
    status: 'PASS',
    pcap_files: pcapPostStop.length,
    total_bytes: pcapPostStop.reduce((s, f) => s + (f.bytes || 0), 0),
    total_packets: pcapPostStop.reduce((s, f) => s + (f.packets || 0), 0),
    drops: pcapPostStop.reduce((s, f) => s + (f.drops || 0), 0),
    udp_443: pcapPostStop.some((f) => (f.udp_443_packets || 0) > 0),
    quic_versions: [...new Set(pcapPostStop.flatMap((f) => f.quic_versions || []))],
    capture_started_at: captureStatus.started_at || null,
    capture_stopped_at: captureStatus.stopped_at || null,
    first_probe_at: matrix.first_probe_at,
    final_probe_at: matrix.final_probe_at,
    capture_end_covers_final_probe:
      !captureStatus.stopped_at ||
      !matrix.final_probe_at ||
      Date.parse(captureStatus.stopped_at) >= Date.parse(matrix.final_probe_at),
    transport_validator: transportReport.status,
  };
  if (
    pcapContinuity.pcap_files < 1 ||
    !pcapContinuity.udp_443 ||
    transportReport.status !== 'PASS' ||
    !pcapContinuity.capture_end_covers_final_probe
  ) {
    pcapContinuity.status = 'BLOCKED';
  }

  const collectorCoverage = {
    frozen_at: frozenAt,
    final_supervisor: fs.existsSync(path.join(outRoot, 'run-state/collector-supervisor.json'))
      ? JSON.parse(fs.readFileSync(path.join(outRoot, 'run-state/collector-supervisor.json'), 'utf8'))
      : null,
    collectors_stopped: stopLedger,
    sigkill_required: stopLedger.some((e) => e.sigkill_required),
    status: stopLedger.every((e) => e.exit_at || e.exit_code === 0) ? 'PASS' : 'PARTIAL',
  };

  const jsonlHashesAfter = Object.fromEntries(
    jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]),
  );
  const jsonlModified = Object.keys(jsonlHashesBefore).some((p) => jsonlHashesBefore[p] !== jsonlHashesAfter[p]);

  const pass =
    matrix.total === 90 &&
    matrix.per_protocol.h1 === 30 &&
    matrix.per_protocol.h2 === 30 &&
    matrix.per_protocol.h3 === 30 &&
    matrix.batches === 30 &&
    matrix.http_200 === 90 &&
    matrix.http_422 === 0 &&
    matrix.wrong_gate === 0 &&
    matrix.duplicate_probe_ids === 0 &&
    matrix.duplicate_coordinates === 0 &&
    matrix.wrong_git_sha === 0 &&
    matrix.wrong_run_id === 0 &&
    manifestContract.status === 'PASS' &&
    privateScan.pass &&
    pcapContinuity.status === 'PASS' &&
    batchIndexCount === 30 &&
    matrix.timing_coverage === 90 &&
    !jsonlModified;

  const terminalStatus = pass ? 'PASS' : 'BLOCKED';

  const finalManifest = {
    frozen_at: frozenAt,
    phase: '32H-R1-C2',
    root: outRoot,
    run_id: launch.run_id,
    manifest_sha256: launch.manifest_sha256,
    launch_head: launch.launch_head,
    origin_main_sha: launch.launch_head,
    participant_artifact_sha: DEFAULTS.expectedArtifactSha,
    evidence_label: launch.evidence_label,
    target: { total: 90, h1: 30, h2: 30, h3: 30, triplet_batches: 30 },
    observed: matrix,
    first_probe_at: matrix.first_probe_at,
    final_probe_at: matrix.final_probe_at,
    collector_started_at: launch.started_at || captureStatus.started_at || null,
    collector_stopped_at: frozenAt,
    pcap_started_at: captureStatus.started_at || null,
    pcap_stopped_at: captureStatus.stopped_at || null,
    verdict: terminalStatus,
    production_enablement: 'NOT APPROVED',
    jsonl_modified: jsonlModified,
  };

  const integrity = {
    status: terminalStatus,
    frozen_at: frozenAt,
    manifest_contract: manifestContract,
    matrix,
    private_field_scan: privateScan,
    batch_packet_index_count: batchIndexCount,
    probe_packet_index_count: probeIndexCount,
    batch_correlation_coverage: batchIndexCount === 30 ? '30/30 PASS' : 'BLOCKED',
    per_probe_index_coverage:
      probeIndexCount === 90 ? '90/90 PASS' : 'not available in historical canary-v2 (pre-repair triplet path)',
    packet_index_coverage: {
      batch_correlation: batchIndexCount === 30 ? 'PASS' : 'BLOCKED',
      per_probe_indexing: probeIndexCount === 90 ? 'PASS' : 'NOT_AVAILABLE_HISTORICAL',
      historical_note:
        'Functional canary PASS; baseline launch requires repaired per-probe triplet indexing path',
      report: packetIndexReport,
    },
    jsonl_hashes: jsonlHashesAfter,
    jsonl_modified: jsonlModified,
  };

  const baselinePackage = buildBaselineLaunchPackage();

  const writeJson = (name, payload) => {
    fs.writeFileSync(path.join(outRoot, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  };

  writeJson('phase32h-r1-canary-v2-final-manifest.json', finalManifest);
  writeJson('phase32h-r1-canary-v2-final-integrity.json', integrity);
  writeJson('phase32h-r1-canary-v2-collector-coverage.json', collectorCoverage);
  writeJson('phase32h-r1-canary-v2-pcap-continuity.json', pcapContinuity);
  writeJson('phase32h-r1-canary-v2-process-stop-ledger.json', {
    frozen_at: frozenAt,
    graceful_timeout_ms: GRACEFUL_MS,
    entries: stopLedger,
  });
  writeJson('phase32h-r1-baseline-launch-package.json', baselinePackage);

  const shaExclude = [
    'phase32h-r1-canary-v2-sha256.txt',
    'FROZEN_PASS_EVIDENCE',
    'FROZEN_BLOCKED_EVIDENCE',
  ];
  const files = walkFiles(outRoot).filter((f) => !shaExclude.some((s) => f.endsWith(s)));
  const shaLines = files.sort().map((f) => `${sha256FileSync(f)}  ${f}`);
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-canary-v2-sha256.txt'), `${shaLines.join('\n')}\n`, 'utf8');

  const report = `# Phase 32H-R1 Canary-v2 PASS Closeout

- Root: \`${outRoot}\`
- Frozen at: ${frozenAt}
- Verdict: **${terminalStatus}**
- Run ID: ${launch.run_id}
- Launch HEAD: ${launch.launch_head}
- Manifest SHA-256: ${launch.manifest_sha256}

## Matrix

- Total: ${matrix.total}/90
- H1/H2/H3: ${matrix.per_protocol.h1}/${matrix.per_protocol.h2}/${matrix.per_protocol.h3}
- Triplet batches: ${matrix.batches}/30
- HTTP 200: ${matrix.http_200}
- HTTP 422: ${matrix.http_422}
- Wrong gate: ${matrix.wrong_gate}
- Retries: ${matrix.retries}

## PCAP / Transport

- PCAP files: ${pcapContinuity.pcap_files}
- Bytes: ${pcapContinuity.total_bytes}
- Packets: ${pcapContinuity.total_packets}
- Drops: ${pcapContinuity.drops}
- UDP 443: ${pcapContinuity.udp_443}
- QUIC versions: ${(pcapContinuity.quic_versions || []).join(', ') || 'n/a'}
- Transport validator: ${transportReport.status}

## Collectors

- Stopped: ${stopLedger.length}
- SIGKILL required: ${collectorCoverage.sigkill_required}

## Packet indexing

- Batch correlation: ${batchIndexCount === 30 ? '30/30 PASS' : 'BLOCKED'}
- Per-probe indexing: ${probeIndexCount === 90 ? '90/90 PASS' : 'not available in historical canary-v2 (pre-repair triplet path)'}
- Baseline launch requires repaired per-probe path (8,640/8,640)

## Baseline

- Status: APPROVAL PENDING
- Proposed root: \`/tmp/phase32h-r1-baseline-r2\`
- Do not launch 8,640 baseline without explicit owner approval.

Production enablement: NOT APPROVED
`;
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-canary-v2-final-report.md'), report, 'utf8');

  if (terminalStatus === 'PASS') {
    fs.writeFileSync(path.join(outRoot, 'FROZEN_PASS_EVIDENCE'), `${frozenAt}\n`, 'utf8');
  } else {
    fs.writeFileSync(path.join(outRoot, 'FROZEN_BLOCKED_EVIDENCE'), `${frozenAt}\n`, 'utf8');
  }

  const remaining = listProcesses().filter((p) => p.command.includes(outRoot));
  console.log(
    JSON.stringify(
      {
        status: terminalStatus,
        frozen_at: frozenAt,
        root: outRoot,
        matrix,
        manifest_contract: manifestContract.status,
        pcap_continuity: pcapContinuity.status,
        transport_validator: transportReport.status,
        collectors_stopped: stopLedger.length,
        sigkill_required: collectorCoverage.sigkill_required,
        processes_remaining: remaining.length,
        jsonl_modified: jsonlModified,
        frozen_marker: terminalStatus === 'PASS' ? 'FROZEN_PASS_EVIDENCE' : 'FROZEN_BLOCKED_EVIDENCE',
        baseline_launch_package: 'phase32h-r1-baseline-launch-package.json',
      },
      null,
      2,
    ),
  );
  process.exit(terminalStatus === 'PASS' ? 0 : 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
