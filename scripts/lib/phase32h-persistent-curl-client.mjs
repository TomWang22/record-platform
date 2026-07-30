/**
 * Phase 32H-R1 — persistent curl client for warm-reuse lifecycle proof.
 * Uses curl --next to keep one connection across sequential requests.
 */
import { spawnSync } from 'node:child_process';
import { TRANSPORT_PROBE_PATH } from './phase32h-transport-capabilities.mjs';

export function buildTransportProbeUrl(baseUrl, correlationId) {
  return `${baseUrl.replace(/\/$/, '')}${TRANSPORT_PROBE_PATH}?correlation_id=${correlationId}`;
}

/**
 * Run two HTTP/3 HEAD requests on one persistent curl connection (--next).
 * Returns timing for prime and reuse requests separately.
 */
export function curlH3PersistentPair({
  cfg,
  token,
  userId,
  primeCorrelationId,
  reuseCorrelationId,
}) {
  const primeUrl = buildTransportProbeUrl(cfg.baseUrl, primeCorrelationId);
  const reuseUrl = buildTransportProbeUrl(cfg.baseUrl, reuseCorrelationId);
  const writeOut =
    'prime:%{http_code}|%{http_version}|%{time_starttransfer}|%{time_total};reuse:%{http_code}|%{http_version}|%{time_starttransfer}|%{time_total}';
  const args = [
    '--silent',
    '--show-error',
    '--cacert',
    cfg.caCert,
    '--http3-only',
    '--request',
    'HEAD',
    '--write-out',
    writeOut,
    '--output',
    '/dev/null',
  ];
  if (cfg.curlResolve) args.push('--resolve', cfg.curlResolve);
  if (token) args.push('-H', `authorization: Bearer ${token}`);
  if (userId) args.push('-H', `x-user-id: ${userId}`);
  args.push(primeUrl, '--next', '--request', 'HEAD', '--output', '/dev/null', reuseUrl);

  const startedAt = new Date().toISOString();
  const startedEpoch = Date.now() / 1000;
  const result = spawnSync(cfg.curlBin, args, {
    encoding: 'utf8',
    env: { ...process.env, NGTCP2_ENABLE_GSO: '0' },
    maxBuffer: 8 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const finishedEpoch = Date.now() / 1000;

  const out = (result.stdout || '').trim();
  const primePart = out.match(/prime:([^;]+)/)?.[1]?.split('|') || [];
  const reusePart = out.match(/reuse:([^;]+)/)?.[1]?.split('|') || [];

  return {
    started_at: startedAt,
    finished_at: finishedAt,
    started_eprp: startedEpoch,
    finished_eprp: finishedEpoch,
    curl_exit_code: result.status,
    stderr: result.stderr || '',
    prime: {
      http_status: Number(primePart[0] || 0),
      http_version: primePart[1] || null,
      correlation_id: primeCorrelationId,
    },
    reuse: {
      http_status: Number(reusePart[0] || 0),
      http_version: reusePart[1] || null,
      correlation_id: reuseCorrelationId,
      started_eprp: startedEpoch,
      finished_eprp: finishedEpoch,
    },
    persistent_client: true,
  };
}

/**
 * Run cold H3 as an isolated curl invocation (no connection cache).
 */
export function curlH3Cold({
  cfg,
  token,
  userId,
  correlationId,
}) {
  const url = buildTransportProbeUrl(cfg.baseUrl, correlationId);
  const args = [
    '--silent',
    '--show-error',
    '--cacert',
    cfg.caCert,
    '--http3-only',
    '--request',
    'HEAD',
    '--write-out',
    '%{http_code}|%{http_version}|%{time_total}',
    '--output',
    '/dev/null',
  ];
  if (cfg.curlResolve) args.push('--resolve', cfg.curlResolve);
  if (token) args.push('-H', `authorization: Bearer ${token}`);
  if (userId) args.push('-H', `x-user-id: ${userId}`);
  args.push(url);
  const startedAt = new Date().toISOString();
  const startedEpoch = Date.now() / 1000;
  const result = spawnSync(cfg.curlBin, args, {
    encoding: 'utf8',
    env: { ...process.env, NGTCP2_ENABLE_GSO: '0' },
    maxBuffer: 8 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const finishedEpoch = Date.now() / 1000;
  const parts = (result.stdout || '').trim().split('|');
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    started_eprp: startedEpoch,
    finished_eprp: finishedEpoch,
    http_status: Number(parts[0] || 0),
    http_version: parts[1] || null,
    curl_exit_code: result.status,
    stderr: result.stderr || '',
    correlation_id: correlationId,
    connection_mode: 'cold',
    persistent_client: false,
  };
}
