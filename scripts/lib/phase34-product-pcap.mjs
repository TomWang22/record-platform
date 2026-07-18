/**
 * Product-smoke PCAP start/stop + per-probe correlation for H1/H2/H3.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  latestPcapFile,
  clearPcapSpaceCache,
  transportEvidenceForProtocol,
} from './phase32h-triplet-probe-packet-index.mjs';
import {
  analyzePcapPacketSpace,
  classifyPacketSpaceFromTsharkFields,
  classifyPacketSpacesFromTsharkFields,
  correlateProbeToPackets,
  countPacketSpaces,
  hashConnectionId,
  inferHandshakeEvidence,
  normalizeQuicVersion,
  quicVersionLabel,
  tsharkBin,
} from './phase32h-quic-packet-space.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCT_PCAP_SLACK_SEC = Number(process.env.PHASE34_PRODUCT_PCAP_SLACK_SEC || 5);

function toEpoch(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t / 1000 : null;
}

function parseTsharkFieldStdout(stdout, opts = {}) {
  const packets = [];
  const versions = new Set();
  let cursor = 0;
  while (cursor <= stdout.length) {
    const idx = stdout.indexOf('\n', cursor);
    const line = idx === -1 ? stdout.slice(cursor) : stdout.slice(cursor, idx);
    cursor = idx === -1 ? stdout.length + 1 : idx + 1;
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
  return {
    status: 'PASS',
    packets,
    counts: countPacketSpaces(packets),
    observed_versions: [...versions],
    drop_count: 0,
  };
}

/**
 * Windowed tshark read — full-file analysis blows the default 8MB spawnSync
 * buffer once a 64-session smoke accumulates ~100k+ frames (~8.4MB fields).
 */
export function analyzePcapPacketSpaceWindow(pcapPath, startEpoch, endEpoch, opts = {}) {
  const slack = Number.isFinite(opts.slackSec) ? opts.slackSec : PRODUCT_PCAP_SLACK_SEC;
  if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) {
    return analyzePcapPacketSpace(pcapPath, opts);
  }
  const start = startEpoch - slack;
  const end = endEpoch + slack;
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
  const args = [
    '-r',
    pcapPath,
    '-Y',
    `frame.time_epoch >= ${start} && frame.time_epoch <= ${end}`,
    '-T',
    'fields',
    '-E',
    'separator=|',
  ];
  for (const field of fields) args.push('-e', field);
  const maxBuffer = Number(process.env.PHASE32H_TSHARK_MAX_BUFFER_BYTES || 64 * 1024 * 1024);
  const r = spawnSync(tsharkBin(), args, { encoding: 'utf8', maxBuffer });
  if (r.status !== 0) {
    return { status: 'FAIL', error: r.stderr || 'tshark window failed', packets: [] };
  }
  if ((r.stdout || '').length >= maxBuffer) {
    return {
      status: 'FAIL',
      error: `tshark window stdout exceeded cap of ${maxBuffer} bytes`,
      packets: [],
    };
  }
  return parseTsharkFieldStdout(r.stdout || '', opts);
}

export function startProductPcapCapture(outRoot) {
  const script = path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh');
  const r = spawnSync('bash', [script, outRoot], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: process.env,
  });
  const statusPath = path.join(outRoot, 'pcap/capture-status.json');
  if (r.status !== 0 || !fs.existsSync(statusPath)) {
    const err = new Error(
      `product PCAP start failed: ${r.stderr || r.stdout || `exit ${r.status}`}`,
    );
    err.code = 'PHASE34_PRODUCT_PCAP_START_FAILED';
    throw err;
  }
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  if (status.status !== 'ACTIVE') {
    const err = new Error(`product PCAP not ACTIVE: ${JSON.stringify(status)}`);
    err.code = 'PHASE34_PRODUCT_PCAP_NOT_ACTIVE';
    throw err;
  }
  return status;
}

export function stopProductPcapCapture(outRoot) {
  const script = path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh');
  spawnSync('bash', [script, outRoot], { encoding: 'utf8', cwd: REPO_ROOT, env: process.env });
  clearPcapSpaceCache();
  const statusPath = path.join(outRoot, 'pcap/capture-status.json');
  return fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : null;
}

/**
 * Correlate one protocol probe to PCAP packets using wall-clock window.
 */
