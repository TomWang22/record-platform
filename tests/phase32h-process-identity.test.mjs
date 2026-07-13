import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  ALLOWED_CAPTURE_EXECUTABLES,
  IGNORED_DIAGNOSTIC_EXECUTABLES,
  PROCESS_CLASSIFICATION,
  buildProcessInspection,
  enrichProcessAsCollectorCandidate,
  evaluateDuplicateCollectorDecision,
  evaluateForeignCollectorDecision,
  isPcapCollectorCandidate,
  listCaptureCollectorCandidates,
  parseStructuredCaptureArgv,
} from '../scripts/lib/phase32h-process-identity.mjs';
import {
  detectDuplicatePcapCollectors,
  detectForeignPcapCollectors,
  evaluatePcapCollectorIdentity,
  PCAP_FAILURE_CLASS,
  registerPcapCollector,
  readCollectorRegistry,
} from '../scripts/lib/phase32h-collector-registry.mjs';
import { teardownBlockedRun } from '../scripts/lib/phase32h-blocked-run-teardown.mjs';
import { markCoverageBlocked } from '../scripts/lib/phase32h-run-integrity.mjs';

const FILTER = 'tcp port 443 or udp port 443 or port 53 or icmp or icmp6';
const R7_ROOT = '/tmp/phase32h-r1-baseline-r7';

function tempRoot() {
  return fs.mkdtempSync(path.join('/tmp', 'phase32h-pid-'));
}

function dumpcapArgv(root, file = `${root}/pcap/live.pcapng`, pid = process.pid) {
  return {
    pid,
    comm: 'dumpcap',
    argv: [
      '/opt/homebrew/bin/dumpcap',
      '-q',
      '-i',
      'bridge100',
      '-f',
      FILTER,
      '-b',
      'filesize:250000',
      '-b',
      'files:48',
      '-w',
      file,
    ],
    command: `/opt/homebrew/bin/dumpcap -q -i bridge100 -f "${FILTER}" -b filesize:250000 -b files:48 -w ${file}`,
    lstart: 'Mon Jul 13 10:45:10 2026',
  };
}

function shellMentioningDumpcap(root) {
  return {
    pid: 10745,
    ppid: 22935,
    comm: 'bash',
    lstart: 'Mon Jul 13 10:45:46 2026',
    command: `/opt/homebrew/bin/bash -c ps -axo pid=,args= | rg dumpcap ${root}`,
  };
}

