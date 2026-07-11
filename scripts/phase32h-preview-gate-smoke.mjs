#!/usr/bin/env node
/**
 * Phase 32H preview-gate diagnostic smoke (operator-enabled live mode).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  PROTOCOLS,
  CONTRACT,
  loadN5Participants,
  expectedGate,
  login,
  previewEnroll,
  previewApi,
  ragQuery,
  extractMeta,
  resolveCurlTarget,
  jwtSub,
} from './lib/phase22-full-replay-common.mjs';
import { validateParticipantIdentity } from './lib/phase31-preview-window-coordinator.mjs';
import { classifyHttp422RootCause } from './lib/http-retry-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = '/tmp/phase32h-preview-gate-diagnosis';

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, infraOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--infra-only') opts.infraOnly = true;
  }
  return opts;
}

function hash12(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function redactGateResult({ user, proto, resp, expectedGate, enrollment }) {
  return {
    protocol: proto.label,
    user_class: user.user_class,
    user_hash: hash12(user.uid),
    jwt_sub_hash: hash12(jwtSub(enrollment.token)),
    x_user_id_hash: hash12(user.uid),
    artifact_uid_hash: hash12(user.uid),
    expected_gate: expectedGate,
    observed_gate: extractMeta(resp.body || {}).gate_reason,
    http_status: resp.http_status,
    structured_error_code: resp.body?.error_code || resp.body?.code || null,
    structured_error_detail: resp.body?.error || resp.body?.detail || null,
    retrieval_mode: extractMeta(resp.body || {}).retrieval_mode,
    retry_count: resp.retry_count ?? 0,
    retry_delay_ms: resp.retry_delay_ms ?? 0,
    enrollment_mutation: enrollment.mutation,
    enrollment_readback: enrollment.readback,
    root_cause_422: resp.http_status === 422 ? classifyHttp422RootCause(resp.body || {}) : null,
  };
}

function selectUsers() {
  const users = loadN5Participants();
  const contract = users.find((u) => u.role === 'allowlist') || CONTRACT;
  const preview = users.find((u) => u.user_class === 'real_participant' && u.role !== 'allowlist');
  const control = users.find((u) => u.user_class === 'real_participant' && u !== preview);
  return { contract, preview, control };
}

export async function runPreviewGateSmoke(opts) {
  fs.mkdirSync(opts.out, { recursive: true });
  const { contract, preview, control } = selectUsers();
  const cfg = {
    ...DEFAULTS,
    password: process.env.T20_PARTICIPANT_LOGIN_PASSWORD || DEFAULTS.password || 'ContractPass123!',
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    mgmtProto: PROTOCOLS.h1,
  };

  const requestContracts = [];
  const enrollmentReadback = [];
  const gateResults = [];
  const verdict = { status: 'PASS', wrong_gate: 0, deterministic_4xx_retries: 0 };

  const probes = [];
  if (contract) {
    probes.push({ user: contract, protocols: [PROTOCOLS.h1, PROTOCOLS.h2, PROTOCOLS.h3], enroll: false });
  }
  if (preview) {
    probes.push({ user: preview, protocols: [PROTOCOLS.h1, PROTOCOLS.h2, PROTOCOLS.h3], enroll: true });
  }

  for (const probe of probes) {
    const token = login(probe.user.email, cfg);
    validateParticipantIdentity(probe.user, token);
    let mutation = 'skipped';
    let readback = 'skipped';
    if (probe.enroll) {
      const enrollResp = previewEnroll(token, probe.user.uid, cfg);
      mutation = enrollResp.http_status === 200 ? 'PASS' : `FAIL:${enrollResp.http_status}`;
      const statusGate = previewApi('GET', 'status', token, probe.user.uid, cfg).body?.gate_reason;
      readback = statusGate === 'preview_opt_in' ? 'PASS' : `FAIL:${statusGate}`;
      enrollmentReadback.push({
        user_hash: hash12(probe.user.uid),
        mutation,
        readback,
      });
    }
  }

  if (opts.infraOnly) {
    const payload = { status: 'PASS', mode: 'infra-only', probes_planned: probes.length };
    fs.writeFileSync(path.join(opts.out, 'final-verdict.json'), `${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }

  if (process.env.PHASE32H_PREVIEW_GATE_SMOKE !== '1') {
    const payload = {
      status: 'SKIP',
      reason: 'Set PHASE32H_PREVIEW_GATE_SMOKE=1 for live staging smoke',
    };
    fs.writeFileSync(path.join(opts.out, 'final-verdict.json'), `${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }

  for (const probe of probes) {
    const token = login(probe.user.email, cfg);
    const expected = expectedGate(probe.user);
    const enrollment = { token, mutation: probe.enroll ? 'enrolled' : 'none', readback: 'live' };
    for (const proto of probe.protocols) {
      const resp = ragQuery(token, probe.user.uid, 'Which of my listings need attention first, and why?', cfg, proto, {
        maxRetries: 1,
      });
      const row = redactGateResult({ user: probe.user, proto, resp, expectedGate: expected, enrollment });
      gateResults.push(row);
      requestContracts.push({
        protocol: proto.label,
        user_class: probe.user.user_class,
        expected_gate: expected,
      });
      if (row.retry_count > 0 && row.http_status === 422) {
        verdict.deterministic_4xx_retries += row.retry_count;
      }
      if (row.http_status !== 200 || row.observed_gate !== expected) {
        verdict.wrong_gate += 1;
        verdict.status = 'BLOCKED';
      }
    }
  }

  fs.writeFileSync(path.join(opts.out, 'request-contracts.json'), `${JSON.stringify(requestContracts, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'enrollment-readback.json'), `${JSON.stringify(enrollmentReadback, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'gate-results.json'), `${JSON.stringify(gateResults, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'final-verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);

  if (verdict.status !== 'PASS') {
    throw new Error(`preview gate smoke BLOCKED: ${JSON.stringify(verdict)}`);
  }
  return verdict;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const verdict = await runPreviewGateSmoke(opts);
  console.log(JSON.stringify(verdict, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
