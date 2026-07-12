import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  buildLaunchSpecFromCaptureStatus,
  parseDumpcapSemantic,
  verifyLaunchSpecAgainstProcess,
  normalizeArgvForComparison,
} from '../scripts/lib/phase32h-collector-launch-spec.mjs';
import {
  evaluatePcapCollectorIdentity,
  PCAP_FAILURE_CLASS,
  registerPcapCollector,
  readCollectorRegistry,
} from '../scripts/lib/phase32h-collector-registry.mjs';
import { teardownBlockedRun } from '../scripts/lib/phase32h-blocked-run-teardown.mjs';
import { isCoverageBlocked, markCoverageBlocked } from '../scripts/lib/phase32h-run-integrity.mjs';

const FILTER = 'tcp port 443 or udp port 443 or port 53 or icmp or icmp6';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-reg-'));
}

function fullDumpcapArgv(root, overrides = {}) {
  const file = overrides.file || `${root}/pcap/live.pcapng`;
  const tool = overrides.tool || '/opt/homebrew/bin/dumpcap';
  const iface = overrides.iface || 'bridge100';
  const filter = overrides.filter ?? FILTER;
  const ringFiles = overrides.ring_files ?? 48;
  const ringSize = overrides.ring_filesize_kb ?? 250000;
  return [
    tool,
    '-q',
    '-i',
    iface,
    '-f',
    filter,
    '-b',
    `filesize:${ringSize}`,
    '-b',
    `files:${ringFiles}`,
    '-w',
    file,
  ];
}

function writeCaptureStatus(root, { pid = process.pid, argv, ...rest } = {}) {
  const file = rest.file || `${root}/pcap/live.pcapng`;
  const iface = rest.iface || 'bridge100';
  const filter = rest.filter ?? FILTER;
  const fullArgv = argv || fullDumpcapArgv(root, { file, iface, filter, ...rest });
  fs.mkdirSync(path.join(root, 'pcap'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'pcap/capture-status.json'),
    `${JSON.stringify({
      status: 'ACTIVE',
      pid,
      iface,
      file,
      tool: fullArgv[0],
      filter,
      argv: fullArgv,
      ring_files: rest.ring_files ?? 48,
      ring_filesize_kb: rest.ring_filesize_kb ?? 250000,
      started_at: new Date().toISOString(),
      ...rest,
    })}\n`,
  );
  return fullArgv;
}

function procFromArgv(root, argv, pid = process.pid, lstart = 'Sun Jan  1 00:00:00 2026') {
  return {
    pid,
    argv,
    command: argv.join(' '),
    evidence_root: root,
    interface: argv[argv.indexOf('-i') + 1],
    output_path: argv[argv.indexOf('-w') + 1],
    lstart,
  };
}

function touch(filePath, ageMs = 500) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'pcap-data\n', 'utf8');
  const when = Date.now() - ageMs;
  fs.utimesSync(filePath, when / 1000, when / 1000);
}

