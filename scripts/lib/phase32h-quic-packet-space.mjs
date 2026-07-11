/**
 * Phase 32H-R1 — QUIC wire version and packet-space classification helpers.
 */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const QUIC_VERSION_LABELS = {
  '0x00000001': 'QUICv1',
  '0x6b3343cf': 'QUICv2',
  '0xff000000': 'VERSION_NEGOTIATION_GREASE',
};

export const PACKET_SPACE = {
  VERSION_NEGOTIATION: 'version_negotiation',
  RETRY: 'retry',
  INITIAL: 'initial',
  HANDSHAKE: 'handshake',
  ZERO_RTT: '0rtt',
  ONE_RTT: '1rtt',
  CONNECTION_CLOSE: 'connection_close',
  PATH_VALIDATION: 'path_validation',
  UNKNOWN: 'unknown',
};

export function hashConnectionId(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function normalizeQuicVersion(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith('0x')) return s;
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return `0x${n.toString(16).padStart(8, '0')}`;
}

export function quicVersionLabel(versionHex) {
  const norm = normalizeQuicVersion(versionHex);
  return QUIC_VERSION_LABELS[norm] || (norm ? `UNKNOWN_${norm}` : null);
}

export function classifyPacketSpaceFromTsharkFields({ headerForm, longPacketType, version }) {
  if (version != null && String(version).toLowerCase() === '0x00000000') {
    return PACKET_SPACE.VERSION_NEGOTIATION;
  }
  const types = String(longPacketType ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (types.includes('3')) return PACKET_SPACE.RETRY;
  if (types.includes('1')) return PACKET_SPACE.HANDSHAKE;
  if (types.includes('2')) return PACKET_SPACE.ZERO_RTT;
  if (types.includes('0')) return PACKET_SPACE.INITIAL;
  if (headerForm === '0' || headerForm === 0) return PACKET_SPACE.ONE_RTT;
  return PACKET_SPACE.UNKNOWN;
}

export function classifySessionResumeOutcome({
  sessionResumeSupported,
  httpStatus,
  oneRttConfirmed,
  zeroRttPackets = 0,
}) {
  if (!sessionResumeSupported) return 'CLIENT_SESSION_RESUME_UNSUPPORTED';
  if (zeroRttPackets > 0) return 'RESUMED_WITH_ZERO_RTT_UNEXPECTED';
  if (oneRttConfirmed && httpStatus === 200) return 'RESUMED_1RTT_CONFIRMED';
  if (oneRttConfirmed) return 'RESUMED_1RTT_PARTIAL_HTTP';
  return 'INDETERMINATE';
}

export function classifyZeroRttOutcome({
  zeroRttPackets,
  oneRttPackets,
  httpStatus,
  earlyDataAttempted,
  clientUnsupported,
}) {
  if (clientUnsupported) return 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED';
  if (!earlyDataAttempted) return 'RESUMED_WITHOUT_ZERO_RTT';
  if (zeroRttPackets > 0 && oneRttPackets > 0 && httpStatus === 200) {
    return 'ZERO_RTT_ACCEPTED';
  }
  if (zeroRttPackets > 0 && oneRttPackets > 0) {
    return 'ZERO_RTT_REJECTED_REPLAYED_AS_1RTT';
  }
  if (zeroRttPackets === 0 && oneRttPackets > 0) {
    return 'ZERO_RTT_REJECTED_REPLAYED_AS_1RTT';
  }
  if (oneRttPackets > 0 && zeroRttPackets === 0) {
    return 'FULL_HANDSHAKE';
  }
  return 'INDETERMINATE';
}

export function tsharkBin() {
  return process.env.TSHARK_BIN || 'tshark';
}

export function analyzePcapPacketSpace(pcapPath) {
  const tshark = tsharkBin();
  const fields = [
    'frame.number',
    'frame.time_epoch',
    'quic.version',
    'quic.header_form',
    'quic.long.packet_type',
    'quic.dcid',
    'quic.scid',
    'tcp.stream',
    'udp.stream',
    'ip.src',
    'ip.dst',
    'tcp.srcport',
    'tcp.dstport',
    'udp.srcport',
    'udp.dstport',
  ];
  const args = ['-r', pcapPath, '-T', 'fields', '-E', 'separator=|'];
  for (const field of fields) args.push('-e', field);
  const r = spawnSync(tshark, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) {
    return { status: 'FAIL', error: r.stderr || 'tshark failed', packets: [] };
  }
  const packets = [];
  const counts = {
    initial_packets: 0,
    handshake_packets: 0,
    zero_rtt_packets: 0,
    one_rtt_packets: 0,
    retry_packet_observed: false,
    version_negotiation_observed: false,
  };
  const versions = new Set();
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    const [
      frameNumber,
      timeEpoch,
      version,
      headerForm,
      longPacketType,
      dcid,
      scid,
      tcpStream,
      udpStream,
      ipSrc,
      ipDst,
      tcpSrc,
      tcpDst,
      udpSrc,
      udpDst,
    ] = parts;
    const packetSpace = classifyPacketSpaceFromTsharkFields({ headerForm, longPacketType, version });
    const normVersion = normalizeQuicVersion(version);
    if (normVersion) versions.add(normVersion);
    if (packetSpace === PACKET_SPACE.INITIAL) counts.initial_packets += 1;
    if (packetSpace === PACKET_SPACE.HANDSHAKE) counts.handshake_packets += 1;
    if (packetSpace === PACKET_SPACE.ZERO_RTT) counts.zero_rtt_packets += 1;
    if (packetSpace === PACKET_SPACE.ONE_RTT) counts.one_rtt_packets += 1;
    if (packetSpace === PACKET_SPACE.RETRY) counts.retry_packet_observed = true;
    if (packetSpace === PACKET_SPACE.VERSION_NEGOTIATION) counts.version_negotiation_observed = true;
    packets.push({
      frame_number: Number(frameNumber),
      time_epoch: Number(timeEpoch),
      quic_version: normVersion,
      quic_version_label: quicVersionLabel(normVersion),
      packet_space: packetSpace,
      dcid_hash: hashConnectionId(dcid),
      scid_hash: hashConnectionId(scid),
      tcp_stream: tcpStream || null,
      udp_stream: udpStream || null,
      five_tuple: {
        src: ipSrc || null,
        dst: ipDst || null,
        sport: tcpSrc || udpSrc || null,
        dport: tcpDst || udpDst || null,
        transport: tcpStream ? 'tcp' : udpStream ? 'udp' : null,
      },
    });
  }
  return {
    status: packets.length ? 'PASS' : 'PARTIAL',
    packets,
    counts,
    observed_versions: [...versions],
    negotiated_versions: [...versions].filter((v) => v && v !== '0x00000000'),
  };
}

export function correlateProbeToPackets(packets, startedAtEpoch, finishedAtEpoch, slackSec = 2) {
  const start = startedAtEpoch - slackSec;
  const end = finishedAtEpoch + slackSec;
  const matched = packets.filter((p) => p.time_epoch >= start && p.time_epoch <= end);
  if (!matched.length) {
    return {
      correlation_status: 'FAIL',
      pcap_first_frame: null,
      pcap_last_frame: null,
      matched_count: 0,
    };
  }
  const frames = matched.map((p) => p.frame_number);
  return {
    correlation_status: matched.length ? 'PASS' : 'FAIL',
    pcap_first_frame: Math.min(...frames),
    pcap_last_frame: Math.max(...frames),
    matched_count: matched.length,
    packets: matched,
  };
}
