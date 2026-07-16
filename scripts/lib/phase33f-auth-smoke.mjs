/**
 * Phase 33F live authorization smoke. This creates evidence only in a dedicated
 * temporary root and deliberately fails closed when the edge does not enforce a
 * fixture-principal boundary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CONTRACT,
  DEFAULTS,
  PROTOCOLS,
  STAGING_6,
  curlRequest,
  jwtSub,
  login,
  resolveCurlTarget,
} from './phase22-full-replay-common.mjs';
import {
  AUTH_SMOKE_ROOT as CONFIG_AUTH_SMOKE_ROOT,
  CAPABILITY_ROUTE_PATHS,
  REAL_CANARY_ROOT,
  REAL_TARGET_ROOT,
} from './phase33f-canary-config.mjs';
import { stopSmokeCollectors } from './phase32h-smoke-collector-cleanup.mjs';

export const AUTH_SMOKE_ROOT = CONFIG_AUTH_SMOKE_ROOT;
const PRIVATE_MARKERS = /proxy_bids|max_bid_cents|private message body|raw message body|authorization bearer|eyj[a-z0-9_-]+\./i;
const FALLBACK_MARKERS = /fallback|keyword_default|keyword_fallback/i;

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

export function assertSafeAuthSmokeRoot(outRoot = AUTH_SMOKE_ROOT) {
  if (outRoot === REAL_CANARY_ROOT || outRoot === REAL_TARGET_ROOT) {
    throw new Error(`real gauntlet root is forbidden for auth smoke: ${outRoot}`);
  }
  if (!outRoot.startsWith('/tmp/phase33f-canary-auth-smoke')) {
    throw new Error(`auth smoke requires a dedicated auth smoke root: ${outRoot}`);
  }
  return outRoot;
}

function sanitizedBodyFlags(body) {
  const serialized = JSON.stringify(body || {});
  return {
    private_leakage: PRIVATE_MARKERS.test(serialized),
    fallback: FALLBACK_MARKERS.test(serialized),
    gate: body?.gate_reason || body?.details?.hybrid_canary?.gate_reason || null,
  };
}

function fixtureRequest(scenario, ownerId, otherId) {
  const common = {
    capability: 'semantic_search',
    mode: 'semantic_fixture_or_staging',
    retrieval_mode: 'semantic_fixture',
    fixture_band: 'development',
    production_mutation_allowed: false,
  };
  switch (scenario) {
    case 'public_contract_auth':
      return { ...common, principal_fixture: ownerId, query_id: 'public-contract-fixture' };
    case 'authorized_owner_private':
      return {
        ...common,
        principal_fixture: ownerId,
        authorization_scopes: ['authenticated_market', 'owner_private_fixture'],
        owner_principal_fixture: ownerId,
        query_id: 'owner-private-fixture',
      };
    case 'unauthorized_refusal':
      return {
        ...common,
        principal_fixture: ownerId,
        authorization_scopes: ['owner_private_fixture'],
        owner_principal_fixture: ownerId,
        unauthorized_scope: true,
      };
    case 'cross_user_refusal':
      return {
        ...common,
        principal_fixture: otherId,
        owner_principal_fixture: ownerId,
        authorization_scopes: ['authenticated_market', 'cross_user_private'],
        cross_user_attempt: true,
      };
    case 'deleted_source_refusal':
      return {
        ...common,
        principal_fixture: ownerId,
        authorization_scopes: ['authenticated_market', 'owner_private_fixture'],
        source_state: 'deleted',
        deleted_source: true,
      };
    default:
      throw new Error(`unknown auth smoke scenario: ${scenario}`);
  }
}

export function evaluateAuthSmokeRows(rows) {
  const failures = [];
  for (const row of rows) {
    const isRefusal = row.scenario.endsWith('_refusal');
    if (row.retries !== 0) failures.push({ scenario: row.scenario, protocol: row.protocol, reason: 'retry_observed' });
    if (row.http_version !== PROTOCOLS[row.protocol]?.expected) {
      failures.push({ scenario: row.scenario, protocol: row.protocol, reason: 'wrong_protocol' });
    }
    if (isRefusal) {
      if (!(row.http_status >= 400 && row.http_status < 500)) {
        failures.push({ scenario: row.scenario, protocol: row.protocol, reason: 'expected_deterministic_4xx' });
      }
    } else if (row.http_status !== 200) {
      failures.push({ scenario: row.scenario, protocol: row.protocol, reason: 'expected_success' });
    }
    if (row.private_leakage) failures.push({ scenario: row.scenario, protocol: row.protocol, reason: 'private_leakage' });
    if (row.fallback) failures.push({ scenario: row.scenario, protocol: row.protocol, reason: 'fallback_observed' });
    if (!isRefusal && row.gate && row.gate !== 'authenticated_market' && row.gate !== 'allowlist') {
      failures.push({ scenario: row.scenario, protocol: row.protocol, reason: 'wrong_gate' });
    }
  }
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}

function writeEvidence(outRoot, payload) {
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'phase33f-auth-smoke.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function liveAuthSmoke({ outRoot = AUTH_SMOKE_ROOT, repoRoot, baseUrl = DEFAULTS.baseUrl, caCert = DEFAULTS.caCert } = {}) {
  outRoot = outRoot || AUTH_SMOKE_ROOT;
  assertSafeAuthSmokeRoot(outRoot);
  const cfg = {
    ...DEFAULTS,
    baseUrl,
    caCert,
    password: DEFAULTS.password || process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!',
    curlResolve: resolveCurlTarget(baseUrl),
    mgmtProto: PROTOCOLS.h1,
  };
  const scenarios = [
    'public_contract_auth',
    'authorized_owner_private',
    'unauthorized_refusal',
    'cross_user_refusal',
    'deleted_source_refusal',
  ];
  const rows = [];
  let cleanup = null;
  let error = null;

  try {
    fs.mkdirSync(outRoot, { recursive: true });
    const owner = CONTRACT;
    const other = STAGING_6.find((candidate) => candidate.uid !== owner.uid);
    if (!other) throw new Error('sanitized secondary fixture principal is unavailable');
    const ownerToken = login(owner.email, cfg);
    const otherToken = login(other.email, cfg);
    const ownerId = jwtSub(ownerToken);
    const otherId = jwtSub(otherToken);

    for (const scenario of scenarios) {
      for (const [protocol, spec] of Object.entries(PROTOCOLS)) {
        const token = scenario === 'unauthorized_refusal' ? null : scenario === 'cross_user_refusal' ? otherToken : ownerToken;
        const userId = scenario === 'unauthorized_refusal' ? null : scenario === 'cross_user_refusal' ? otherId : ownerId;
        let response;
        try {
          response = curlRequest({
            method: 'POST',
            urlPath: CAPABILITY_ROUTE_PATHS.semantic_search,
            token,
            userId,
            body: fixtureRequest(scenario, ownerId, otherId),
            protocolFlag: spec.flag,
            expectedVersion: spec.expected,
            baseUrl: cfg.baseUrl,
            caCert: cfg.caCert,
            curlResolve: cfg.curlResolve,
          });
        } catch (requestError) {
          response = {
            http_status: null,
            http_version: null,
            curl_exit_code: requestError.curl_exit_code ?? 1,
            body: {},
          };
        }
        const bodyFlags = sanitizedBodyFlags(response.body);
        rows.push({
          scenario,
          protocol,
          http_status: response.http_status,
          http_version: response.http_version,
          curl_exit_code: response.curl_exit_code ?? 0,
          retries: 0,
          ...bodyFlags,
        });
      }
    }
  } catch (caught) {
    error = String(caught.message || caught);
  } finally {
    cleanup = stopSmokeCollectors(outRoot, { repoRoot });
  }

  const evaluation = evaluateAuthSmokeRows(rows);
  const report = {
    status: error || !cleanup?.zero_root_scoped ? 'FAIL' : evaluation.status,
    root: outRoot,
    scenarios: rows,
    failures: [
      ...evaluation.failures,
      ...(error ? [{ reason: 'smoke_execution_error' }] : []),
      ...(!cleanup?.zero_root_scoped ? [{ reason: 'collectors_not_stopped' }] : []),
    ],
    principal_hashes: rows.length ? { owner: digest(CONTRACT.uid), secondary_fixture: digest(STAGING_6[1]?.uid || '') } : {},
    collectors_stopped: cleanup?.zero_root_scoped === true,
    post_smoke_root_scoped_processes: cleanup?.remaining_processes?.length ?? null,
    error,
  };
  writeEvidence(outRoot, report);
  return report;
}
