import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { writeBatchPacketIndex } from '../scripts/lib/phase32h-batch-packet-index.mjs';
import {
  assertPacketIndexCoverage,
  assertRedactedProbePacketIndex,
  evaluatePacketIndexCoverage,
} from '../scripts/lib/phase32h-packet-index-coverage.mjs';
import { writeProbePacketIndex } from '../scripts/lib/phase32h-probe-packet-index.mjs';
import {
  buildRedactedTripletProbeIndex,
  transportEvidenceForProtocol,
  writeTripletProbePacketIndexes,
} from '../scripts/lib/phase32h-triplet-probe-packet-index.mjs';

function mockBatch(batchId = 'w1-r1-u1-c1') {
  return {
    batch_id: batchId,
    coordinate: { window: 1, run: 1, case_id: 'c1', user_uid: 'u1', user_class: 'a' },
    h1: { probe_id: 101, matrix_protocol: 'h1', protocol_label: 'HTTP/1.1' },
    h2: { probe_id: 102, matrix_protocol: 'h2', protocol_label: 'HTTP/2' },
    h3: { probe_id: 103, matrix_protocol: 'h3', protocol_label: 'HTTP/3' },
    probe_ids: { h1: 101, h2: 102, h3: 103 },
  };
}

function mockWorkerResult(startedEpoch = 1_700_000_000) {
  return {
    started_at: new Date(startedEpoch * 1000).toISOString(),
    started_epoch: startedEpoch,
    finished_epoch: startedEpoch + 0.5,
  };
}

function mockAnalysis(protoKey) {
  if (protoKey === 'h3') {
    return {
      packets: [
        {
          five_tuple: { transport: 'udp', src: '10.0.0.1', dst: '10.0.0.2', sport: 54321, dport: 443 },
          udp_stream: 7,
          quic_version_label: 'QUICv1',
          packet_spaces: ['INITIAL', 'HANDSHAKE', 'ONE_RTT'],
        },
      ],
      counts: { initial_packets: 2, handshake_packets: 1, one_rtt_packets: 4, zero_rtt_packets: 0 },
      correlation_status: 'CORRELATED',
      pcap_first_frame: 10,
      pcap_last_frame: 20,
    };
  }
  return {
    packets: [
      {
        five_tuple: { transport: 'tcp', src: '10.0.0.1', dst: '10.0.0.2', sport: 44321, dport: 443 },
        tcp_stream: 3,
        http2_stream: protoKey === 'h2' ? 1 : null,
        http2_type: protoKey === 'h2' ? 'HEADERS' : null,
      },
    ],
    correlation_status: 'CORRELATED',
    pcap_first_frame: 1,
    pcap_last_frame: 5,
  };
}

