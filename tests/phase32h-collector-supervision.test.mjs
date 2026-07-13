import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  evaluateCollectorHealth,
  pcapCoverageIsComplete,
  assertCollectorCoverageOrBlock,
} from '../scripts/lib/phase32h-collector-supervision.mjs';
import { registerPcapCollector } from '../scripts/lib/phase32h-collector-registry.mjs';
import { isCoverageBlocked } from '../scripts/lib/phase32h-run-integrity.mjs';

const FILTER = 'tcp port 443 or udp port 443 or port 53 or icmp or icmp6';

function tempRoot() {
  return fs.mkdtempSync(path.join('/tmp', 'phase32h-supervisor-'));
}

function touch(filePath, ageMs = 0) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify({ ts: new Date().toISOString() })}\n`, 'utf8');
  }
  const when = Date.now() - ageMs;
  fs.utimesSync(filePath, when / 1000, when / 1000);
}

function writeCaptureStatus(root, { pid = process.pid, file = `${root}/pcap/live.pcapng` } = {}) {
  const argv = ['/opt/homebrew/bin/dumpcap', '-q', '-i', 'bridge100', '-f', FILTER, '-b', 'filesize:250000', '-b', 'files:48', '-w', file];
  fs.writeFileSync(
    path.join(root, 'pcap/capture-status.json'),
    `${JSON.stringify({
      pid,
      iface: 'bridge100',
      file,
      tool: '/opt/homebrew/bin/dumpcap',
      filter: FILTER,
      argv,
      ring_files: 48,
      ring_filesize_kb: 250000,
    })}\n`,
  );
  const cmd = `/opt/homebrew/bin/dumpcap -q -i bridge100 -f "${FILTER}" -b filesize:250000 -b files:48 -w ${file}`;
  return { cmd, argv };
}

describe('phase32h collector supervision', () => {
  let root;
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'pcap'), { recursive: true });
    fs.mkdirSync(path.join(root, 'heartbeats'), { recursive: true });
    fs.mkdirSync(path.join(root, 'telemetry'), { recursive: true });
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('flags stale PCAP during active probes', () => {
    const { cmd, argv } = writeCaptureStatus(root, { pid: process.pid, file: `${root}/pcap/phase32h-test.pcapng` });
    touch(path.join(root, 'pcap/phase32h-test.pcapng'), 120_000);
    touch(path.join(root, 'pcap/capture-status.json'), 120_000);
    registerPcapCollector(root, { pid: process.pid, interface: 'bridge100' });
    const health = evaluateCollectorHealth(
      root,
      [{
        pid: process.pid,
        comm: 'dumpcap',
        argv,
        command: cmd,
        evidence_root: root,
        output_path: `${root}/pcap/phase32h-test.pcapng`,
        interface: 'bridge100',
      }],
      { probesActive: true },
    );
    assert.equal(health.roles.pcap_collector.status, 'STALE');
    assert.equal(pcapCoverageIsComplete(health, { probesActive: true }), false);
  });

  it('blocks run when mandatory collector unhealthy', () => {
    const health = {
      overall_status: 'BLOCKED',
      unhealthy_roles: ['pcap_collector'],
      roles: { pcap_collector: { status: 'STALE' } },
    };
    const result = assertCollectorCoverageOrBlock(root, health, 'pcap died');
    assert.equal(result.blocked, true);
    assert.equal(isCoverageBlocked(root), true);
  });

  it('treats PCAP gap as incomplete coverage for PASS', () => {
    touch(path.join(root, 'pcap/phase32h-old.pcapng'), 90_000);
    const health = evaluateCollectorHealth(root, [], { probesActive: true });
    assert.notEqual(health.roles.pcap_collector.status, 'ACTIVE');
    assert.equal(pcapCoverageIsComplete(health, { probesActive: true }), false);
  });

  it('accepts fresh heartbeats during active probes', () => {
    const { cmd: pcapCmd, argv } = writeCaptureStatus(root, { pid: process.pid });
    touch(path.join(root, 'heartbeats/h1.jsonl'), 500);
    touch(path.join(root, 'heartbeats/h2.jsonl'), 500);
    touch(path.join(root, 'heartbeats/h3.jsonl'), 500);
    touch(path.join(root, 'heartbeats/watchdog.jsonl'), 500);
    touch(path.join(root, 'telemetry/host-telemetry.jsonl'), 500);
    touch(path.join(root, 'telemetry/power-events.jsonl'), 1000);
    touch(path.join(root, 'logs/gateway-access-tail.txt'), 1000);
    touch(path.join(root, 'logs/application-log-tail.txt'), 1000);
    touch(path.join(root, 'phase32h-monitor.log'), 1000);
    touch(path.join(root, 'pcap/live.pcapng'), 500);
    const seg = path.join(root, 'pcap', 'live_00001_20260712203306.pcapng');
    touch(seg, 500);
    registerPcapCollector(root, { pid: process.pid, interface: 'bridge100' });
    touch(path.join(root, 'pcap/capture-status.json'), 500);
    const processes = [
      { pid: process.pid, comm: 'dumpcap', argv, command: pcapCmd, evidence_root: root, output_path: `${root}/pcap/live.pcapng`, interface: 'bridge100' },
      { pid: 2, command: `phase32h-extreme-watchdog.mjs --out ${root}` },
      { pid: 3, command: `phase32h-capture-host-telemetry.sh ${root}` },
      { pid: 4, command: `phase32h-start-gateway-log-capture.sh ${root}` },
      { pid: 5, command: `phase32h-start-application-log-capture.sh ${root}` },
      { pid: 6, command: `phase32h-monitor-targeted-reproduction.sh` },
      { pid: 7, command: `phase32h-targeted-reproduction-runner.mjs --protocol h1 --out ${root}` },
      { pid: 8, command: `phase32h-targeted-reproduction-runner.mjs --protocol h2 --out ${root}` },
      { pid: 9, command: `phase32h-targeted-reproduction-runner.mjs --protocol h3 --out ${root}` },
    ];
    const health = evaluateCollectorHealth(root, processes, { probesActive: true, monitorIntervalMs: 300_000 });
    assert.equal(health.overall_status, 'ACTIVE');
  });
});