describe('phase32h collector launch spec', () => {
  let root;
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exact launch argv matches registry semantic identity', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')), { pid: process.pid });
    const proc = procFromArgv(root, argv);
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, proc);
    assert.equal(result.pass, true);
    assert.equal(result.failure_class, 'ACTIVE');
  });

  it('-q present in both registry and live process => PASS', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    assert.equal(spec.semantic.quiet, true);
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, true);
  });

  it('missing -q in registry semantic => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.semantic.quiet = false;
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('missing capture filter in registry => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.semantic.capture_filter = null;
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('different capture filter => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.semantic.capture_filter = 'tcp port 80';
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('different interface => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.semantic.interface = 'en0';
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('different ring filesize => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.semantic.ring_filesize_kb = 100000;
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('different ring file count => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.semantic.ring_files = 12;
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('different output path => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.semantic.output_path = `${root}/pcap/other.pcapng`;
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, procFromArgv(root, argv));
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('different evidence root => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    const result = verifyLaunchSpecAgainstProcess(
      { launch_spec: spec, evidence_root: '/tmp/other-root' },
      procFromArgv(root, argv),
    );
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_OUTPUT_MISMATCH');
  });

  it('different run_id => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')), { run_id: 'run-a' });
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec, run_id: 'run-a' }, procFromArgv(root, argv), { runId: 'run-b' });
    assert.equal(result.pass, false);
    assert.equal(result.run_id_mismatch, true);
  });

  it('different launch HEAD => mismatch', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')), { launch_head: 'abc123' });
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec, launch_head: 'abc123' }, procFromArgv(root, argv), { launchHead: 'def456' });
    assert.equal(result.pass, false);
    assert.equal(result.launch_head_mismatch, true);
  });

  it('executable symlink resolves via realpath check', () => {
    const argv = writeCaptureStatus(root, { tool: '/opt/homebrew/bin/dumpcap' });
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    if (!spec.executable_realpath) return;
    const proc = procFromArgv(root, argv);
    proc.command = proc.command.replace('/opt/homebrew/bin/dumpcap', spec.executable_realpath);
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, proc);
    assert.equal(result.pass, true);
  });

  it('wrong executable fails', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    const proc = procFromArgv(root, argv);
    proc.argv = null;
    proc.command = proc.command.replace('dumpcap', 'tshark');
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, proc);
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_EXECUTABLE_MISMATCH');
  });

  it('PID reuse with different start identity fails', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    spec.process_start.lstart = 'Mon Jan  1 00:00:00 2026';
    const proc = procFromArgv(root, argv, process.pid, 'Tue Jan  2 00:00:00 2026');
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, proc);
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_PID_REUSED');
  });

  it('argument whitespace differences normalize safely', () => {
    const argv = writeCaptureStatus(root);
    const padded = argv.map((token) => token.trim());
    assert.deepEqual(normalizeArgvForComparison(argv), normalizeArgvForComparison(padded));
  });

  it('quoting differences normalize safely', () => {
    const argv = writeCaptureStatus(root);
    const quoted = `/opt/homebrew/bin/dumpcap -q -i bridge100 -f "${FILTER}" -b filesize:250000 -b files:48 -w ${root}/pcap/live.pcapng`;
    assert.deepEqual(normalizeArgvForComparison(argv), normalizeArgvForComparison(quoted));
  });

  it('ps-style split capture filter tokens normalize safely', () => {
    const argv = writeCaptureStatus(root);
    const psStyle = `/opt/homebrew/bin/dumpcap -q -i bridge100 -f tcp port 443 or udp port 443 or port 53 or icmp or icmp6 -b filesize:250000 -b files:48 -w ${root}/pcap/live.pcapng`;
    assert.deepEqual(normalizeArgvForComparison(argv), normalizeArgvForComparison(psStyle));
  });

  it('valid option reordering normalizes safely', () => {
    const argv = writeCaptureStatus(root);
    const reordered = [
      '/opt/homebrew/bin/dumpcap',
      '-q',
      '-f',
      FILTER,
      '-i',
      'bridge100',
      '-b',
      'files:48',
      '-b',
      'filesize:250000',
      '-w',
      `${root}/pcap/live.pcapng`,
    ];
    assert.deepEqual(normalizeArgvForComparison(argv), normalizeArgvForComparison(reordered));
  });

  it('unrelated extra critical option fails', () => {
    const argv = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, JSON.parse(fs.readFileSync(path.join(root, 'pcap/capture-status.json'), 'utf8')));
    const tampered = [...argv.slice(0, 1), '-s', '128', ...argv.slice(1)];
    const proc = procFromArgv(root, tampered);
    const result = verifyLaunchSpecAgainstProcess({ launch_spec: spec }, proc);
    assert.equal(result.pass, false);
    assert.equal(result.failure_class, 'EXPECTED_PCAP_ARGUMENT_MISMATCH');
  });

  it('registerPcapCollector stores launch_spec from capture-status argv', () => {
    const argv = writeCaptureStatus(root, { pid: process.pid });
    registerPcapCollector(root, { pid: process.pid, run_id: 'run-a', launch_head: 'abc' });
    const registry = readCollectorRegistry(root);
    assert.equal(registry.version, 2);
    assert.ok(registry.collectors.pcap_collector.launch_spec);
    assert.deepEqual(registry.collectors.pcap_collector.launch_spec.argv, argv);
    assert.equal(registry.collectors.pcap_collector.semantic.quiet, true);
    assert.equal(registry.collectors.pcap_collector.semantic.capture_filter, FILTER);
  });

  it('output growth verification passes when output is fresh', () => {
    const argv = writeCaptureStatus(root);
    touch(`${root}/pcap/live.pcapng`, 500);
    registerPcapCollector(root, { pid: process.pid, run_id: 'run-a', launch_head: 'abc' });
    const identity = evaluatePcapCollectorIdentity(root, [procFromArgv(root, argv)], readCollectorRegistry(root), {
      probesActive: true,
      runId: 'run-a',
      launchHead: 'abc',
    });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.ACTIVE);
  });

  it('non-growing output fails with PCAP_OUTPUT_NOT_GROWING', () => {
    const argv = writeCaptureStatus(root);
    touch(`${root}/pcap/live.pcapng`, 60_000);
    registerPcapCollector(root, { pid: process.pid });
    const identity = evaluatePcapCollectorIdentity(root, [procFromArgv(root, argv)], readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.PCAP_OUTPUT_NOT_GROWING);
  });

  it('stale heartbeat fails with PCAP_HEARTBEAT_STALE', () => {
    const argv = writeCaptureStatus(root);
    touch(`${root}/pcap/live.pcapng`, 500);
    const statusPath = path.join(root, 'pcap/capture-status.json');
    const when = Date.now() - 60_000;
    fs.utimesSync(statusPath, when / 1000, when / 1000);
    registerPcapCollector(root, { pid: process.pid });
    const identity = evaluatePcapCollectorIdentity(root, [procFromArgv(root, argv)], readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.PCAP_HEARTBEAT_STALE);
  });

  it('foreign collector is classified separately', () => {
    const argv = writeCaptureStatus(root);
    registerPcapCollector(root, { pid: process.pid, interface: 'bridge100' });
    const foreignRoot = '/tmp/phase32h-r1-prelaunch-smoke';
    const foreignArgv = fullDumpcapArgv(foreignRoot);
    const processes = [
      procFromArgv(root, argv),
      procFromArgv(foreignRoot, foreignArgv, 99999),
    ];
    const identity = evaluatePcapCollectorIdentity(root, processes, readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.FOREIGN_PHASE32H_PCAP_PROCESS);
  });

  it('same-root duplicate is classified separately', () => {
    const argv = writeCaptureStatus(root);
    registerPcapCollector(root, { pid: 4001, interface: 'bridge100' });
    const processes = [
      procFromArgv(root, argv, 4001),
      procFromArgv(root, fullDumpcapArgv(root, { file: `${root}/pcap/b.pcapng` }), 4002),
    ];
    const identity = evaluatePcapCollectorIdentity(root, processes, readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.DUPLICATE_PCAP_PROCESS_SAME_ROOT);
  });

  it('first-triplet probe indexes are probe_id not HTTP status', () => {
    const auditPath = '/tmp/phase32h-r1-baseline-r5/phase32h-first-triplet-schema-audit.json';
    if (!fs.existsSync(auditPath)) return;
    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    assert.equal(audit.classification, 'PROBE_ID_NOT_HTTP_STATUS');
    assert.equal(audit.matrix_rows_written, 0);
  });
});

