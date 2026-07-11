/**
 * Phase 32H-R1 — per-probe packet correlation index and PCAP capture index.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashConnectionId } from './phase32h-quic-packet-space.mjs';

export function probeIndexDir(outRoot) {
  return path.join(outRoot, 'probe-packet-index');
}

export function probeIndexPath(outRoot, probeId) {
  return path.join(probeIndexDir(outRoot), `${probeId}.json`);
}

export function emptyProbePacketRecord(base = {}) {
  return {
    run_id: null,
    batch_id: null,
    probe_id: null,
    protocol_label: null,
    connection_mode: null,
    case_id: null,
    window: null,
    run: null,
    user_class: null,
    started_at: null,
    finished_at: null,
    client_ip: null,
    client_port: 0,
    server_ip: null,
    server_port: 443,
    transport: null,
    pcap_first_frame: 0,
    pcap_last_frame: 0,
    pcap_files: [],
    tcp_stream: null,
    udp_stream: null,
    quic_version: null,
    dcid_hash: null,
    scid_hash: null,
    connection_generation: 0,
    connection_reused: false,
    session_resumed: false,
    zero_rtt_attempted: false,
    zero_rtt_observed: false,
    zero_rtt_accepted: false,
    zero_rtt_rejected: false,
    one_rtt_confirmed: false,
    retry_packet_observed: false,
    version_negotiation_observed: false,
    initial_packets: 0,
    handshake_packets: 0,
    zero_rtt_packets: 0,
    one_rtt_packets: 0,
    qlog_trace: null,
    keylog_file: null,
    correlation_status: 'PARTIAL',
    ...base,
  };
}

export function writeProbePacketIndex(outRoot, probeId, record) {
  const dir = probeIndexDir(outRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = probeIndexPath(outRoot, probeId);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

export function mergeProbeCorrelation(record, analysis, pcapFiles = [], opts = {}) {
  const packets = analysis?.packets || [];
  const first = packets[0];
  const last = packets[packets.length - 1];
  let counts = analysis?.counts || {};
  counts = {
    ...counts,
    ...(opts.capabilityFilter || {}),
  };
  const handshakeEvidence = opts.handshakeEvidence || null;
  return {
    ...record,
    pcap_first_frame: analysis?.pcap_first_frame ?? record.pcap_first_frame,
    pcap_last_frame: analysis?.pcap_last_frame ?? record.pcap_last_frame,
    pcap_files: pcapFiles,
    tcp_stream: first?.tcp_stream ?? record.tcp_stream,
    udp_stream: first?.udp_stream ?? record.udp_stream,
    quic_version: first?.quic_version_label || first?.quic_version || record.quic_version,
    dcid_hash: first?.dcid_hash ?? record.dcid_hash,
    scid_hash: first?.scid_hash ?? record.scid_hash,
    client_ip: first?.five_tuple?.src ?? record.client_ip,
    server_ip: first?.five_tuple?.dst ?? record.server_ip,
    client_port: Number(first?.five_tuple?.sport || record.client_port || 0),
    server_port: Number(first?.five_tuple?.dport || record.server_port || 443),
    transport: first?.five_tuple?.transport ?? record.transport,
    retry_packet_observed: counts.retry_packet_observed ?? record.retry_packet_observed,
    version_negotiation_observed:
      counts.version_negotiation_observed ?? record.version_negotiation_observed,
    initial_packets: counts.initial_packets ?? record.initial_packets,
    handshake_packets: counts.handshake_packets ?? record.handshake_packets,
    zero_rtt_packets: counts.zero_rtt_packets ?? record.zero_rtt_packets,
    zero_rtt_observed: (counts.zero_rtt_packets ?? 0) > 0,
    wire_zero_rtt_frames: counts.wire_zero_rtt_frames ?? 0,
    one_rtt_packets: counts.one_rtt_packets ?? record.one_rtt_packets,
    one_rtt_confirmed: (counts.one_rtt_packets ?? 0) > 0,
    handshake_evidence: handshakeEvidence?.status ?? record.handshake_evidence,
    handshake_inference_reason: handshakeEvidence?.inference_reason ?? null,
    classifier_contradiction: counts.classifier_contradiction ?? false,
    classifier_notes: counts.classifier_notes ?? [],
    correlation_status: analysis?.correlation_status || record.correlation_status,
    connection_lineage: opts.connectionLineage ?? record.connection_lineage,
    warm_reuse_proof: opts.warmReuseProof ?? record.warm_reuse_proof,
  };
}

export function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

export function buildPcapCaptureIndex(outRoot) {
  const pcapDir = path.join(outRoot, 'pcap');
  if (!fs.existsSync(pcapDir)) {
    return { status: 'MISSING', files: [] };
  }
  const files = fs
    .readdirSync(pcapDir)
    .filter((f) => f.endsWith('.pcapng') || f.endsWith('.pcap'))
    .map((name) => {
      const full = path.join(pcapDir, name);
      const st = fs.statSync(full);
      return {
        file: full,
        name,
        bytes: st.size,
        mtime_ms: st.mtimeMs,
        started_at: new Date(st.mtimeMs).toISOString(),
        sha256: sha256File(full),
      };
    })
    .sort((a, b) => a.mtime_ms - b.mtime_ms);

  const gaps = [];
  for (let i = 1; i < files.length; i += 1) {
    const gapMs = files[i].mtime_ms - files[i - 1].mtime_ms;
    if (gapMs > 30_000) {
      gaps.push({ between: [files[i - 1].name, files[i].name], gap_ms: gapMs });
    }
  }

  const index = {
    generated_at: new Date().toISOString(),
    out_root: outRoot,
    ring_buffer: true,
    file_count: files.length,
    files,
    rotation_gaps: gaps,
    continuity_status: gaps.length ? 'FLAGGED' : 'PASS',
  };
  fs.writeFileSync(path.join(pcapDir, 'capture-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

export function redactSecretsFromSummary(obj) {
  const json = JSON.stringify(obj);
  if (/CLIENT_RANDOM|SERVER_HANDSHAKE_TRAFFIC_SECRET|EXPORTER_SECRET/i.test(json)) {
    throw new Error('secret material must not appear in transport summaries');
  }
  return obj;
}