describe('phase32h process identity', () => {
  let root;
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'pcap'), { recursive: true });
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('allowed capture executables include dumpcap and tcpdump', () => {
    assert.equal(ALLOWED_CAPTURE_EXECUTABLES.has('dumpcap'), true);
    assert.equal(ALLOWED_CAPTURE_EXECUTABLES.has('tcpdump'), true);
  });

  it('diagnostic executables are ignored', () => {
    for (const exe of ['bash', 'node', 'rg', 'ps', 'python3']) {
      assert.equal(IGNORED_DIAGNOSTIC_EXECUTABLES.has(exe), true);
    }
  });

  it('real registered dumpcap => PCAP_COLLECTOR_CANDIDATE', () => {
    const proc = dumpcapArgv(root);
    const inspection = buildProcessInspection(proc);
    assert.equal(inspection.classification, PROCESS_CLASSIFICATION.PCAP_COLLECTOR_CANDIDATE);
    assert.equal(inspection.evidence_root, root);
  });

  it('bash -c quoting dumpcap and root => NON_COLLECTOR', () => {
    const proc = shellMentioningDumpcap(root);
    const inspection = buildProcessInspection(proc);
    assert.equal(inspection.classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
    assert.equal(isPcapCollectorCandidate(proc), false);
  });

  it('bash -c echo dumpcap -w path => NON_COLLECTOR', () => {
    const proc = {
      pid: 2001,
      comm: 'bash',
      command: `bash -c 'echo dumpcap -w ${root}/pcap/live.pcapng'`,
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
  });

  it('rg searching dumpcap|baseline => NON_COLLECTOR', () => {
    const proc = {
      pid: 2002,
      comm: 'rg',
      command: `rg 'dumpcap|${path.basename(root)}' ${root}`,
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
  });

  it('ps command containing target strings => NON_COLLECTOR', () => {
    const proc = {
      pid: 2003,
      comm: 'ps',
      command: `ps -axo pid=,args= | grep dumpcap | grep ${root}`,
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
  });

  it('node status tool mentioning root => NON_COLLECTOR', () => {
    const proc = {
      pid: 2004,
      comm: 'node',
      command: `node scripts/phase32h-runtime-status-readonly.mjs --out ${root}`,
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
  });

  it('python analyzer mentioning PCAP paths => NON_COLLECTOR', () => {
    const proc = {
      pid: 2005,
      comm: 'python3',
      command: `python3 -c "print('dumpcap -w ${root}/pcap/live.pcapng')"`,
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
  });

  it('wc/ls diagnostic shell => NON_COLLECTOR', () => {
    const proc = { pid: 2006, comm: 'wc', command: `wc -l ${root}/phase32h-monitor.log`, lstart: 'Mon Jul 13 10:45:46 2026' };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
  });

  it('allowed executable with malformed argv => MALFORMED_CAPTURE_CANDIDATE', () => {
    const proc = {
      pid: 2007,
      comm: 'dumpcap',
      argv: ['/opt/homebrew/bin/dumpcap', '-q'],
      command: '/opt/homebrew/bin/dumpcap -q',
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(
      buildProcessInspection(proc).classification,
      PROCESS_CLASSIFICATION.MALFORMED_CAPTURE_CANDIDATE,
    );
  });

  it('dumpcap with output outside allowed roots => not candidate', () => {
    const proc = dumpcapArgv('/tmp/not-phase32h', '/tmp/not-phase32h/x.pcapng');
    assert.equal(isPcapCollectorCandidate(proc), false);
  });

  it('PID reuse via start identity mismatch is detectable', () => {
    const proc = dumpcapArgv(root);
    const decision = evaluateForeignCollectorDecision({
      candidate: enrichProcessAsCollectorCandidate(proc),
      activeRoot: root,
      registeredPid: proc.pid,
      registeredStartIdentity: '9999:Mon Jul 13 10:45:10 2026',
    });
    assert.equal(decision.pid_reuse, true);
  });

  it('offline tshark analysis => NON_COLLECTOR', () => {
    const proc = {
      pid: 2008,
      comm: 'tshark',
      argv: ['tshark', '-r', '/tmp/capture.pcapng'],
      command: 'tshark -r /tmp/capture.pcapng',
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.NON_COLLECTOR);
  });

  it('live tshark capture with -i => candidate when under phase32h root', () => {
    const file = `${root}/pcap/live.pcapng`;
    const proc = {
      pid: 2009,
      comm: 'tshark',
      argv: ['tshark', '-i', 'bridge100', '-w', file],
      command: `tshark -i bridge100 -w ${file}`,
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(buildProcessInspection(proc).classification, PROCESS_CLASSIFICATION.PCAP_COLLECTOR_CANDIDATE);
  });

  it('shell parent of real dumpcap => shell ignored', () => {
    const shell = shellMentioningDumpcap(root);
    const child = dumpcapArgv(root, `${root}/pcap/live.pcapng`, 8884);
    const candidates = listCaptureCollectorCandidates([shell, child]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].pid, 8884);
  });

  it('diagnostic shell owns no PCAP => ignored', () => {
    const shell = shellMentioningDumpcap(R7_ROOT);
    assert.equal(enrichProcessAsCollectorCandidate(shell), null);
  });

  it('missing comm with requireComm => PROCESS_INSPECTION_ERROR', () => {
    const proc = dumpcapArgv(root);
    delete proc.comm;
    const inspection = buildProcessInspection(proc, { requireComm: true });
    assert.equal(inspection.classification, PROCESS_CLASSIFICATION.PROCESS_INSPECTION_ERROR);
  });

  it('truncated process snapshot without executable => fail closed', () => {
    const proc = { pid: 2010, comm: '', command: '', lstart: 'Mon Jul 13 10:45:46 2026' };
    const inspection = buildProcessInspection(proc, { requireComm: true });
    assert.equal(inspection.classification, PROCESS_CLASSIFICATION.PROCESS_INSPECTION_ERROR);
  });

  it('second real dumpcap on another root => foreign collector', () => {
    const foreignRoot = tempRoot();
    fs.mkdirSync(path.join(foreignRoot, 'pcap'), { recursive: true });
    fs.mkdirSync(path.join(foreignRoot, 'run-state'), { recursive: true });
    const local = dumpcapArgv(root, `${root}/pcap/live.pcapng`, 4001);
    const foreign = dumpcapArgv(foreignRoot, `${foreignRoot}/pcap/live.pcapng`, 4002);
    fs.writeFileSync(
      path.join(root, 'pcap/capture-status.json'),
      `${JSON.stringify({ pid: 4001, iface: 'bridge100', file: `${root}/pcap/live.pcapng`, argv: local.argv, filter: FILTER })}\n`,
    );
    registerPcapCollector(root, { pid: 4001, interface: 'bridge100' });
    const foreignHits = detectForeignPcapCollectors(root, [local, foreign], readCollectorRegistry(root));
    assert.equal(foreignHits.length, 1);
    assert.equal(foreignHits[0].pid, 4002);
    fs.rmSync(foreignRoot, { recursive: true, force: true });
  });

  it('second real dumpcap on same root => duplicate collector', () => {
    const a = dumpcapArgv(root, `${root}/pcap/a.pcapng`, 4001);
    const b = dumpcapArgv(root, `${root}/pcap/b.pcapng`, 4002);
    fs.writeFileSync(
      path.join(root, 'pcap/capture-status.json'),
      `${JSON.stringify({ pid: 4001, iface: 'bridge100', file: `${root}/pcap/a.pcapng`, argv: a.argv, filter: FILTER })}\n`,
    );
    registerPcapCollector(root, { pid: 4001, interface: 'bridge100' });
    const dups = detectDuplicatePcapCollectors(root, [a, b], readCollectorRegistry(root));
    assert.equal(dups.length, 1);
    assert.equal(dups[0].pid, 4002);
  });

  it('R7 false-positive shell would not foreign-block with executable identity', () => {
    const registered = dumpcapArgv(root, `${root}/pcap/live.pcapng`, 8884);
    const falseShell = {
      pid: 10745,
      ppid: 22935,
      comm: 'bash',
      lstart: 'Mon Jul 13 10:45:46 2026',
      command: `/opt/homebrew/bin/bash -c OUT=${root} python3 -c "if 'dumpcap' in line: pass"`,
    };
    fs.writeFileSync(
      path.join(root, 'pcap/capture-status.json'),
      `${JSON.stringify({
        pid: 8884,
        iface: 'bridge100',
        file: `${root}/pcap/live.pcapng`,
        argv: registered.argv,
        filter: FILTER,
        ring_files: 48,
        ring_filesize_kb: 250000,
      })}\n`,
    );
    registerPcapCollector(root, { pid: 8884, interface: 'bridge100' });
    const identity = evaluatePcapCollectorIdentity(
      root,
      [registered, falseShell],
      readCollectorRegistry(root),
      { probesActive: true },
    );
    assert.notEqual(identity.failure_class, PCAP_FAILURE_CLASS.FOREIGN_PHASE32H_PCAP_PROCESS);
  });

  it('foreign process decision requires executable candidate', () => {
    const shell = shellMentioningDumpcap(root);
    const decision = evaluateForeignCollectorDecision({
      candidate: buildProcessInspection(shell),
      activeRoot: root,
      registeredPid: 4001,
    });
    assert.equal(decision.foreign, false);
  });

  it('duplicate decision for second dumpcap on same root', () => {
    const candidate = enrichProcessAsCollectorCandidate(dumpcapArgv(root, `${root}/pcap/b.pcapng`, 4002));
    const decision = evaluateDuplicateCollectorDecision({
      candidate,
      activeRoot: root,
      registeredPid: 4001,
    });
    assert.equal(decision.duplicate, true);
  });

  it('parseStructuredCaptureArgv extracts interface and output', () => {
    const proc = dumpcapArgv(root);
    const parsed = parseStructuredCaptureArgv(proc);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.interface, 'bridge100');
    assert.equal(parsed.output_path, `${root}/pcap/live.pcapng`);
  });

  it('fake executable named dumpcap but wrong argv fails malformed or non-candidate', () => {
    const proc = {
      pid: 2011,
      comm: 'bash',
      command: 'bash /tmp/fake-dumpcap-wrapper.sh',
      lstart: 'Mon Jul 13 10:45:46 2026',
    };
    assert.equal(isPcapCollectorCandidate(proc), false);
  });
});

describe('phase32h process identity freeze regression', () => {
  let root;
  const repoRoot = path.resolve('scripts/..');
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('immutable block teardown still works', () => {
    markCoverageBlocked(root, 'test');
    const report = teardownBlockedRun(root, { repoRoot, reason: 'TEST_BLOCK' });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.blocked_marker_preserved, true);
  });

  it('no matrix rows fabricated after block', () => {
    markCoverageBlocked(root, 'test');
    teardownBlockedRun(root, { repoRoot });
    for (const shard of ['h1', 'h2', 'h3']) {
      assert.equal(fs.existsSync(path.join(root, `shard-${shard}`, 'phase32h-matrix.jsonl')), false);
    }
  });
});