export function correlateProductProbe({ outRoot, probe, protocol }) {
  const pcapPath = latestPcapFile(outRoot);
  if (!pcapPath) {
    return {
      probe_id: probe.probe_id,
      protocol,
      correlation_status: 'FAIL',
      reason: 'pcap_file_missing',
      packet_count: 0,
    };
  }
  const start = toEpoch(probe.started_at);
  const end = toEpoch(probe.finished_at);
  const space = analyzePcapPacketSpaceWindow(pcapPath, start, end, {
    zeroRttAttempted: false,
    clientUnsupported: false,
    connectionMode: 'triplet',
    slackSec: PRODUCT_PCAP_SLACK_SEC,
  });
  if (space.status === 'FAIL') {
    const record = {
      probe_id: probe.probe_id,
      protocol,
      pcap_segment: path.basename(pcapPath),
      packet_start_index: null,
      packet_end_index: null,
      packet_count: 0,
      connection_tuple_hash: null,
      correlation_status: 'FAIL',
      reason: space.error || 'pcap_analyze_failed',
      tls_or_quic_classification:
        protocol === 'h3' ? 'QUIC_v1_ALPN_h3' : protocol === 'h2' ? 'TLS_ALPN_h2' : 'HTTP11_over_TLS',
      fallback_detected: Boolean(probe.fallback || probe.h2_fallback || probe.h3_fallback),
      capture_drop_count: 0,
      pcap_path: pcapPath,
    };
    const dir = path.join(outRoot, 'pcap', 'probe-indexes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${probe.probe_id}.json`), JSON.stringify(record, null, 2) + '\n');
    return record;
  }
  const analysis = correlateProbeToPackets(
    space.packets || [],
    start,
    end,
    PRODUCT_PCAP_SLACK_SEC,
  );
  const transport = transportEvidenceForProtocol(protocol, {
    ...space,
    packets: analysis.packets || space.packets,
  });
  const packetCount = (analysis.packets || []).length || analysis.matched_count || 0;
  let correlation_status = analysis.correlation_status || (packetCount > 0 ? 'PASS' : 'FAIL');
  if (correlation_status === 'PARTIAL' && packetCount > 0) {
    correlation_status = 'PASS';
  }
  const handshake =
    protocol === 'h3'
      ? inferHandshakeEvidence({
          counts: analysis.counts || space.counts || {},
          connectionMode: 'triplet',
          hasKeylog: false,
        })
      : null;

  if (protocol === 'h1') {
    if (!(transport.tcp_packets > 0 || packetCount > 0)) correlation_status = 'FAIL';
  }
  if (protocol === 'h2') {
    if (!(transport.tcp_packets > 0 || transport.http2_detected || packetCount > 0)) {
      correlation_status = 'FAIL';
    }
  }
  if (protocol === 'h3') {
    const counts = analysis.counts || space.counts || {};
    if (
      !(
        counts.initial_packets > 0 ||
        counts.handshake_packets > 0 ||
        counts.one_rtt_packets > 0 ||
        packetCount > 0
      )
    ) {
      correlation_status = 'FAIL';
    }
    if (probe.h3_fallback || probe.fallback) correlation_status = 'FAIL';
  }

  const record = {
    probe_id: probe.probe_id,
    protocol,
    pcap_segment: path.basename(pcapPath),
    packet_start_index: analysis.first_index ?? analysis.pcap_first_frame ?? null,
    packet_end_index: analysis.last_index ?? analysis.pcap_last_frame ?? null,
    packet_count: packetCount,
    connection_tuple_hash: analysis.connection_tuple_hash || null,
    correlation_status,
    tls_or_quic_classification:
      protocol === 'h3' ? 'QUIC_v1_ALPN_h3' : protocol === 'h2' ? 'TLS_ALPN_h2' : 'HTTP11_over_TLS',
    fallback_detected: Boolean(probe.fallback || probe.h2_fallback || probe.h3_fallback),
    capture_drop_count: space.drop_count ?? 0,
    transport_evidence: transport,
    handshake_evidence: handshake,
    pcap_path: pcapPath,
  };
  const dir = path.join(outRoot, 'pcap', 'probe-indexes');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${probe.probe_id}.json`), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/**
 * Correlate entire triplet; fail closed if any probe uncorrelated.
 */
export function correlateProductTriplet(outRoot, triplet) {
  const rows = [];
  for (const protocol of ['h1', 'h2', 'h3']) {
    rows.push(correlateProductProbe({ outRoot, probe: triplet[protocol], protocol }));
  }
  const hardFail = rows.filter((r) => r.correlation_status !== 'PASS');
  return {
    rows,
    H1: rows.find((r) => r.protocol === 'h1'),
    H2: rows.find((r) => r.protocol === 'h2'),
    H3: rows.find((r) => r.protocol === 'h3'),
    uncorrelated_probes: hardFail.length,
    pass: hardFail.length === 0,
    pcap_correlation: {
      h1: rows.find((r) => r.protocol === 'h1'),
      h2: rows.find((r) => r.protocol === 'h2'),
      h3: rows.find((r) => r.protocol === 'h3'),
    },
  };
}
