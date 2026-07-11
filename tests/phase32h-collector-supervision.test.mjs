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
import { isCoverageBlocked } from '../scripts/lib/phase32h-run-integrity.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-supervisor-'));
}

function touch(filePath, ageMs = 0) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ ts: new Date().toISOString() })}\n`, 'utf8');
  const when = Date.now() - ageMs;
  fs.utimesSync(filePath, when / 1000, when / 1000);
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
    touch(path.join(root, 'pcap/phase32h-test.pcapng'), 120_000);
    const health = evaluateCollectorHealth(
      root,
      [{ pid: 1, command: `/dumpcap -w ${root}/pcap/phase32h-test.pcapng` }],
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
    const processes = [
      { pid: 1, command: `dumpcap -w ${root}/pcap/live.pcapng` },
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
