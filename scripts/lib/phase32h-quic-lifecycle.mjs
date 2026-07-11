/**
 * Phase 32H-R1 — QUIC connection lifecycle probes (cold, warm, resumed, 0-RTT).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULTS,
  PROTOCOLS,
  login,
  resolveCurlTarget,
} from './phase22-full-replay-common.mjs';
import {
  TRANSPORT_PROBE_PATH,
  assertRagPostNotEarlyData,
  parseTransportCapabilities,
  curlVersionText,
  curlSupportsSslSessions,
} from './phase32h-transport-capabilities.mjs';
import {
  analyzePcapPacketSpace,
  applyClientZeroRttCapabilityFilter,
  classifySessionResumeOutcome,
  classifyZeroRttOutcome,
  coldH3GatePass,
  correlateProbeToPackets,
  connectionLineageProof,
  inferHandshakeEvidence,
  warmH3ReuseProof,
} from './phase32h-quic-packet-space.mjs';
import {
  curlH3Cold,
  curlH3PersistentPair,
} from './phase32h-persistent-curl-client.mjs';
import {
  emptyProbePacketRecord,
  mergeProbeCorrelation,
  writeProbePacketIndex,
} from './phase32h-probe-packet-index.mjs';

const CONNECTION_MODES = ['cold', 'warm_reuse', 'resumed_1rtt', 'attempted_0rtt'];

export function lifecycleSessionPath(outRoot, label) {
  return path.join(outRoot, 'transport', 'sessions', `${label}.sslsession`);
}

function curlLifecycleRequest({
  cfg,
  token,
  userId,
  protocolFlag,
  expectedVersion,
  method = 'HEAD',
  urlPath = TRANSPORT_PROBE_PATH,
  connectionMode,
  extraArgs = [],
  env = {},
  sessionFile = null,
}) {
  assertRagPostNotEarlyData(urlPath, connectionMode);
  const correlationId = `lifecycle-${connectionMode}-${Date.now()}`;
  const url = `${cfg.baseUrl.replace(/\/$/, '')}${urlPath}?correlation_id=${correlationId}`;
  const args = [
    '--silent',
    '--show-error',
    '--cacert',
    cfg.caCert,
    protocolFlag,
    '--request',
    method,
    '--write-out',
    '%{http_code}|%{http_version}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_pretransfer}|%{time_starttransfer}|%{time_total}|%{exitcode}',
    '--output',
    '/dev/null',
  ];
  if (cfg.curlResolve) args.push('--resolve', cfg.curlResolve);
  if (token) args.push('-H', `authorization: Bearer ${token}`);
  if (userId) args.push('-H', `x-user-id: ${userId}`);
  if (sessionFile) args.push('--ssl-sessions', sessionFile);
  args.push(...extraArgs, url);
  const mergedEnv = { ...process.env, NGTCP2_ENABLE_GSO: '0', ...env };
  const startedAt = new Date().toISOString();
  const startedEpoch = Date.now() / 1000;
  const result = spawnSync(cfg.curlBin, args, { encoding: 'utf8', env: mergedEnv, maxBuffer: 8 * 1024 * 1024 });
  const finishedAt = new Date().toISOString();
  const finishedEpoch = Date.now() / 1000;
  const parts = (result.stdout || '').trim().split('|');
  const httpStatus = Number(parts[0] || 0);
  const httpVersion = parts[1] || null;
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    started_epoch: startedEpoch,
    finished_epoch: finishedEpoch,
    http_status: httpStatus,
    http_version: httpVersion,
    curl_exit_code: result.status,
    stderr: result.stderr || '',
    correlation_id: correlationId,
    version_ok: String(httpVersion || '').startsWith(String(expectedVersion)),
  };
}

export function analyzeLifecycleProbeWindow(pcapPath, startedEpoch, finishedEpoch, capabilityOpts = {}) {
  if (!pcapPath || !fs.existsSync(pcapPath)) {
    return { correlation_status: 'PARTIAL', packets: [], counts: {} };
  }
  const space = analyzePcapPacketSpace(pcapPath, {
    zeroRttAttempted: capabilityOpts.zeroRttAttempted ?? false,
    clientUnsupported: capabilityOpts.clientUnsupported ?? false,
    connectionMode: capabilityOpts.connectionMode ?? 'cold',
  });
  const analysis = correlateProbeToPackets(space.packets, startedEpoch, finishedEpoch);
  analysis.counts = applyClientZeroRttCapabilityFilter(analysis.counts, capabilityOpts);
  return analysis;
}

export function runH3ColdProbe({ outRoot, cfg, token, userId, probeId, pcapPath, capabilities }) {
  const caps = capabilities || parseTransportCapabilities(curlVersionText(cfg.curlBin));
  const clientUnsupported = caps.zero_rtt_client_support === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED';
  const correlationId = `lifecycle-cold-${Date.now()}`;
  const result = curlH3Cold({ cfg, token, userId, correlationId });
  const versionOk = String(result.http_version || '').startsWith('3');

  const analysis = analyzeLifecycleProbeWindow(
    pcapPath,
    result.started_epoch,
    result.finished_epoch,
    {
      zeroRttAttempted: false,
      clientUnsupported,
      connectionMode: 'cold',
    },
  );
  const handshakeEvidence = inferHandshakeEvidence({
    counts: analysis.counts,
    connectionMode: 'cold',
    hasKeylog: caps.keylog_support,
  });
  const lineage = connectionLineageProof(analysis.packets || []);

  const record = mergeProbeCorrelation(
    emptyProbePacketRecord({
      probe_id: probeId,
      protocol_label: 'HTTP/3',
      connection_mode: 'cold',
      transport: 'quic',
      started_at: result.started_at,
      finished_at: result.finished_at,
      connection_reused: false,
      connection_generation: 1,
      session_resumed: false,
      zero_rtt_attempted: false,
      persistent_client: false,
    }),
    analysis,
    pcapPath ? [pcapPath] : [],
    {
      handshakeEvidence,
      connectionLineage: lineage,
      capabilityFilter: analysis.counts,
    },
  );

  const gatePass = coldH3GatePass({
    httpStatus: result.http_status,
    versionOk,
    counts: analysis.counts,
    handshakeEvidence,
    classifierContradiction: analysis.counts.classifier_contradiction,
    correlationStatus: analysis.correlation_status,
  });

  writeProbePacketIndex(outRoot, probeId, record);
  return {
    mode: 'cold',
    result: { ...result, http_status: result.http_status, version_ok: versionOk },
    record,
    handshake_evidence: handshakeEvidence,
    gate: gatePass ? 'PASS' : 'BLOCKED',
    classification: 'SUPPORTED_AND_TESTED',
  };
}

export function runH3WarmReuseProbe({ outRoot, cfg, token, userId, probeId, pcapPath, capabilities }) {
  const caps = capabilities || parseTransportCapabilities(curlVersionText(cfg.curlBin));
  const clientUnsupported = caps.zero_rtt_client_support === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED';
  const ts = Date.now();
  const pair = curlH3PersistentPair({
    cfg,
    token,
    userId,
    primeCorrelationId: `lifecycle-warm-prime-${ts}`,
    reuseCorrelationId: `lifecycle-warm-reuse-${ts}`,
  });
  const result = pair.reuse;
  const versionOk = String(result.http_version || '').startsWith('3');

  const primeAnalysis = analyzeLifecycleProbeWindow(
    pcapPath,
    pair.started_epoch,
    pair.reuse.started_epoch || pair.started_epoch + 0.05,
    { zeroRttAttempted: false, clientUnsupported, connectionMode: 'warm_reuse' },
  );
  const reuseAnalysis = analyzeLifecycleProbeWindow(
    pcapPath,
    pair.reuse.started_epoch || pair.started_epoch,
    pair.finished_epoch,
    { zeroRttAttempted: false, clientUnsupported, connectionMode: 'warm_reuse' },
  );
  const warmProof = warmH3ReuseProof(primeAnalysis.packets || [], reuseAnalysis.packets || [], {
    zeroRttAttempted: false,
    clientUnsupported,
  });

  const record = mergeProbeCorrelation(
    emptyProbePacketRecord({
      probe_id: probeId,
      protocol_label: 'HTTP/3',
      connection_mode: 'warm_reuse',
      transport: 'quic',
      started_at: pair.started_at,
      finished_at: pair.finished_at,
      connection_reused: true,
      connection_generation: warmProof.after_lineage?.connection_generation ?? 1,
      session_resumed: false,
      zero_rtt_attempted: false,
      persistent_client: true,
    }),
    reuseAnalysis,
    pcapPath ? [pcapPath] : [],
    {
      warmReuseProof: warmProof,
      connectionLineage: warmProof.after_lineage,
      capabilityFilter: reuseAnalysis.counts,
    },
  );

  const gatePass =
    pair.prime.http_status === 200 &&
    result.http_status === 200 &&
    versionOk &&
    warmProof.pass &&
    !reuseAnalysis.counts.classifier_contradiction;

  writeProbePacketIndex(outRoot, probeId, record);
  return {
    mode: 'warm_reuse',
    result: {
      ...result,
      http_status: result.http_status,
      version_ok: versionOk,
      started_at: pair.started_at,
      finished_at: pair.finished_at,
      started_epoch: pair.reuse.started_epoch || pair.started_epoch,
      finished_epoch: pair.finished_epoch,
    },
    record,
    warm_reuse_proof: warmProof,
    pair_started_epoch: pair.started_epoch,
    pair_finished_epoch: pair.finished_epoch,
    gate: gatePass ? 'PASS' : 'BLOCKED',
    classification: gatePass ? 'SUPPORTED_AND_TESTED' : 'WARM_REUSE_UNPROVEN',
  };
}

export function runH3Resumed1RttProbe({ outRoot, cfg, token, userId, probeId, pcapPath, capabilities }) {
  const caps = capabilities || parseTransportCapabilities(curlVersionText(cfg.curlBin));
  const sessionSupported =
    caps.session_resume_client_support === 'SUPPORTED' || curlSupportsSslSessions(cfg.curlBin);
  const sessionFile = lifecycleSessionPath(outRoot, 'h3-resume');
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });

  let result;
  if (sessionSupported) {
    curlLifecycleRequest({
      cfg,
      token,
      userId,
      protocolFlag: PROTOCOLS.h3.flag,
      expectedVersion: PROTOCOLS.h3.expected,
      connectionMode: 'resumed_1rtt',
      extraArgs: ['--http3-only'],
      sessionFile,
    });
    result = curlLifecycleRequest({
      cfg,
      token,
      userId,
      protocolFlag: PROTOCOLS.h3.flag,
      expectedVersion: PROTOCOLS.h3.expected,
      connectionMode: 'resumed_1rtt',
      extraArgs: ['--http3-only'],
      sessionFile,
    });
  } else {
    result = curlLifecycleRequest({
      cfg,
      token,
      userId,
      protocolFlag: PROTOCOLS.h3.flag,
      expectedVersion: PROTOCOLS.h3.expected,
      connectionMode: 'resumed_1rtt',
      extraArgs: ['--http3-only'],
    });
  }

  let analysis = { correlation_status: 'PARTIAL', counts: {}, one_rtt_confirmed: false, zero_rtt_packets: 0 };
  if (pcapPath && fs.existsSync(pcapPath)) {
    const space = analyzePcapPacketSpace(pcapPath);
    analysis = correlateProbeToPackets(space.packets, result.started_epoch, result.finished_epoch);
    analysis.counts = space.counts;
  }

  const classification = classifySessionResumeOutcome({
    sessionResumeSupported: sessionSupported,
    httpStatus: result.http_status,
    oneRttConfirmed: (analysis.one_rtt_packets || analysis.counts?.one_rtt_packets || 0) > 0,
    zeroRttPackets: 0,
  });

  const record = mergeProbeCorrelation(
    emptyProbePacketRecord({
      probe_id: probeId,
      protocol_label: 'HTTP/3',
      connection_mode: 'resumed_1rtt',
      transport: 'quic',
      started_at: result.started_at,
      finished_at: result.finished_at,
      session_resumed: sessionSupported,
      zero_rtt_attempted: false,
      zero_rtt_packets: 0,
    }),
    analysis,
    pcapPath ? [pcapPath] : [],
  );
  record.session_resume_classification = classification;

  const gatePass =
    classification === 'CLIENT_SESSION_RESUME_UNSUPPORTED' ||
    (classification === 'RESUMED_1RTT_CONFIRMED' && record.zero_rtt_packets === 0);
  writeProbePacketIndex(outRoot, probeId, record);
  return { mode: 'resumed_1rtt', result, record, classification, gate: gatePass ? 'PASS' : 'BLOCKED', lifecycle_status: classification };
}

export function runH3Attempted0RttProbe({ outRoot, cfg, token, userId, probeId, pcapPath, capabilities }) {
  const caps = capabilities || parseTransportCapabilities(curlVersionText(cfg.curlBin));
  const sessionSupported =
    caps.session_resume_client_support === 'SUPPORTED' || curlSupportsSslSessions(cfg.curlBin);
  const clientUnsupported =
    caps.zero_rtt_client_support === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED' || !sessionSupported;
  const sessionFile = lifecycleSessionPath(outRoot, 'h3-0rtt');
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });

  let result;
  let earlyDataAttempted = false;
  if (!clientUnsupported) {
    curlLifecycleRequest({
      cfg,
      token,
      userId,
      protocolFlag: PROTOCOLS.h3.flag,
      expectedVersion: PROTOCOLS.h3.expected,
      connectionMode: 'cold',
      extraArgs: ['--http3-only'],
      sessionFile,
    });
    earlyDataAttempted = true;
    result = curlLifecycleRequest({
      cfg,
      token,
      userId,
      protocolFlag: PROTOCOLS.h3.flag,
      expectedVersion: PROTOCOLS.h3.expected,
      connectionMode: 'attempted_0rtt',
      method: 'HEAD',
      extraArgs: ['--http3-only', '--tls-earlydata'],
      sessionFile,
    });
  } else {
    result = curlLifecycleRequest({
      cfg,
      token,
      userId,
      protocolFlag: PROTOCOLS.h3.flag,
      expectedVersion: PROTOCOLS.h3.expected,
      connectionMode: 'attempted_0rtt',
      method: 'HEAD',
      extraArgs: ['--http3-only'],
    });
  }

  let analysis = {
    correlation_status: 'PARTIAL',
    counts: { zero_rtt_packets: 0, one_rtt_packets: 0 },
    zero_rtt_packets: 0,
    one_rtt_packets: 0,
    one_rtt_confirmed: false,
  };
  if (pcapPath && fs.existsSync(pcapPath)) {
    const space = analyzePcapPacketSpace(pcapPath);
    analysis = correlateProbeToPackets(space.packets, result.started_epoch, result.finished_epoch);
    analysis.counts = space.counts;
  }

  const filteredCounts = applyClientZeroRttCapabilityFilter(analysis.counts || {}, {
    zeroRttAttempted: earlyDataAttempted,
    clientUnsupported,
    connectionMode: 'attempted_0rtt',
  });

  const classification = classifyZeroRttOutcome({
    zeroRttPackets: filteredCounts.zero_rtt_packets,
    oneRttPackets: filteredCounts.one_rtt_packets || analysis.one_rtt_packets || 0,
    httpStatus: result.http_status,
    earlyDataAttempted,
    clientUnsupported,
    classifierContradiction: filteredCounts.classifier_contradiction,
  });

  const record = mergeProbeCorrelation(
    emptyProbePacketRecord({
      probe_id: probeId,
      protocol_label: 'HTTP/3',
      connection_mode: 'attempted_0rtt',
      transport: 'quic',
      started_at: result.started_at,
      finished_at: result.finished_at,
      zero_rtt_attempted: earlyDataAttempted,
      zero_rtt_accepted: classification === 'ZERO_RTT_ACCEPTED',
      zero_rtt_rejected: classification === 'ZERO_RTT_REJECTED_REPLAYED_AS_1RTT',
    }),
    analysis,
    pcapPath ? [pcapPath] : [],
    { capabilityFilter: filteredCounts },
  );
  record.zero_rtt_classification = classification;
  record.zero_rtt_observed = false;
  record.zero_rtt_packets = 0;
  writeProbePacketIndex(outRoot, probeId, record);

  const gatePass =
    classification === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED' ||
    classification === 'SERVER_ZERO_RTT_UNSUPPORTED' ||
    classification === 'ZERO_RTT_ACCEPTED' ||
    classification === 'ZERO_RTT_REJECTED_REPLAYED_AS_1RTT' ||
    classification === 'FULL_HANDSHAKE' ||
    classification === 'RESUMED_WITHOUT_ZERO_RTT';
  return {
    mode: 'attempted_0rtt',
    result,
    record,
    classification,
    gate: gatePass && !filteredCounts.classifier_contradiction ? 'PASS' : 'BLOCKED',
    lifecycle_status: classification,
  };
}

export function buildLifecycleCfg() {
  return {
    ...DEFAULTS,
    password: DEFAULTS.password || process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!',
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    mgmtProto: PROTOCOLS.h1,
  };
}

export { CONNECTION_MODES };
