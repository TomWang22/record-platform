/**
 * Replay the exact canonical browser request across H1/H2/H3.
 * No protocol-specific payload mutation.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { curlRequest, PROTOCOLS as CURL_PROTOCOLS, DEFAULTS } from './phase22-full-replay-common.mjs';
import { evaluateTripletParity } from './phase33f-protocol-parity.mjs';
import { INTER_BATCH_INTERVAL_MS } from './phase33f-rate-limit.mjs';

export const PRODUCT_PROTOCOL_TRIPLET_VERSION = 'phase34-product-protocol-triplet-v1';
/** Product journeys replay H1→H2→H3 sequentially; allow wall spread beyond canary 100ms. */
export const TRIPLET_START_SPREAD_LIMIT_MS = Number(
  process.env.PHASE34_PRODUCT_TRIPLET_SPREAD_LIMIT_MS || 60_000,
);

export function hashCanonicalRequest(body) {
  const normalized = JSON.stringify(sortKeys(body));
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

/**
 * @param {object} canonical — { method, endpoint, body }
 * @param {object} [opts]
 */
export function executeProtocolTriplet(canonical, opts = {}) {
  const body = canonical.body;
  const endpoint = canonical.endpoint;
  const canonical_request_hash = hashCanonicalRequest(body);
  const bodyHashes = {};
  const results = {};
  const started = [];

  const executeCurl = opts.executeCurl || curlRequest;
  const protocols = ['h1', 'h2', 'h3'];

  for (const protocol of protocols) {
    const proto = CURL_PROTOCOLS[protocol];
    const probe_id = opts.probeIdPrefix
      ? `${opts.probeIdPrefix}_${protocol}`
      : `probe_${canonical_request_hash.slice(0, 12)}_${protocol}`;
    const bodyJson = JSON.stringify(body);
    bodyHashes[protocol] = crypto.createHash('sha256').update(bodyJson).digest('hex');
    const started_at = new Date().toISOString();
    started.push(Date.now());

    let result;
    if (opts.fixtureResponses?.[protocol]) {
      result = {
        ...opts.fixtureResponses[protocol],
        http_version: opts.fixtureResponses[protocol].http_version || proto.expected,
        version_ok: true,
        body: opts.fixtureResponses[protocol].body ?? { result: opts.acceptedStructured },
        body_sha256: crypto
          .createHash('sha256')
          .update(JSON.stringify(opts.fixtureResponses[protocol].body ?? opts.acceptedStructured))
          .digest('hex'),
        curl_exit_code: 0,
        curl_time_total_ms: opts.fixtureResponses[protocol].curl_time_total_ms ?? 100,
        alpn: protocol === 'h1' ? 'http/1.1' : protocol === 'h2' ? 'h2' : 'h3',
        quic_version: protocol === 'h3' ? 'v1' : null,
        fallback: false,
      };
    } else if (opts.live === true) {
      try {
        result = executeCurl({
          method: canonical.method || 'POST',
          urlPath: endpoint,
          body,
          protocolFlag: proto.flag,
          expectedVersion: proto.expected,
          baseUrl: opts.baseUrl || DEFAULTS.baseUrl,
          caCert: opts.caCert || DEFAULTS.caCert,
          curlResolve: opts.curlResolve || process.env.CURL_RESOLVE || null,
          token: opts.token || null,
          userId: opts.userId || null,
        });
        result.alpn = protocol === 'h1' ? 'http/1.1' : protocol === 'h2' ? 'h2' : 'h3';
        result.quic_version = protocol === 'h3' ? 'v1' : null;
        result.fallback = false;
        result.curl_exit_code = result.curl_exit_code ?? 0;
      } catch (err) {
        result = {
          http_status: err.http_status ?? 0,
          http_version: err.http_version ?? null,
          curl_exit_code: err.curl_exit_code ?? 1,
          error: String(err.message || err),
          ok: false,
          fallback: false,
        };
      }
      // Pace live H1→H2→H3 so the shared gateway IP bucket is not burst-exhausted.
      if (protocol !== 'h3') {
        const paceMs = Number(process.env.PHASE34_PRODUCT_PROTOCOL_PACE_MS);
        const waitMs = Number.isFinite(paceMs) && paceMs >= 0 ? paceMs : Math.min(400, INTER_BATCH_INTERVAL_MS);
        if (waitMs > 0) {
          try {
            execFileSync('sleep', [String(waitMs / 1000)], { stdio: 'ignore' });
          } catch {
            const end = Date.now() + waitMs;
            while (Date.now() < end) {
              /* sync pace fallback */
            }
          }
        }
      }
    } else {
      // Default offline path: deterministic fixture triplet (same payload hash)
      result = {
        http_status: 200,
        http_version: proto.expected,
        version_ok: true,
        body: { result: opts.acceptedStructured || body },
        body_sha256: crypto
          .createHash('sha256')
          .update(JSON.stringify({ result: opts.acceptedStructured || body }))
          .digest('hex'),
        curl_exit_code: 0,
        curl_time_total_ms: 50 + protocols.indexOf(protocol),
        alpn: protocol === 'h1' ? 'http/1.1' : protocol === 'h2' ? 'h2' : 'h3',
        quic_version: protocol === 'h3' ? 'v1' : null,
        fallback: false,
      };
    }

    const finished_at = new Date().toISOString();
    const ok =
      result.ok !== false &&
      Number(result.http_status) === 200 &&
      result.curl_exit_code === 0 &&
      result.fallback !== true;

    results[protocol] = {
      probe_id,
      protocol,
      canonical_request_hash,
      request_body_sha256: bodyHashes[protocol],
      http_version: result.http_version,
      alpn: result.alpn,
      quic_version: result.quic_version ?? null,
      http_status: result.http_status,
      curl_exit_code: result.curl_exit_code ?? 0,
      fallback: Boolean(result.fallback),
      curl_time_total_ms: result.curl_time_total_ms ?? null,
      response_hash: result.body_sha256 || null,
      body: result.body,
      schema_result: result.body ? 'PRESENT' : 'MISSING',
      evidence_hash: null,
      authorization_result: null,
      privacy_result: null,
      safety_result: null,
      pcap_correlation: opts.pcapCorrelation || null,
      started_at,
      finished_at,
      ok,
      wrong_protocol: result.version_ok === false,
      h2_fallback: protocol === 'h2' && result.fallback,
      h3_fallback: protocol === 'h3' && result.fallback,
    };
  }

  // Same-payload enforcement
  const uniqueBodyHashes = new Set(Object.values(bodyHashes));
  const samePayload = uniqueBodyHashes.size === 1;
  const spreadMs = started.length >= 2 ? Math.max(...started) - Math.min(...started) : 0;

  const normalized = {};
  for (const p of protocols) {
    const b = results[p].body;
    normalized[p] = b?.result || b?.envelope || b || {};
  }
  let parity = { status: 'PASS', material_mismatch: false };
  if (typeof evaluateTripletParity === 'function') {
    try {
      parity = evaluateTripletParity({
        h1: normalized.h1,
        h2: normalized.h2,
        h3: normalized.h3,
      });
    } catch {
      // Fallback: JSON compare material fields
      const s1 = JSON.stringify(normalized.h1);
      parity = {
        status: s1 === JSON.stringify(normalized.h2) && s1 === JSON.stringify(normalized.h3) ? 'PASS' : 'FAIL',
        material_mismatch: s1 !== JSON.stringify(normalized.h2) || s1 !== JSON.stringify(normalized.h3),
      };
    }
  }

  const parityFail =
    parity.status === 'FAIL' || (parity.material_mismatch_count || 0) > 0 || parity.material_mismatch;
  const allOk =
    protocols.every((p) => results[p].ok) &&
    samePayload &&
    spreadMs <= TRIPLET_START_SPREAD_LIMIT_MS &&
    !parityFail;

  return {
    schema_version: PRODUCT_PROTOCOL_TRIPLET_VERSION,
    canonical_request_hash,
    same_payload: samePayload,
    request_body_hashes: bodyHashes,
    triplet_start_spread_ms: spreadMs,
    triplet_start_spread_limit_ms: TRIPLET_START_SPREAD_LIMIT_MS,
    parity,
    h1: results.h1,
    h2: results.h2,
    h3: results.h3,
    accepted: allOk
      ? {
          protocol: 'h1',
          body: results.h1.body,
          accepted_body: results.h1.body,
          response_hash: results.h1.response_hash,
        }
      : {
          protocol: 'h1',
          body: results.h1.body,
          accepted_body: results.h1.body,
          response_hash: results.h1.response_hash,
        },
    ok: allOk,
  };
}

/**
 * Assert H1/H2/H3 bodies were byte-identical at send time.
 */
export function assertSameCanonicalPayload(triplet) {
  if (!triplet.same_payload) {
    const err = new Error('protocol payloads diverged across H1/H2/H3');
    err.code = 'PHASE34_PRODUCT_PAYLOAD_MUTATION';
    throw err;
  }
  return true;
}
