import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  CREATION_GRACE_MS,
  ROTATION_GRACE_MS,
  STALE_THRESHOLD_MS,
  PCAP_GROWTH_STATE,
  deriveRingOutputSpec,
  discoverRingSegments,
  evaluateRingGrowthHealth,
  parseRingSegmentFilename,
  readRingGrowthObservation,
  writeRingGrowthObservation,
  buildGrowthObservation,
} from '../scripts/lib/phase32h-pcap-ring-segments.mjs';
import {
  evaluatePcapCollectorIdentity,
  PCAP_FAILURE_CLASS,
  registerPcapCollector,
  readCollectorRegistry,
} from '../scripts/lib/phase32h-collector-registry.mjs';
import { buildLaunchSpecFromCaptureStatus } from '../scripts/lib/phase32h-collector-launch-spec.mjs';
import { teardownBlockedRun } from '../scripts/lib/phase32h-blocked-run-teardown.mjs';
import { markCoverageBlocked } from '../scripts/lib/phase32h-run-integrity.mjs';

const FILTER = 'tcp port 443 or udp port 443 or port 53 or icmp or icmp6';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-ring-'));
}

function touch(filePath, { ageMs = 500, content = 'pcap-bytes' } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
  fs.writeFileSync(filePath, Buffer.concat([existing, Buffer.from(content)]));
  const when = Date.now() - ageMs;
  fs.utimesSync(filePath, when / 1000, when / 1000);
}

function ringSegmentPath(root, prefix, seq, ts = '20260712203306') {
  const seqStr = String(seq).padStart(5, '0');
  return path.join(root, 'pcap', `${prefix}_${seqStr}_${ts}.pcapng`);
}

function writeCaptureStatus(root, { pid = process.pid, file, startedAt, ringMode = true } = {}) {
  const pcapFile = file || path.join(root, 'pcap', 'phase32h-test.pcapng');
  const argv = [
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
    pcapFile,
  ];
  fs.mkdirSync(path.join(root, 'pcap'), { recursive: true });
  const payload = {
    status: 'ACTIVE',
    pid,
    iface: 'bridge100',
    file: pcapFile,
    tool: argv[0],
    filter: FILTER,
    argv,
    ring_files: ringMode ? 48 : undefined,
    ring_filesize_kb: ringMode ? 250000 : undefined,
    started_at: startedAt || new Date().toISOString(),
  };
  if (!ringMode) {
    delete payload.ring_files;
    delete payload.ring_filesize_kb;
  }
  fs.writeFileSync(path.join(root, 'pcap/capture-status.json'), `${JSON.stringify(payload)}\n`);
  return payload;
}

function procFromCapture(root, captureStatus, pid = process.pid) {
  return {
    pid,
    argv: captureStatus.argv,
    command: captureStatus.argv.join(' '),
    evidence_root: root,
    interface: 'bridge100',
    output_path: captureStatus.file,
    lstart: 'Sun Jan  1 00:00:00 2026',
  };
}

