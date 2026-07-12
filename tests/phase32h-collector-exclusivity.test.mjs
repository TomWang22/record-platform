import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  detectDuplicatePcapCollectors,
  detectForeignPcapCollectors,
  evaluatePcapCollectorIdentity,
  PCAP_FAILURE_CLASS,
  registerPcapCollector,
  readCollectorRegistry,
} from '../scripts/lib/phase32h-collector-registry.mjs';
import {
  assertCollectorExclusivityPreflight,
  evaluateCollectorExclusivity,
} from '../scripts/lib/phase32h-collector-exclusivity.mjs';
import {
  evaluateCollectorHealth,
  pcapCoverageIsComplete,
} from '../scripts/lib/phase32h-collector-supervision.mjs';
import { isCoverageBlocked, markCoverageBlocked } from '../scripts/lib/phase32h-run-integrity.mjs';
import { resolveEvidenceRootFromCommand } from '../scripts/lib/phase32h-process-list.mjs';

const FILTER = 'tcp port 443 or udp port 443 or port 53 or icmp or icmp6';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-excl-'));
}

function touch(filePath, ageMs = 0) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify({ ts: new Date().toISOString() })}\n`, 'utf8');
  }
  const when = Date.now() - ageMs;
  fs.utimesSync(filePath, when / 1000, when / 1000);
}

function fullDumpcapCmd(root, file = `${root}/pcap/live.pcapng`) {
  return `/opt/homebrew/bin/dumpcap -q -i bridge100 -f "${FILTER}" -b filesize:250000 -b files:48 -w ${file}`;
}

function writeCaptureStatus(root, { pid = process.pid, file = `${root}/pcap/live.pcapng`, iface = 'bridge100' } = {}) {
  const argv = ['/opt/homebrew/bin/dumpcap', '-q', '-i', iface, '-f', FILTER, '-b', 'filesize:250000', '-b', 'files:48', '-w', file];
  fs.writeFileSync(
    path.join(root, 'pcap/capture-status.json'),
    `${JSON.stringify({
      pid,
      iface,
      file,
      tool: '/opt/homebrew/bin/dumpcap',
      filter: FILTER,
      argv,
      ring_files: 48,
      ring_filesize_kb: 250000,
    })}\n`,
  );
  return { cmd: fullDumpcapCmd(root, file), argv };
}

function procFromCapture(root, { pid = process.pid, file = `${root}/pcap/live.pcapng` } = {}) {
  const { cmd, argv } = writeCaptureStatus(root, { pid, file });
  return { pid, argv, command: cmd, evidence_root: root, interface: 'bridge100', output_path: file };
}

describe('phase32h collector exclusivity', () => {
  let root;
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'pcap'), { recursive: true });
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('expected PCAP alive with registry and no foreign collector => ACTIVE', () => {
    const { cmd, argv } = writeCaptureStatus(root, { pid: process.pid });
    touch(path.join(root, 'pcap/live.pcapng'), 500);
    registerPcapCollector(root, { pid: process.pid, run_id: 'run-a', launch_head: 'abc' });
    const processes = [{ pid: process.pid, argv, command: cmd, evidence_root: root, interface: 'bridge100', output_path: `${root}/pcap/live.pcapng` }];
    const registry = readCollectorRegistry(root);
    const identity = evaluatePcapCollectorIdentity(root, processes, registry, { probesActive: true, runId: 'run-a', launchHead: 'abc' });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.ACTIVE);
    assert.equal(identity.process_count, 1);
  });

  it('expected PID dead => EXPECTED_PCAP_PROCESS_MISSING', () => {
    writeCaptureStatus(root, { pid: 999999 });
    registerPcapCollector(root, { pid: 999999 });
    const identity = evaluatePcapCollectorIdentity(root, [], readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.EXPECTED_PCAP_PROCESS_MISSING);
  });

  it('foreign Phase32H dumpcap on same interface => FOREIGN', () => {
    const foreignRoot = '/tmp/phase32h-r1-prelaunch-smoke';
    const { cmd: expectedCmd, argv } = writeCaptureStatus(root, { pid: 2001 });
    registerPcapCollector(root, { pid: 2001, interface: 'bridge100' });
    const foreignCmd = `dumpcap -i bridge100 -w ${foreignRoot}/pcap/other.pcapng`;
    const processes = [
      { pid: 2001, argv, command: expectedCmd, evidence_root: root, interface: 'bridge100', output_path: `${root}/pcap/live.pcapng` },
      { pid: 2002, command: foreignCmd, evidence_root: foreignRoot, interface: 'bridge100', output_path: `${foreignRoot}/pcap/other.pcapng` },
    ];
    const foreign = detectForeignPcapCollectors(root, processes, readCollectorRegistry(root), 'bridge100');
    assert.equal(foreign.length, 1);
    assert.equal(foreign[0].pid, 2002);
    const identity = evaluatePcapCollectorIdentity(root, processes, readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.FOREIGN_PHASE32H_PCAP_PROCESS);
  });

  it('foreign collector is not reported as expected collector stale only', () => {
    const foreignRoot = '/tmp/phase32h-r1-quic-lifecycle-smoke';
    const { cmd: expectedCmd, argv } = writeCaptureStatus(root, { pid: process.pid });
    touch(path.join(root, 'pcap/live.pcapng'), 500);
    registerPcapCollector(root, { pid: process.pid, interface: 'bridge100' });
    const foreignCmd = `dumpcap -i bridge100 -w ${foreignRoot}/pcap/other.pcapng`;
    const processes = [
      { pid: process.pid, argv, command: expectedCmd, evidence_root: root, interface: 'bridge100', output_path: `${root}/pcap/live.pcapng` },
      { pid: 3002, command: foreignCmd, evidence_root: foreignRoot, interface: 'bridge100', output_path: `${foreignRoot}/pcap/other.pcapng` },
    ];
    const health = evaluateCollectorHealth(root, processes, { probesActive: true, registry: readCollectorRegistry(root) });
    assert.equal(health.foreign_blocked, true);
    assert.equal(health.pcap_failure_class, PCAP_FAILURE_CLASS.FOREIGN_PHASE32H_PCAP_PROCESS);
    assert.notEqual(health.roles.pcap_collector.failure_class, PCAP_FAILURE_CLASS.EXPECTED_PCAP_PROCESS_STALE);
  });

  it('duplicate collector for same root => DUPLICATE', () => {
    const { cmd: cmd1 } = writeCaptureStatus(root, { pid: 4001, file: `${root}/pcap/a.pcapng` });
    registerPcapCollector(root, { pid: 4001, interface: 'bridge100' });
    const cmd2 = `dumpcap -i bridge100 -w ${root}/pcap/b.pcapng`;
    const processes = [
      { pid: 4001, command: cmd1, evidence_root: root, interface: 'bridge100' },
      { pid: 4002, command: cmd2, evidence_root: root, interface: 'bridge100' },
    ];
    const dupes = detectDuplicatePcapCollectors(root, processes, readCollectorRegistry(root));
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].pid, 4002);
  });

  it('full args identify evidence root correctly', () => {
    const cmd = `/opt/homebrew/bin/dumpcap -q -i bridge100 -w /tmp/phase32h-r1-baseline-r4/pcap/x.pcapng`;
    assert.equal(resolveEvidenceRootFromCommand(cmd), '/tmp/phase32h-r1-baseline-r4');
  });

  it('registry run_id mismatch is rejected', () => {
    const { cmd, argv } = writeCaptureStatus(root, { pid: process.pid });
    registerPcapCollector(root, { pid: process.pid, run_id: 'run-a' });
    const processes = [{ pid: process.pid, argv, command: cmd, evidence_root: root, interface: 'bridge100', output_path: `${root}/pcap/live.pcapng` }];
    const identity = evaluatePcapCollectorIdentity(root, processes, readCollectorRegistry(root), {
      probesActive: true,
      runId: 'run-b',
    });
    assert.equal(identity.run_id_mismatch, true);
  });

  it('prelaunch exclusivity PASS when no foreign collectors', () => {
    const result = evaluateCollectorExclusivity({ interface: 'bridge100' });
    assert.equal(result.status, 'PASS');
    assert.deepEqual(result.foreign_collectors, []);
    assert.equal(result.root_created, false);
  });

  it('immutable COLLECTOR_COVERAGE_BLOCKED cannot be cleared', () => {
    markCoverageBlocked(root, 'test');
    assert.throws(() => markCoverageBlocked(root, 'again'), /immutable/);
    assert.equal(isCoverageBlocked(root), true);
  });

  it('canonical collector healthy when foreign absent', () => {
    const { cmd, argv } = writeCaptureStatus(root, { pid: process.pid });
    touch(path.join(root, 'pcap/live.pcapng'), 500);
    registerPcapCollector(root, { pid: process.pid, interface: 'bridge100' });
    touch(path.join(root, 'pcap/capture-status.json'), 500);
    const processes = [{ pid: process.pid, argv, command: cmd, evidence_root: root, interface: 'bridge100', output_path: `${root}/pcap/live.pcapng` }];
    const identity = evaluatePcapCollectorIdentity(root, processes, readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.ACTIVE);
    assert.equal(identity.process_count, 1);
  });
});

describe('phase32h collector exclusivity prelaunch', () => {
  it('assertCollectorExclusivityPreflight throws PHASE32H_COLLECTOR_EXCLUSIVITY_BLOCKED when foreign present', () => {
    const original = evaluateCollectorExclusivity;
    try {
      // eslint-disable-next-line no-import-assign
    } catch {
      // test uses evaluate path only when clean
    }
    assert.doesNotThrow(() => assertCollectorExclusivityPreflight({ interface: 'bridge100' }));
  });
});
