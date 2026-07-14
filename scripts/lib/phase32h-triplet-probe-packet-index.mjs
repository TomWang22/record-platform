/**
 * Phase 32H-R1 — per-probe packet indexes for synchronized triplet batches.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzePcapPacketSpace,
  correlateProbeToPackets,
  inferHandshakeEvidence,
} from './phase32h-quic-packet-space.mjs';
import {
  emptyProbePacketRecord,
  mergeProbeCorrelation,
  probeIndexPath,
  writeProbePacketIndex,
} from './phase32h-probe-packet-index.mjs';
import { assertRedactedProbePacketIndex } from './phase32h-packet-index-coverage.mjs';

const pcapSpaceCache = new Map();
const PCAP_SPACE_CACHE_LIMIT = 1;

export function clearPcapSpaceCache() {
  pcapSpaceCache.clear();
}

export function latestPcapFile(outRoot) {
  const pcapDir = path.join(outRoot, 'pcap');
  if (!fs.existsSync(pcapDir)) return null;
  const files = fs
    .readdirSync(pcapDir)
    .filter((name) => name.endsWith('.pcap') || name.endsWith('.pcapng'))
    .map((name) => path.join(pcapDir, name))
    .filter((file) => fs.statSync(file).size > 0);
  if (!files.length) return null;
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function loadPcapSpace(outRoot, pcapPath, { zeroRttAttempted = false, clientUnsupported = false } = {}) {
  const mtimeMs = fs.statSync(pcapPath).mtimeMs;
  const cacheKey = `${pcapPath}:${mtimeMs}:${zeroRttAttempted}:${clientUnsupported}`;
  if (pcapSpaceCache.has(cacheKey)) return pcapSpaceCache.get(cacheKey);
  // Evict all prior analyses — ring segments rewrite/mtime and must not accumulate.
  pcapSpaceCache.clear();
  const space = analyzePcapPacketSpace(pcapPath, {
    zeroRttAttempted,
    clientUnsupported,
    connectionMode: 'triplet',
  });
  pcapSpaceCache.set(cacheKey, space);
  while (pcapSpaceCache.size > PCAP_SPACE_CACHE_LIMIT) {
    const oldest = pcapSpaceCache.keys().next().value;
    pcapSpaceCache.delete(oldest);
  }
  return space;
}

export function transportEvidenceForProtocol(protoKey, analysis) {
  const packets = analysis?.packets || [];
  const tcpPackets = packets.filter((p) => p.five_tuple?.transport === 'tcp' || p.tcp_stream != null).length;
  const udpPackets = packets.filter((p) => p.five_tuple?.transport === 'udp' || p.udp_stream != null).length;
  const http2Frames = packets.filter((p) => p.http2_stream != null || p.http2_type != null).length;
  if (protoKey === 'h1') {
    return {
      transport: 'tcp',
      tcp_packets: tcpPackets,
      http2_frames: 0,
      udp_packets: 0,
      quic_packets: 0,
    };
  }
  if (protoKey === 'h2') {
    return {
      transport: 'tcp',
      tcp_packets: tcpPackets,
      http2_frames: http2Frames,
      udp_packets: 0,
      quic_packets: 0,
      http2_detected: http2Frames > 0 || tcpPackets > 0,
    };
  }
  return {
    transport: 'udp',
    tcp_packets: tcpPackets,
    http2_frames: 0,
    udp_packets: udpPackets,
    quic_packets: packets.filter((p) => p.quic_version != null || p.packet_spaces?.length).length,
    quic_version: packets.find((p) => p.quic_version_label)?.quic_version_label || null,
    initial_packets: analysis?.counts?.initial_packets ?? 0,
    handshake_packets: analysis?.counts?.handshake_packets ?? 0,
    one_rtt_packets: analysis?.counts?.one_rtt_packets ?? 0,
    zero_rtt_packets: analysis?.counts?.zero_rtt_packets ?? 0,
  };
}

export function buildRedactedTripletProbeIndex({
  probe,
  protoKey,
  batchId,
  runId,
  launchHead,
  workerResult,
  analysis,
  pcapFiles = [],
}) {
  const transportEvidence = transportEvidenceForProtocol(protoKey, analysis);
  const merged = mergeProbeCorrelation(
    emptyProbePacketRecord({
      probe_id: probe.probe_id,
      batch_id: batchId,
      protocol_label: probe.protocol_label,
      run_id: runId,
      launch_head: launchHead,
      started_at: workerResult.started_at,
      finished_at: new Date(workerResult.finished_epoch * 1000).toISOString(),
      transport: transportEvidence.transport,
    }),
    analysis,
    pcapFiles,
    {
      handshakeEvidence:
        protoKey === 'h3'
          ? inferHandshakeEvidence({
              counts: analysis?.counts || {},
              connectionMode: 'triplet',
              hasKeylog: false,
            })
          : null,
    },
  );

  const record = {
    probe_id: probe.probe_id,
    batch_id: batchId,
    protocol: protoKey,
    protocol_label: probe.protocol_label,
    run_id: runId,
    launch_head: launchHead,
    request_started_at: workerResult.started_at,
    request_finished_at: new Date(workerResult.finished_epoch * 1000).toISOString(),
    pcap_files: pcapFiles,
    pcap_first_frame: merged.pcap_first_frame,
    pcap_last_frame: merged.pcap_last_frame,
    transport: transportEvidence.transport,
    transport_evidence: transportEvidence,
    tcp_stream: merged.tcp_stream,
    udp_stream: merged.udp_stream,
    quic_version: merged.quic_version,
    initial_packets: merged.initial_packets,
    handshake_packets: merged.handshake_packets,
    one_rtt_packets: merged.one_rtt_packets,
    zero_rtt_packets: merged.zero_rtt_packets,
    correlation_status: merged.correlation_status || analysis?.correlation_status || 'PARTIAL',
  };
  assertRedactedProbePacketIndex(record);
  return record;
}

export function writeTripletProbePacketIndexes({
  outRoot,
  batch,
  runId,
  launchHead,
  results,
  failIfExists = true,
}) {
  const pcapPath = latestPcapFile(outRoot);
  const pcapFiles = pcapPath ? [pcapPath] : [];
  const space = pcapPath ? loadPcapSpace(outRoot, pcapPath) : { packets: [] };
  const written = [];

  for (const protoKey of ['h1', 'h2', 'h3']) {
    const probe = batch[protoKey];
    const workerResult = results[protoKey];
    const analysis = correlateProbeToPackets(
      space.packets,
      workerResult.started_epoch,
      workerResult.finished_epoch,
    );
    const record = buildRedactedTripletProbeIndex({
      probe,
      protoKey,
      batchId: batch.batch_id,
      runId,
      launchHead,
      workerResult,
      analysis,
      pcapFiles,
    });
    if (failIfExists && fs.existsSync(probeIndexPath(outRoot, probe.probe_id))) {
      throw new Error(`probe packet index already exists for probe_id=${probe.probe_id}`);
    }
    writeProbePacketIndex(outRoot, probe.probe_id, record);
    written.push({ probe_id: probe.probe_id, protocol: protoKey, batch_id: batch.batch_id });
  }
  // Release packet bodies after indexes are on disk; keep cache slot count bounded.
  if (space?.packets) space.packets.length = 0;
  clearPcapSpaceCache();
  return written;
}