describe('phase32h ring output spec', () => {
  it('derives ring_buffer spec from configured -w base', () => {
    const base = '/tmp/root/pcap/phase32h-20260713T003305Z.pcapng';
    const spec = deriveRingOutputSpec(base, { ring_files: 48, ring_filesize_kb: 250000, started_at: '2026-07-13T00:33:06Z' }, '/tmp/root');
    assert.equal(spec.output_mode, 'ring_buffer');
    assert.equal(spec.configured_output_base, base);
    assert.equal(spec.segment_prefix, 'phase32h-20260713T003305Z');
    assert.equal(spec.ring_file_count, 48);
  });

  it('configured base retained for argv matching in launch spec', () => {
    const root = tempRoot();
    const capture = writeCaptureStatus(root);
    const spec = buildLaunchSpecFromCaptureStatus(root, capture, { pid: process.pid });
    assert.equal(spec.semantic.output_path, capture.file);
    assert.equal(spec.ring_output.configured_output_base, capture.file);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('phase32h ring segment discovery', () => {
  let root;
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'pcap'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('non-ring base file grows => PASS', () => {
    const base = path.join(root, 'pcap', 'single.pcapng');
    const capture = writeCaptureStatus(root, { file: base, ringMode: false });
    touch(base, { ageMs: 100 });
    const spec = deriveRingOutputSpec(base, capture, root);
    const discovery = discoverRingSegments(root, spec);
    assert.equal(discovery.segment_count, 1);
    assert.equal(discovery.active_segment, base);
    const health = evaluateRingGrowthHealth(root, spec, { probesActive: true });
    assert.equal(health.blocked, false);
    assert.equal(health.growth_state, PCAP_GROWTH_STATE.ACTIVE_GROWING);
  });

  it('ring base absent but _00001_ grows => PASS', () => {
    const base = path.join(root, 'pcap', 'phase32h-test.pcapng');
    const capture = writeCaptureStatus(root, { file: base });
    const seg = ringSegmentPath(root, 'phase32h-test', 1);
    touch(seg, { ageMs: 200, content: 'x'.repeat(1024) });
    const spec = deriveRingOutputSpec(base, capture, root);
    const discovery = discoverRingSegments(root, spec);
    assert.equal(discovery.configured_base_exists, false);
    assert.equal(discovery.segment_count, 1);
    assert.equal(discovery.active_sequence, 1);
    const health = evaluateRingGrowthHealth(root, spec, { probesActive: true });
    assert.equal(health.blocked, false);
    assert.equal(health.growth_state, PCAP_GROWTH_STATE.ACTIVE_GROWING);
  });

  it('first segment appears within creation grace => PASS', () => {
    const base = path.join(root, 'pcap', 'phase32h-grace.pcapng');
    const startedAt = new Date().toISOString();
    const capture = writeCaptureStatus(root, { file: base, startedAt });
    const spec = deriveRingOutputSpec(base, capture, root);
    const health = evaluateRingGrowthHealth(root, spec, { probesActive: true, creationGraceMs: CREATION_GRACE_MS });
    assert.equal(health.growth_state, PCAP_GROWTH_STATE.WAITING_FOR_FIRST_SEGMENT);
    assert.equal(health.blocked, false);
  });

  it('no segment after grace => BLOCKED', () => {
    const base = path.join(root, 'pcap', 'phase32h-noseg.pcapng');
    const startedAt = new Date(Date.now() - CREATION_GRACE_MS - 1000).toISOString();
    const capture = writeCaptureStatus(root, { file: base, startedAt });
    const spec = deriveRingOutputSpec(base, capture, root);
    const health = evaluateRingGrowthHealth(root, spec, { probesActive: true, creationGraceMs: CREATION_GRACE_MS });
    assert.equal(health.growth_state, PCAP_GROWTH_STATE.NO_SEGMENT_BLOCKED);
    assert.equal(health.blocked, true);
  });

  it('segment exists but does not grow => BLOCKED', () => {
    const base = path.join(root, 'pcap', 'phase32h-stale.pcapng');
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    const capture = writeCaptureStatus(root, { file: base, startedAt });
    const seg = ringSegmentPath(root, 'phase32h-stale', 1);
    touch(seg, { ageMs: STALE_THRESHOLD_MS + 5000, content: 'stale' });
    const spec = deriveRingOutputSpec(base, capture, root);
    const prev = buildGrowthObservation(discoverRingSegments(root, spec));
    writeRingGrowthObservation(root, prev);
    const health = evaluateRingGrowthHealth(root, spec, { probesActive: true, staleThresholdMs: STALE_THRESHOLD_MS });
    assert.equal(health.growth_state, PCAP_GROWTH_STATE.OUTPUT_NOT_GROWING);
    assert.equal(health.blocked, true);
  });

  it('_00001_ rotates to _00002_ => PASS', () => {
    const base = path.join(root, 'pcap', 'phase32h-rot.pcapng');
    const capture = writeCaptureStatus(root, { file: base });
    const seg1 = ringSegmentPath(root, 'phase32h-rot', 1);
    const seg2 = ringSegmentPath(root, 'phase32h-rot', 2, '20260712203400');
    touch(seg1, { ageMs: 2000, content: 'a' });
    const spec = deriveRingOutputSpec(base, capture, root);
    const first = evaluateRingGrowthHealth(root, spec, { probesActive: true });
    assert.equal(first.discovery.active_sequence, 1);
    touch(seg2, { ageMs: 100, content: 'b'.repeat(512) });
    const second = evaluateRingGrowthHealth(root, spec, { probesActive: true });
    assert.equal(second.discovery.active_sequence, 2);
    assert.equal(second.blocked, false);
  });

  it('aggregate bytes decrease during ring wrap but active segment advances => PASS', () => {
    const base = path.join(root, 'pcap', 'phase32h-wrap.pcapng');
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const capture = writeCaptureStatus(root, { file: base, startedAt });
    const seg1 = ringSegmentPath(root, 'phase32h-wrap', 1);
    const seg2 = ringSegmentPath(root, 'phase32h-wrap', 2, '20260712203500');
    touch(seg1, { ageMs: 5000, content: 'x'.repeat(10_000) });
    const spec = deriveRingOutputSpec(base, capture, root);
    const firstObs = buildGrowthObservation(discoverRingSegments(root, spec));
    writeRingGrowthObservation(root, firstObs);
    fs.unlinkSync(seg1);
    touch(seg2, { ageMs: 100, content: 'y'.repeat(1000) });
    const health = evaluateRingGrowthHealth(root, spec, { probesActive: true });
    assert.equal(health.discovery.active_sequence, 2);
    assert.equal(health.discovery.aggregate_bytes < firstObs.aggregate_bytes, true);
    assert.equal(health.blocked, false);
  });

  it('unrelated pcapng file ignored', () => {
    const base = path.join(root, 'pcap', 'phase32h-only.pcapng');
    const capture = writeCaptureStatus(root, { file: base });
    touch(path.join(root, 'pcap', 'other-run_00001_20260712203306.pcapng'), { ageMs: 100 });
    const spec = deriveRingOutputSpec(base, capture, root);
    const discovery = discoverRingSegments(root, spec);
    assert.equal(discovery.foreign_segments.length, 1);
    assert.equal(discovery.segment_count, 0);
  });

  it('malformed segment name rejected safely', () => {
    const parsed = parseRingSegmentFilename('badname.pcapng', 'phase32h-test');
    assert.equal(parsed, null);
    const parsed2 = parseRingSegmentFilename('phase32h-test_NOTVALID.pcapng', 'phase32h-test');
    assert.equal(parsed2, null);
  });

  it('path traversal rejected', () => {
    const spec = deriveRingOutputSpec('/etc/passwd', { ring_files: 48, ring_filesize_kb: 250000 }, root);
    const discovery = discoverRingSegments(root, spec);
    assert.equal(discovery.blocked, PCAP_GROWTH_STATE.SEGMENT_OUTSIDE_ROOT_BLOCKED);
  });

  it('observation state survives supervisor restart', () => {
    const base = path.join(root, 'pcap', 'phase32h-obs.pcapng');
    const capture = writeCaptureStatus(root, { file: base });
    touch(ringSegmentPath(root, 'phase32h-obs', 1), { ageMs: 200, content: 'z' });
    const spec = deriveRingOutputSpec(base, capture, root);
    evaluateRingGrowthHealth(root, spec, { probesActive: true });
    const stored = readRingGrowthObservation(root);
    assert.ok(stored);
    assert.equal(stored.segment_count, 1);
  });

  it('truncated observation state fails closed via null previous', () => {
    const obsPath = path.join(root, 'run-state', 'pcap-ring-growth-observation.json');
    fs.mkdirSync(path.dirname(obsPath), { recursive: true });
    fs.writeFileSync(obsPath, '{"bad":true}\n');
    const base = path.join(root, 'pcap', 'phase32h-trunc.pcapng');
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    const capture = writeCaptureStatus(root, { file: base, startedAt });
    touch(ringSegmentPath(root, 'phase32h-trunc', 1), { ageMs: 200, content: 'fresh' });
    const spec = deriveRingOutputSpec(base, capture, root);
    const health = evaluateRingGrowthHealth(root, spec, { probesActive: true, staleThresholdMs: STALE_THRESHOLD_MS });
    assert.equal(health.blocked, false);
    assert.equal(health.growth_state, PCAP_GROWTH_STATE.ACTIVE_GROWING);
  });
});

describe('phase32h ring growth registry integration', () => {
  let root;
  beforeEach(() => {
    root = tempRoot();
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('registry identity PASS with ring segment instead of base path', () => {
    const base = path.join(root, 'pcap', 'phase32h-live.pcapng');
    const capture = writeCaptureStatus(root, { file: base });
    touch(ringSegmentPath(root, 'phase32h-live', 1), { ageMs: 200, content: 'live' });
    registerPcapCollector(root, { pid: process.pid, run_id: 'run-a', launch_head: 'abc' });
    const identity = evaluatePcapCollectorIdentity(root, [procFromCapture(root, capture)], readCollectorRegistry(root), {
      probesActive: true,
      runId: 'run-a',
      launchHead: 'abc',
    });
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.ACTIVE);
    assert.ok(identity.active_segment?.includes('_00001_'));
  });

  it('generated segment used only for growth tracking; argv still uses base', () => {
    const base = path.join(root, 'pcap', 'phase32h-base.pcapng');
    const capture = writeCaptureStatus(root, { file: base });
    const spec = buildLaunchSpecFromCaptureStatus(root, capture);
    assert.equal(spec.semantic.output_path, base);
    touch(ringSegmentPath(root, 'phase32h-base', 1), { ageMs: 200 });
    registerPcapCollector(root, { pid: process.pid });
    const identity = evaluatePcapCollectorIdentity(root, [procFromCapture(root, capture)], readCollectorRegistry(root), { probesActive: true });
    assert.equal(identity.output_path, base);
    assert.equal(identity.failure_class, PCAP_FAILURE_CLASS.ACTIVE);
  });

  it('creation grace and rotation grace constants are bounded', () => {
    assert.ok(CREATION_GRACE_MS > 0 && CREATION_GRACE_MS <= 60_000);
    assert.ok(ROTATION_GRACE_MS > 0 && ROTATION_GRACE_MS <= 30_000);
    assert.ok(STALE_THRESHOLD_MS > ROTATION_GRACE_MS);
  });

  it('automatic immutable-block teardown still works', () => {
    markCoverageBlocked(root, 'ring growth blocked');
    const report = teardownBlockedRun(root, { repoRoot: path.resolve('scripts/..') });
    assert.equal(report.blocked_marker_preserved, true);
    assert.equal(report.status, 'BLOCKED');
  });

  it('no matrix rows fabricated after block', () => {
    markCoverageBlocked(root, 'ring growth blocked');
    teardownBlockedRun(root, { repoRoot: path.resolve('scripts/..') });
    for (const shard of ['h1', 'h2', 'h3']) {
      assert.equal(fs.existsSync(path.join(root, `shard-${shard}/phase32h-matrix.jsonl`)), false);
    }
  });
});