describe('phase32h per-probe packet indexing', () => {
  let outRoot;

  beforeEach(() => {
    outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-probe-index-'));
  });

  afterEach(() => {
    fs.rmSync(outRoot, { recursive: true, force: true });
  });

  it('emits independent indexes for all three triplet members', () => {
    const batch = mockBatch();
    const runId = 'run-test';
    const launchHead = 'abc123';
    const results = {
      h1: mockWorkerResult(),
      h2: mockWorkerResult(),
      h3: mockWorkerResult(),
    };
    const written = writeTripletProbePacketIndexes({
      outRoot,
      batch,
      runId,
      launchHead,
      results,
      failIfExists: true,
    });
    assert.equal(written.length, 3);
    assert.deepEqual(
      written.map((w) => w.probe_id).sort((a, b) => a - b),
      [101, 102, 103],
    );
  });

  it('indexes reference the correct shared batch', () => {
    const batch = mockBatch('batch-shared');
    writeTripletProbePacketIndexes({
      outRoot,
      batch,
      runId: 'run-shared',
      launchHead: 'sha-shared',
      results: { h1: mockWorkerResult(), h2: mockWorkerResult(), h3: mockWorkerResult() },
      failIfExists: true,
    });
    const report = evaluatePacketIndexCoverage(outRoot, {
      expectedProbeIndexes: 3,
      expectedBatchCorrelations: 0,
      requirePerProbeIndexes: true,
    });
    assert.equal(report.status, 'PASS');
    for (const row of report.probe_index_count ? [] : []) {
      void row;
    }
    const indexes = fs.readdirSync(path.join(outRoot, 'probe-packet-index'));
    assert.equal(indexes.length, 3);
    for (const file of indexes) {
      const record = JSON.parse(fs.readFileSync(path.join(outRoot, 'probe-packet-index', file), 'utf8'));
      assert.equal(record.batch_id, 'batch-shared');
      assert.equal(record.run_id, 'run-shared');
      assert.equal(record.launch_head, 'sha-shared');
    }
  });

  it('H1 index contains TCP evidence', () => {
    const record = buildRedactedTripletProbeIndex({
      probe: mockBatch().h1,
      protoKey: 'h1',
      batchId: 'b1',
      runId: 'r1',
      launchHead: 'h1',
      workerResult: mockWorkerResult(),
      analysis: mockAnalysis('h1'),
      pcapFiles: ['/tmp/pcap.pcapng'],
    });
    assert.equal(record.transport, 'tcp');
    assert.equal(record.transport_evidence.tcp_packets, 1);
    assert.equal(record.transport_evidence.http2_frames, 0);
  });

  it('H2 index contains TCP/H2 evidence', () => {
    const record = buildRedactedTripletProbeIndex({
      probe: mockBatch().h2,
      protoKey: 'h2',
      batchId: 'b1',
      runId: 'r1',
      launchHead: 'h2',
      workerResult: mockWorkerResult(),
      analysis: mockAnalysis('h2'),
      pcapFiles: ['/tmp/pcap.pcapng'],
    });
    assert.equal(record.transport, 'tcp');
    assert.equal(record.transport_evidence.tcp_packets, 1);
    assert.ok(record.transport_evidence.http2_frames > 0 || record.transport_evidence.http2_detected);
  });

  it('H3 index contains UDP/QUIC evidence', () => {
    const record = buildRedactedTripletProbeIndex({
      probe: mockBatch().h3,
      protoKey: 'h3',
      batchId: 'b1',
      runId: 'r1',
      launchHead: 'h3',
      workerResult: mockWorkerResult(),
      analysis: mockAnalysis('h3'),
      pcapFiles: ['/tmp/pcap.pcapng'],
    });
    assert.equal(record.transport, 'udp');
    assert.equal(record.transport_evidence.udp_packets, 1);
    assert.ok(record.transport_evidence.quic_packets >= 1);
    assert.equal(record.transport_evidence.initial_packets, 2);
  });

  it('does not overwrite an existing probe index', () => {
    writeProbePacketIndex(outRoot, 101, {
      probe_id: 101,
      batch_id: 'existing',
      protocol: 'h1',
      protocol_label: 'HTTP/1.1',
      run_id: 'r',
      launch_head: 'h',
      request_started_at: new Date().toISOString(),
      request_finished_at: new Date().toISOString(),
      pcap_files: [],
      transport: 'tcp',
      transport_evidence: transportEvidenceForProtocol('h1', { packets: [] }),
      correlation_status: 'PARTIAL',
    });
    assert.throws(
      () =>
        writeTripletProbePacketIndexes({
          outRoot,
          batch: mockBatch(),
          runId: 'r1',
          launchHead: 'h1',
          results: { h1: mockWorkerResult(), h2: mockWorkerResult(), h3: mockWorkerResult() },
          failIfExists: true,
        }),
      /already exists/,
    );
  });

  it('blocks final PASS when probe indexes are missing', () => {
    writeBatchPacketIndex(outRoot, {
      batch_id: 'b1',
      run_id: 'r1',
      member_probe_ids: { h1: 1, h2: 2, h3: 3 },
      coordinate: { window: 1, run: 1, case_id: 'c', user_class: 'a' },
      start_spread_ms: 10,
      batch_timing_status: 'PASS',
      packet_correlation_status: 'PENDING',
    });
    const report = evaluatePacketIndexCoverage(outRoot, {
      expectedProbeIndexes: 3,
      expectedBatchCorrelations: 1,
      requirePerProbeIndexes: true,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.throws(
      () =>
        assertPacketIndexCoverage(outRoot, {
          expectedProbeIndexes: 3,
          expectedBatchCorrelations: 1,
          requirePerProbeIndexes: true,
        }),
      (err) => err.code === 'PHASE32H_PACKET_INDEX_COVERAGE_BLOCKED',
    );
  });

  it('blocks final PASS when duplicate probe indexes exist', () => {
    const good = {
      probe_id: 1,
      batch_id: 'b1',
      protocol: 'h1',
      protocol_label: 'HTTP/1.1',
      run_id: 'r1',
      launch_head: 'h1',
      request_started_at: new Date().toISOString(),
      request_finished_at: new Date().toISOString(),
      pcap_files: [],
      transport: 'tcp',
      transport_evidence: transportEvidenceForProtocol('h1', { packets: [] }),
      correlation_status: 'PARTIAL',
    };
    writeProbePacketIndex(outRoot, 1, good);
    writeProbePacketIndex(outRoot, 2, { ...good, probe_id: 1 });
    const report = evaluatePacketIndexCoverage(outRoot, {
      expectedProbeIndexes: 2,
      requirePerProbeIndexes: true,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(report.duplicate_probe_indexes > 0);
  });

  it('private-field scan passes on redacted probe indexes', () => {
    const record = buildRedactedTripletProbeIndex({
      probe: mockBatch().h1,
      protoKey: 'h1',
      batchId: 'b1',
      runId: 'r1',
      launchHead: 'h1',
      workerResult: mockWorkerResult(),
      analysis: mockAnalysis('h1'),
      pcapFiles: [],
    });
    assert.doesNotThrow(() => assertRedactedProbePacketIndex(record));
    assert.throws(
      () => assertRedactedProbePacketIndex({ ...record, question: 'secret prompt' }),
      /forbidden probe packet index field/,
    );
  });

  it('canary-scale fixture reaches 90/90 probe-index coverage', () => {
    const runId = 'canary-fixture';
    const launchHead = 'fixture-sha';
    for (let batch = 0; batch < 30; batch += 1) {
      const base = batch * 3 + 1;
      const batchId = `canary-batch-${batch}`;
      for (const [idx, protoKey] of [
        [0, 'h1'],
        [1, 'h2'],
        [2, 'h3'],
      ]) {
        const probeId = base + idx;
        const record = buildRedactedTripletProbeIndex({
          probe: {
            probe_id: probeId,
            matrix_protocol: protoKey,
            protocol_label: protoKey === 'h1' ? 'HTTP/1.1' : protoKey === 'h2' ? 'HTTP/2' : 'HTTP/3',
          },
          protoKey,
          batchId,
          runId,
          launchHead,
          workerResult: mockWorkerResult(1_700_000_000 + probeId),
          analysis: mockAnalysis(protoKey),
          pcapFiles: [],
        });
        writeProbePacketIndex(outRoot, probeId, record);
      }
      writeBatchPacketIndex(outRoot, {
        batch_id: batchId,
        run_id: runId,
        member_probe_ids: { h1: base, h2: base + 1, h3: base + 2 },
        coordinate: { window: 1, run: 1, case_id: `c${batch}`, user_class: 'a' },
        start_spread_ms: 20,
        batch_timing_status: 'PASS',
        packet_correlation_status: 'PENDING',
      });
    }
    const report = assertPacketIndexCoverage(outRoot, {
      expectedProbeIndexes: 90,
      expectedBatchCorrelations: 30,
      requirePerProbeIndexes: true,
    });
    assert.equal(report.per_probe_index_coverage, '90/90');
    assert.equal(report.batch_correlation_coverage, '30/30');
  });
});