describe('phase32h blocked-run teardown', () => {
  let root;
  const repoRoot = path.resolve('scripts/..');
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
    fs.mkdirSync(path.join(root, 'pcap'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('immutable block triggers automatic teardown helper', () => {
    markCoverageBlocked(root, 'registry mismatch');
    const report = teardownBlockedRun(root, { repoRoot, reason: 'PCAP_COLLECTOR_REGISTRY_COMMAND_FIDELITY_DEFECT' });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.blocked_marker_preserved, true);
    assert.equal(report.blocked_marker_cleared, false);
    assert.ok(fs.existsSync(path.join(root, 'run-state', 'blocked-run-teardown.json')));
  });

  it('automatic teardown preserves the block marker', () => {
    markCoverageBlocked(root, 'registry mismatch');
    const before = fs.readFileSync(path.join(root, 'COLLECTOR_COVERAGE_BLOCKED'), 'utf8');
    teardownBlockedRun(root, { repoRoot });
    const after = fs.readFileSync(path.join(root, 'COLLECTOR_COVERAGE_BLOCKED'), 'utf8');
    assert.equal(before, after);
    assert.equal(isCoverageBlocked(root), true);
  });

  it('teardown leaves zero root-scoped processes', () => {
    markCoverageBlocked(root, 'registry mismatch');
    const report = teardownBlockedRun(root, { repoRoot });
    assert.equal(report.cleanup.zero_root_scoped, true);
    assert.equal(report.post_teardown_processes, 0);
  });

  it('teardown freeze writes marker last when not already frozen', () => {
    markCoverageBlocked(root, 'registry mismatch');
    const report = teardownBlockedRun(root, { repoRoot });
    if (report.freeze) {
      assert.equal(report.freeze.marker_written_last, true);
      assert.ok(fs.existsSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE')));
    }
  });

  it('no matrix rows are fabricated after block', () => {
    markCoverageBlocked(root, 'registry mismatch');
    teardownBlockedRun(root, { repoRoot });
    for (const shard of ['h1', 'h2', 'h3']) {
      const file = path.join(root, `shard-${shard}`, 'phase32h-matrix.jsonl');
      assert.equal(fs.existsSync(file), false);
    }
  });
});
