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
  UNKNOWN_QUIC: 'unknown_quic',
  NOT_QUIC: 'not_quic',
  UNKNOWN: 'unknown',
};

export const HANDSHAKE_EVIDENCE = {
  WIRE_HANDSHAKE: 'WIRE_HANDSHAKE',
  INFERRED_POST_INITIAL_1RTT: 'INFERRED_POST_INITIAL_1RTT',
  MISSING: 'MISSING',
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

/** Split coalesced tshark field values (comma-separated). */
export function splitCoalescedField(raw) {
  if (raw == null || raw === '') return [];
  return String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Classify all packet spaces present in one frame (supports QUIC coalescing).
 * longPacketType: 0=Initial, 1=Handshake, 2=0-RTT, 3=Retry
 */
export function classifyPacketSpacesFromTsharkFields(
  { headerForm, longPacketType, version },
  opts = {},
) {
  if (version != null && String(version).toLowerCase() === '0x00000000') {
    return [PACKET_SPACE.VERSION_NEGOTIATION];
  }
  const headerForms = splitCoalescedField(headerForm);
  const types = splitCoalescedField(longPacketType);
  const spaces = new Set();
  const suppressZeroRtt = opts.clientUnsupported && !opts.zeroRttAttempted;

  for (const t of types) {
    if (t === '3') spaces.add(PACKET_SPACE.RETRY);
    else if (t === '1') spaces.add(PACKET_SPACE.HANDSHAKE);
    else if (t === '2') {
      if (suppressZeroRtt) {
        spaces.add(PACKET_SPACE.HANDSHAKE);
      } else {
        spaces.add(PACKET_SPACE.ZERO_RTT);
      }
    } else if (t === '0') spaces.add(PACKET_SPACE.INITIAL);
  }

  for (const hf of headerForms) {
    if (hf === '0') spaces.add(PACKET_SPACE.ONE_RTT);
  }

  if (!spaces.size && headerForms.length === 0 && types.length === 0) {
    return [PACKET_SPACE.UNKNOWN];
  }
  if (!spaces.size) {
    return [PACKET_SPACE.UNKNOWN_QUIC];
  }
  return [...spaces];
}

/** Primary label for a frame (highest-priority space when coalesced). */
export function classifyPacketSpaceFromTsharkFields(fields, opts = {}) {
  const spaces = classifyPacketSpacesFromTsharkFields(fields, opts);
  const priority = [
    PACKET_SPACE.VERSION_NEGOTIATION,
    PACKET_SPACE.RETRY,
    PACKET_SPACE.HANDSHAKE,
    PACKET_SPACE.ZERO_RTT,
    PACKET_SPACE.INITIAL,
    PACKET_SPACE.ONE_RTT,
  ];
  for (const p of priority) {
    if (spaces.includes(p)) return p;
  }
  return spaces[0] || PACKET_SPACE.UNKNOWN;
}

export function countPacketSpaces(packets) {
  const counts = {
    initial_packets: 0,
    handshake_packets: 0,
    zero_rtt_packets: 0,
    one_rtt_packets: 0,
    wire_zero_rtt_frames: 0,
    retry_packet_observed: false,
    version_negotiation_observed: false,
  };
  for (const packet of packets) {
    const spaces = packet.packet_spaces || [packet.packet_space];
    if (spaces.includes(PACKET_SPACE.INITIAL)) counts.initial_packets += 1;
    if (spaces.includes(PACKET_SPACE.HANDSHAKE)) counts.handshake_packets += 1;
    if (spaces.includes(PACKET_SPACE.ZERO_RTT)) {
      counts.wire_zero_rtt_frames += 1;
      counts.zero_rtt_packets += 1;
    }
    if (spaces.includes(PACKET_SPACE.ONE_RTT)) counts.one_rtt_packets += 1;
    if (spaces.includes(PACKET_SPACE.RETRY)) counts.retry_packet_observed = true;
    if (spaces.includes(PACKET_SPACE.VERSION_NEGOTIATION)) counts.version_negotiation_observed = true;
  }
  return counts;
}

/**
 * When the client cannot attempt 0-RTT, suppress semantic zero_rtt counts.
 * Wire type-2 on cold connections without session state is a classifier contradiction.
 */
export function applyClientZeroRttCapabilityFilter(counts, {
  zeroRttAttempted = false,
  clientUnsupported = false,
  connectionMode = 'cold',
} = {}) {
  const out = { ...counts, classifier_contradiction: false, classifier_notes: [] };
  if (!clientUnsupported && zeroRttAttempted) return out;

  if (out.wire_zero_rtt_frames > 0 || out.zero_rtt_packets > 0) {
    out.classifier_contradiction = true;
    out.classifier_notes.push(
      'WIRE_ZERO_RTT_WHILE_CLIENT_UNSUPPORTED_OR_NOT_ATTEMPTED',
    );
  }
  out.zero_rtt_packets = 0;
  out.zero_rtt_observed = false;
  return out;
}

export function inferHandshakeEvidence({
  counts,
  connectionMode = 'cold',
  hasKeylog = false,
}) {
  if (counts.handshake_packets > 0) {
    return {
      status: HANDSHAKE_EVIDENCE.WIRE_HANDSHAKE,
      handshake_packets: counts.handshake_packets,
      inference_reason: null,
    };
  }
  if (
    connectionMode === 'cold' &&
    counts.initial_packets > 0 &&
    counts.one_rtt_packets > 0 &&
    !hasKeylog
  ) {
    return {
      status: HANDSHAKE_EVIDENCE.INFERRED_POST_INITIAL_1RTT,
      handshake_packets: 0,
      inference_reason:
        '1-RTT application data after Initial implies completed TLS handshake (no keylog; Handshake long headers may be encrypted)',
    };
  }
  if (hasKeylog && counts.handshake_packets === 0) {
    return {
      status: HANDSHAKE_EVIDENCE.MISSING,
      handshake_packets: 0,
      inference_reason: 'keylog present but no Handshake long-header frames decoded',
    };
  }
  return {
    status: HANDSHAKE_EVIDENCE.MISSING,
    handshake_packets: 0,
    inference_reason: null,
  };
}

export function coldH3GatePass({
  httpStatus,
  versionOk,
  counts,
  handshakeEvidence,
  classifierContradiction,
  correlationStatus,
}) {
  if (classifierContradiction) return false;
  if (httpStatus !== 200 || versionOk === false) return false;
  if (counts.initial_packets <= 0 || counts.one_rtt_packets <= 0) return false;
  if (
    handshakeEvidence.status !== HANDSHAKE_EVIDENCE.WIRE_HANDSHAKE &&
    handshakeEvidence.status !== HANDSHAKE_EVIDENCE.INFERRED_POST_INITIAL_1RTT
  ) {
    return false;
  }
  if (correlationStatus === 'FAIL') return false;
  return true;
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
  classifierContradiction = false,
}) {
  if (classifierContradiction) return 'CLASSIFIER_CONTRADICTION';
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

export function tsharkVersionText() {
  const r = spawnSync(tsharkBin(), ['--version'], { encoding: 'utf8' });
  return (r.stdout || r.stderr || '').split('\n')[0]?.trim() || 'unknown';
}

export function analyzePcapPacketSpace(pcapPath, opts = {}) {
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
    const packetSpaces = classifyPacketSpacesFromTsharkFields(
      { headerForm, longPacketType, version },
      opts,
    );
    const packetSpace = classifyPacketSpaceFromTsharkFields(
      { headerForm, longPacketType, version },
      opts,
    );
    const normVersion = normalizeQuicVersion(version);
    if (normVersion) versions.add(normVersion);
    packets.push({
      frame_number: Number(frameNumber),
      time_epoch: Number(timeEpoch),
      quic_version: normVersion,
      quic_version_label: quicVersionLabel(normVersion),
      packet_space: packetSpace,
      packet_spaces: packetSpaces,
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
  let counts = countPacketSpaces(packets);
  counts = applyClientZeroRttCapabilityFilter(counts, opts);
  return {
    status: packets.length ? 'PASS' : 'PARTIAL',
    packets,
    counts,
    observed_versions: [...versions],
    negotiated_versions: [...versions].filter((v) => v && v !== '0x00000000'),
    tshark_version: tsharkVersionText(),
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
      packets: [],
      counts: countPacketSpaces([]),
    };
  }
  const frames = matched.map((p) => p.frame_number);
  const counts = countPacketSpaces(matched);
  return {
    correlation_status: 'PASS',
    pcap_first_frame: Math.min(...frames),
    pcap_last_frame: Math.max(...frames),
    matched_count: matched.length,
    packets: matched,
    counts,
  };
}

export function connectionLineageProof(packets) {
  const udpStreams = new Set(packets.map((p) => p.udp_stream).filter(Boolean));
  const dcidHashes = new Set(packets.map((p) => p.dcid_hash).filter(Boolean));
  const scidHashes = new Set(packets.map((p) => p.scid_hash).filter(Boolean));
  return {
    udp_stream_ids: [...udpStreams],
    dcid_hashes: [...dcidHashes],
    scid_hashes: [...scidHashes],
    same_udp_stream: udpStreams.size === 1,
    connection_generation: udpStreams.size <= 1 ? 1 : udpStreams.size,
  };
}

function initialPacketsOnLineage(packets, lineage) {
  return packets.filter((p) => {
    const spaces = p.packet_spaces || [p.packet_space];
    if (!spaces.includes(PACKET_SPACE.INITIAL)) return false;
    if (p.udp_stream && lineage.udp_stream_ids.includes(p.udp_stream)) return true;
    if (p.dcid_hash && lineage.dcid_hashes.includes(p.dcid_hash)) return true;
    if (p.scid_hash && lineage.scid_hashes.includes(p.scid_hash)) return true;
    return false;
  }).length;
}

function newInitialPacketsAfterReuse(beforePackets, afterPackets, afterLineage) {
  const beforeFrames = new Set(beforePackets.map((p) => p.frame_number));
  return afterPackets.filter((p) => {
    const spaces = p.packet_spaces || [p.packet_space];
    if (!spaces.includes(PACKET_SPACE.INITIAL)) return false;
    if (beforeFrames.has(p.frame_number)) return false;
    if (p.udp_stream && afterLineage.udp_stream_ids.includes(p.udp_stream)) return true;
    if (p.dcid_hash && afterLineage.dcid_hashes.includes(p.dcid_hash)) return true;
    if (p.scid_hash && afterLineage.scid_hashes.includes(p.scid_hash)) return true;
    return false;
  }).length;
}

export function warmH3ReuseProof(beforePackets, afterPackets, {
  zeroRttAttempted = false,
  clientUnsupported = false,
} = {}) {
  const before = countPacketSpaces(beforePackets);
  const after = countPacketSpaces(afterPackets);
  const beforeLineage = connectionLineageProof(beforePackets);
  const afterLineage = connectionLineageProof(afterPackets);
  const afterFiltered = applyClientZeroRttCapabilityFilter(after, {
    zeroRttAttempted,
    clientUnsupported,
    connectionMode: 'warm_reuse',
  });
  const newInitialInAfter = newInitialPacketsAfterReuse(beforePackets, afterPackets, afterLineage);
  const sameStream =
    beforeLineage.same_udp_stream &&
    afterLineage.same_udp_stream &&
    beforeLineage.udp_stream_ids[0] === afterLineage.udp_stream_ids[0];
  const sharedDcid =
    beforeLineage.dcid_hashes.length > 0 &&
    afterLineage.dcid_hashes.some((h) => beforeLineage.dcid_hashes.includes(h));
  const sharedScid =
    beforeLineage.scid_hashes.length > 0 &&
    afterLineage.scid_hashes.some((h) => beforeLineage.scid_hashes.includes(h));
  const sameConnection = sameStream || (sharedDcid && sharedScid);
  return {
    same_connection_generation: sameConnection,
    new_initial_absent: newInitialInAfter === 0,
    one_rtt_observed: afterFiltered.one_rtt_packets > 0,
    classifier_contradiction: afterFiltered.classifier_contradiction,
    before_lineage: beforeLineage,
    after_lineage: afterLineage,
    pass:
      sameConnection &&
      newInitialInAfter === 0 &&
      afterFiltered.one_rtt_packets > 0 &&
      !afterFiltered.classifier_contradiction,
  };
}
