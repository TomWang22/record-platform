import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  assertRagPostNotEarlyData,
  parseTransportCapabilities,
  TRANSPORT_PROBE_PATH,
} from '../scripts/lib/phase32h-transport-capabilities.mjs';
import {
  batchTimingStatus,
  computeStartSpreadMs,
  BATCH_SPREAD_MAX_PASS_MS,
  BATCH_SPREAD_REJECT_MS,
} from '../scripts/lib/phase32h-triplet-batch.mjs';
import {
  classifyPacketSpaceFromTsharkFields,
  classifyPacketSpacesFromTsharkFields,
  classifySessionResumeOutcome,
  classifyZeroRttOutcome,
  applyClientZeroRttCapabilityFilter,
  inferHandshakeEvidence,
  HANDSHAKE_EVIDENCE,
  hashConnectionId,
  normalizeQuicVersion,
  PACKET_SPACE,
  quicVersionLabel,
} from '../scripts/lib/phase32h-quic-packet-space.mjs';
import { buildPcapCaptureIndex, redactSecretsFromSummary } from '../scripts/lib/phase32h-probe-packet-index.mjs';

describe('phase32h transport forensics', () => {
  it('parses curl capabilities with HTTP/3 and early-data flags', () => {
    const caps = parseTransportCapabilities(
      'curl 8.19.0 Features: HTTP2 HTTP3\nngtcp2/1.21.0 nghttp3/1.15.0\n --tls-earlydata\n --ssl-sessions',
    );
    assert.equal(caps.http3_backend, 'ngtcp2/1.21.0');
    assert.equal(caps.rag_post_early_data_blocked, true);
    assert.equal(caps.safe_early_data_endpoint, TRANSPORT_PROBE_PATH);
    assert.notEqual(caps.zero_rtt_client_support, 'HTTP3_UNSUPPORTED');
  });

  it('blocks RAG POST in 0-RTT mode', () => {
    assert.throws(
      () => assertRagPostNotEarlyData('/api/ai/rag/query', 'attempted_0rtt'),
      /RAG POST must not/,
    );
    assert.throws(
      () => assertRagPostNotEarlyData('/api/ai/other', 'attempted_0rtt'),
      /transport-probe endpoint/,
    );
    assert.equal(assertRagPostNotEarlyData(TRANSPORT_PROBE_PATH, 'attempted_0rtt'), true);
  });

  it('computes triplet start spread and timing status', () => {
    const spread = computeStartSpreadMs(['2026-07-11T20:00:00.000Z', '2026-07-11T20:00:00.040Z', '2026-07-11T20:00:00.080Z']);
    assert.equal(spread, 80);
    assert.equal(batchTimingStatus(40), 'PASS');
    assert.equal(batchTimingStatus(75), 'PASS_WITH_NOTE');
    assert.equal(batchTimingStatus(BATCH_SPREAD_MAX_PASS_MS + 1), 'PARTIAL');
    assert.equal(batchTimingStatus(BATCH_SPREAD_REJECT_MS + 1), 'REJECTED');
  });

  it('classifies coalesced QUIC packet spaces independently', () => {
    const spaces = classifyPacketSpacesFromTsharkFields({
      headerForm: '1,1',
      longPacketType: '0,2',
      version: '0x00000001',
    });
    assert.ok(spaces.includes(PACKET_SPACE.INITIAL));
    assert.ok(spaces.includes(PACKET_SPACE.ZERO_RTT));
    const suppressed = classifyPacketSpacesFromTsharkFields(
      {
        headerForm: '1,1',
        longPacketType: '0,2',
        version: '0x00000001',
      },
      { clientUnsupported: true, zeroRttAttempted: false, connectionMode: 'cold' },
    );
    assert.ok(suppressed.includes(PACKET_SPACE.INITIAL));
    assert.ok(suppressed.includes(PACKET_SPACE.HANDSHAKE));
    assert.ok(!suppressed.includes(PACKET_SPACE.ZERO_RTT));
  });

  it('suppresses zero_rtt_packets when client cannot attempt 0-RTT', () => {
    const counts = applyClientZeroRttCapabilityFilter(
      { zero_rtt_packets: 3, wire_zero_rtt_frames: 3, one_rtt_packets: 5, initial_packets: 2 },
      { clientUnsupported: true, zeroRttAttempted: false, connectionMode: 'cold' },
    );
    assert.equal(counts.zero_rtt_packets, 0);
    assert.equal(counts.classifier_contradiction, true);
  });

  it('infers handshake evidence from Initial plus 1-RTT without keylog', () => {
    const evidence = inferHandshakeEvidence({
      counts: { handshake_packets: 0, initial_packets: 2, one_rtt_packets: 4 },
      connectionMode: 'cold',
      hasKeylog: false,
    });
    assert.equal(evidence.status, HANDSHAKE_EVIDENCE.INFERRED_POST_INITIAL_1RTT);
  });

  it('classifies QUIC packet spaces from fixtures', () => {
    assert.equal(classifyPacketSpaceFromTsharkFields({ longPacketType: 0 }), PACKET_SPACE.INITIAL);
    assert.equal(classifyPacketSpaceFromTsharkFields({ longPacketType: 1 }), PACKET_SPACE.HANDSHAKE);
    assert.equal(classifyPacketSpaceFromTsharkFields({ longPacketType: 2 }), PACKET_SPACE.ZERO_RTT);
    assert.equal(classifyPacketSpaceFromTsharkFields({ headerForm: 0 }), PACKET_SPACE.ONE_RTT);
    assert.equal(classifyPacketSpaceFromTsharkFields({ longPacketType: 3 }), PACKET_SPACE.RETRY);
    assert.equal(classifyPacketSpaceFromTsharkFields({ version: '0x00000000' }), PACKET_SPACE.VERSION_NEGOTIATION);
  });

  it('labels QUIC v1 and v2 from wire version', () => {
    assert.equal(quicVersionLabel('0x00000001'), 'QUICv1');
    assert.equal(quicVersionLabel('0x6b3343cf'), 'QUICv2');
    assert.equal(normalizeQuicVersion('1'), '0x00000001');
  });

  it('hashes connection IDs before storage', () => {
    const h = hashConnectionId('deadbeef');
    assert.match(h, /^[a-f0-9]{16}$/);
  });

  it('classifies session resume unsupported without inferring from latency', () => {
    assert.equal(
      classifySessionResumeOutcome({
        sessionResumeSupported: false,
        httpStatus: 0,
        oneRttConfirmed: false,
      }),
      'CLIENT_SESSION_RESUME_UNSUPPORTED',
    );
  });

  it('classifies 0-RTT outcomes without inferring from latency', () => {
    assert.equal(
      classifyZeroRttOutcome({
        zeroRttPackets: 2,
        oneRttPackets: 5,
        httpStatus: 200,
        earlyDataAttempted: true,
        clientUnsupported: false,
      }),
      'ZERO_RTT_ACCEPTED',
    );
    assert.equal(
      classifyZeroRttOutcome({
        zeroRttPackets: 0,
        oneRttPackets: 3,
        httpStatus: 200,
        earlyDataAttempted: true,
        clientUnsupported: false,
      }),
      'ZERO_RTT_REJECTED_REPLAYED_AS_1RTT',
    );
    assert.equal(
      classifyZeroRttOutcome({
        zeroRttPackets: 0,
        oneRttPackets: 0,
        httpStatus: 0,
        earlyDataAttempted: false,
        clientUnsupported: true,
      }),
      'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED',
    );
  });

  it('rejects secret material in summaries', () => {
    assert.throws(
      () => redactSecretsFromSummary({ x: 'CLIENT_RANDOM abc' }),
      /secret material/,
    );
  });

  it('detects PCAP rotation gaps in capture index', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcap-index-'));
    const pcapDir = path.join(root, 'pcap');
    fs.mkdirSync(pcapDir, { recursive: true });
    const f1 = path.join(pcapDir, 'a.pcapng');
    const f2 = path.join(pcapDir, 'b.pcapng');
    fs.writeFileSync(f1, 'a');
    fs.writeFileSync(f2, 'b');
    const t0 = Date.now() - 120_000;
    fs.utimesSync(f1, t0 / 1000, t0 / 1000);
    fs.utimesSync(f2, Date.now() / 1000, Date.now() / 1000);
    const index = buildPcapCaptureIndex(root);
    assert.equal(index.file_count, 2);
    assert.equal(index.continuity_status, 'FLAGGED');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
