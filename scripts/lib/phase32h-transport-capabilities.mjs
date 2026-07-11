/**
 * Phase 32H-R1 — transport capability preflight from curl -V output.
 */
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS } from './phase22-full-replay-common.mjs';

export const TRANSPORT_PROBE_PATH = '/api/ai/rag/transport-probe';
export const QUIC_V1_HEX = '0x00000001';
export const QUIC_V2_HEX = '0x6b3343cf';

export function curlVersionText(curlBin = DEFAULTS.curlBin) {
  const r = spawnSync(curlBin, ['-V'], { encoding: 'utf8' });
  return `${r.stdout || ''}\n${r.stderr || ''}`.trim();
}

/** Runtime probe — help text may advertise flags libcurl was not built with. */
export function curlSupportsSslSessions(curlBin = DEFAULTS.curlBin) {
  const sessionPath = path.join(os.tmpdir(), `phase32h-ssl-sessions-probe-${process.pid}.sslsession`);
  const r = spawnSync(curlBin, ['--ssl-sessions', sessionPath, '--version'], { encoding: 'utf8' });
  const text = `${r.stderr || ''}${r.stdout || ''}`;
  try {
    fs.unlinkSync(sessionPath);
  } catch {
    /* probe file may not exist */
  }
  return !/does not support this/i.test(text);
}

export function curlSupportsTlsEarlyData(curlBin = DEFAULTS.curlBin) {
  const r = spawnSync(curlBin, ['--tls-earlydata', '--version'], { encoding: 'utf8' });
  const text = `${r.stderr || ''}${r.stdout || ''}`;
  return !/does not support this/i.test(text) && !/unknown option/i.test(text);
}

export function parseTransportCapabilities(versionText) {
  const text = versionText || '';
  const lower = text.toLowerCase();
  let helpText = '';
  try {
    helpText = spawnSync(DEFAULTS.curlBin, ['--help', 'all'], { encoding: 'utf8' }).stdout || '';
  } catch {
    helpText = '';
  }
  const http2 = /\bhttp2\b/i.test(text) || lower.includes('nghttp2');
  const http3 = /\bhttp3\b/i.test(text) || lower.includes('nghttp3');
  const tlsBackend = (text.match(/(openssl|libressl|boringssl|secure transport)[^\n]*/i) || [])[0] || null;
  const quicBackend = (text.match(/ngtcp2\/[0-9.]+/i) || [])[0] || null;
  const nghttp3 = (text.match(/nghttp3\/[0-9.]+/i) || [])[0] || null;
  const sessionTicketsHelp = /--ssl-sessions/i.test(helpText) || /--ssl-sessions/i.test(text);
  const tlsEarlyDataHelp = /--tls-earlydata/i.test(helpText) || /--tls-earlydata/i.test(text);
  const sessionTicketsRuntime = sessionTicketsHelp ? curlSupportsSslSessions(DEFAULTS.curlBin) : false;
  const tlsEarlyDataRuntime = tlsEarlyDataHelp ? curlSupportsTlsEarlyData(DEFAULTS.curlBin) : false;
  const keylog = process.env.SSLKEYLOGFILE != null || lower.includes('sslkeylogfile');
  const qlog =
    Boolean(process.env.QLOGDIR) ||
    Boolean(process.env.CURL_DEBUG) ||
    lower.includes('qlog');
  const curlVersion = (text.match(/curl\s+([0-9.]+)/i) || [])[1] || null;

  let sessionResumeClientSupport = 'INDETERMINATE';
  if (http3 && sessionTicketsRuntime) {
    sessionResumeClientSupport = 'SUPPORTED';
  } else if (http3 && sessionTicketsHelp && !sessionTicketsRuntime) {
    sessionResumeClientSupport = 'CLIENT_SESSION_RESUME_UNSUPPORTED';
  } else if (!http3) {
    sessionResumeClientSupport = 'HTTP3_UNSUPPORTED';
  }

  let zeroRttClientSupport = 'INDETERMINATE';
  if (http3 && tlsEarlyDataRuntime && sessionTicketsRuntime && quicBackend) {
    zeroRttClientSupport = 'PROBABLE';
  } else if (http3 && (!tlsEarlyDataRuntime || !sessionTicketsRuntime)) {
    zeroRttClientSupport = 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED';
  } else if (!http3) {
    zeroRttClientSupport = 'HTTP3_UNSUPPORTED';
  }

  return {
    captured_at: new Date().toISOString(),
    curl_bin: DEFAULTS.curlBin,
    curl_version: curlVersion,
    version_text: text,
    http2_backend: http2 ? 'nghttp2' : null,
    http3_backend: http3 ? quicBackend || 'ngtcp2' : null,
    tls_backend: tlsBackend,
    quic_backend: quicBackend,
    nghttp3_version: nghttp3,
    session_ticket_support_help: sessionTicketsHelp,
    session_ticket_support_runtime: sessionTicketsRuntime,
    session_resume_client_support: sessionResumeClientSupport,
    tls_earlydata_flag_help: tlsEarlyDataHelp,
    tls_earlydata_flag_runtime: tlsEarlyDataRuntime,
    keylog_support: keylog,
    qlog_support: qlog,
    zero_rtt_client_support: zeroRttClientSupport,
    zero_rtt_server_support: 'UNKNOWN_UNTIL_PROBE',
    safe_early_data_endpoint: TRANSPORT_PROBE_PATH,
    rag_post_early_data_blocked: true,
    quic_versions_supported_client: [QUIC_V1_HEX, QUIC_V2_HEX],
  };
}

export function writeTransportCapabilities(outRoot, caps = null) {
  const dir = path.join(outRoot, 'transport');
  fs.mkdirSync(dir, { recursive: true });
  const payload = caps || parseTransportCapabilities(curlVersionText());
  const file = path.join(dir, 'capabilities.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { file, payload };
}

export function assertRagPostNotEarlyData(urlPath, connectionMode) {
  if (connectionMode !== 'attempted_0rtt') return true;
  if (urlPath === '/api/ai/rag/query' || urlPath.endsWith('/rag/query')) {
    throw new Error('RAG POST must not be sent as QUIC/TLS early data');
  }
  if (!urlPath.includes('/rag/transport-probe')) {
    throw new Error('0-RTT attempts limited to transport-probe endpoint');
  }
  return true;
}
