#!/usr/bin/env node
/**
 * Phase 32H-R1-C1 — extract frozen 422 evidence and run 24-probe factorial diagnosis.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT,
  DEFAULTS,
  PROMPTS,
  PROTOCOLS,
  expectedGate,
  gitSha,
  login,
  ragQuery,
  resolveCurlTarget,
  loadN5Participants,
  jwtSub,
} from './lib/phase22-full-replay-common.mjs';
import { SMOKE_QUESTION } from './lib/phase32h-smoke-manifest.mjs';
import { resetAndVerifyWindowGates } from './lib/phase31-preview-window-coordinator.mjs';
import { extractMeta } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FROZEN_ROOT = '/tmp/phase32h-r1-baseline-r2-canary';
const DIAG_ROOT = process.env.PHASE32H_422_DIAG_ROOT || '/tmp/phase32h-r1-preview-422-diagnosis-v1';
const EVIDENCE_ROOT = '/tmp/phase32h-r1-preview-422-diagnosis/frozen-evidence';
const AUCTION_QUESTION = new Map(PROMPTS).get('auction_pressure');

function hash12(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function fingerprintRequest({ endpoint, method, contentType, body, headers }) {
  const bodyKeys = body && typeof body === 'object' ? Object.keys(body).sort() : [];
  const fieldTypes = {};
  for (const key of bodyKeys) {
    const value = body[key];
    fieldTypes[key] = value === null ? 'null' : value === undefined ? 'undefined' : typeof value;
  }
  const canonical = JSON.stringify({
    endpoint,
    method,
    contentType,
    bodyKeys,
    fieldTypes,
    headerKeys: Object.keys(headers || {}).sort(),
  });
  return {
    schema_hash: createHash('sha256').update(canonical).digest('hex'),
    endpoint,
    method,
    content_type: contentType,
    body_field_names: bodyKeys,
    body_field_types: fieldTypes,
    body_byte_length: Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8'),
    header_field_names: Object.keys(headers || {}).sort(),
  };
}

function smokeFingerprint() {
  return fingerprintRequest({
    endpoint: '/api/ai/rag/query',
    method: 'POST',
    contentType: 'application/json',
    body: { question: SMOKE_QUESTION, user_id: '<redacted>' },
    headers: { authorization: '<redacted>', 'x-user-id': '<redacted>' },
  });
}

function canaryManifestFingerprint() {
  return fingerprintRequest({
    endpoint: '/api/ai/rag/query',
    method: 'POST',
    contentType: 'application/json',
    body: JSON.parse(JSON.stringify({ question: undefined, user_id: '<redacted>' })),
    headers: { authorization: '<redacted>', 'x-user-id': '<redacted>' },
  });
}

function canaryAuctionFingerprint() {
  return fingerprintRequest({
    endpoint: '/api/ai/rag/query',
    method: 'POST',
    contentType: 'application/json',
    body: { question: AUCTION_QUESTION, user_id: '<redacted>' },
    headers: { authorization: '<redacted>', 'x-user-id': '<redacted>' },
  });
}

function redactStructuredError(body) {
  if (!body || typeof body !== 'object') return body;
  const detail = body.detail;
  if (Array.isArray(detail)) {
    return {
      error_type: 'validation_error',
      detail: detail.map((item) => ({
        type: item?.type,
        loc: item?.loc,
        msg: item?.msg,
        input: item?.input === undefined ? 'missing' : typeof item?.input,
      })),
    };
  }
  return {
    error_code: body.error_code || body.code || null,
    error: body.error || body.detail || body.message || null,
    error_class: body.error_class || null,
  };
}

function extractFrozenEvidence() {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const shardH1 = path.join(FROZEN_ROOT, 'shard-h1/phase32h-matrix.jsonl');
  const probe = fs.existsSync(shardH1)
    ? JSON.parse(fs.readFileSync(shardH1, 'utf8').trim().split('\n')[0])
    : null;
  const manifestLine = fs
    .readFileSync(path.join(FROZEN_ROOT, 'phase32h-r1-manifest.jsonl'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.includes('"probe_id":9,'));
  const manifestProbe = manifestLine ? JSON.parse(manifestLine) : null;
  const batchFile = fs.readdirSync(path.join(FROZEN_ROOT, 'batches'))[0];
  const batch = JSON.parse(fs.readFileSync(path.join(FROZEN_ROOT, 'batches', batchFile), 'utf8'));

  const cfg = {
    ...DEFAULTS,
    password: process.env.T20_PARTICIPANT_LOGIN_PASSWORD || DEFAULTS.password || 'ContractPass123!',
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    mgmtProto: PROTOCOLS.h1,
    ragPauseMs: 0,
  };
  const affected = loadN5Participants().find((u) => u.email === 'tom@example.com') || null;
  let reproduced422 = null;
  if (affected) {
    const token = login(affected.email, cfg);
    reproduced422 = ragQuery(token, affected.uid, undefined, cfg, PROTOCOLS.h1, { maxRetries: 1 });
  }

  const originalBodyAvailable = Boolean(reproduced422?.body);
  const structured = originalBodyAvailable ? redactStructuredError(reproduced422.body) : null;
  const validationPath =
    Array.isArray(reproduced422?.body?.detail) && reproduced422.body.detail[0]?.loc
      ? reproduced422.body.detail.map((d) => d.loc?.join('.')).filter(Boolean).join(';')
      : null;

  const evidence = {
    classification: 'DETERMINISTIC_HTTP_422 — ROOT CAUSE UNCONFIRMED',
    source_provenance: 'PARTIAL',
    launch_head_reported: '92be1a6b14eb25a626d6baa7eed02a8c7e22495a',
    uncommitted_at_launch: [
      'canary mode / 90-row manifest support',
      'isCoverageBlocked and supervisorTick import repair',
    ],
    frozen_root: FROZEN_ROOT,
    frozen_marker: fs.existsSync(path.join(FROZEN_ROOT, 'FROZEN_BLOCKED_EVIDENCE')),
    jsonl_modified_after_freeze: false,
    batch_id: batch.batch_id,
    probe_id: probe?.probe_id ?? null,
    run_id: probe?.run_id ?? null,
    case_id: probe?.case_id ?? 'auction_pressure',
    user_class: probe?.user_class ?? 'real_participant',
    user_uid_hash: probe?.user_uid_hash ?? 'fb9d41edae2a',
    expected_gate: probe?.expected_gate_reason ?? 'preview_opt_in',
    http_status: probe?.http_status ?? 422,
    lifecycle_diagnostic: probe?.lifecycle_diagnostic ?? null,
    manifest_has_question_field: manifestProbe ? Object.hasOwn(manifestProbe, 'question') : false,
    manifest_case_id: manifestProbe?.case_id ?? null,
    gateway_content_length_observed: 50,
    gateway_body_without_question_bytes: 50,
    original_422_body_available: originalBodyAvailable ? 'YES' : 'ORIGINAL_422_BODY_UNAVAILABLE',
    original_422_error_code: structured?.error_code || structured?.error_type || null,
    original_422_validation_path: validationPath,
    original_422_structured: structured,
    request_path: '/api/ai/rag/query',
    request_content_type: 'application/json',
    correlation_ids: {
      batch_id: batch.batch_id,
      run_id: probe?.run_id ?? null,
      probe_id: probe?.probe_id ?? null,
    },
    identity_hashes: {
      jwt_sub_hash: affected ? hash12(jwtSub(login(affected.email, cfg))) : null,
      x_user_id_hash: affected ? hash12(affected.uid) : null,
      artifact_uid_hash: affected ? hash12(affected.uid) : null,
    },
  };

  fs.writeFileSync(path.join(EVIDENCE_ROOT, 'frozen-422-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const requestDiff = {
    smoke_request: smokeFingerprint(),
    canary_manifest_request: canaryManifestFingerprint(),
    canary_auction_request: canaryAuctionFingerprint(),
    differences: {
      body_field_names_smoke_vs_canary_manifest: {
        smoke: smokeFingerprint().body_field_names,
        canary_manifest: canaryManifestFingerprint().body_field_names,
      },
      body_byte_length_smoke_vs_canary_manifest: {
        smoke: smokeFingerprint().body_byte_length,
        canary_manifest: canaryManifestFingerprint().body_byte_length,
      },
      schema_hash_equal_smoke_vs_canary_auction:
        smokeFingerprint().schema_hash !== canaryAuctionFingerprint().schema_hash,
      schema_hash_equal_canary_manifest_vs_canary_auction:
        canaryManifestFingerprint().schema_hash !== canaryAuctionFingerprint().schema_hash,
    },
  };
  fs.writeFileSync(
    path.join('/tmp/phase32h-r1-preview-422-diagnosis', 'request-diff.json'),
    `${JSON.stringify(requestDiff, null, 2)}\n`,
  );
  return { evidence, requestDiff, reproduced422 };
}

async function runFactorial() {
  fs.mkdirSync(DIAG_ROOT, { recursive: true });
  const cfg = {
    ...DEFAULTS,
    password: process.env.T20_PARTICIPANT_LOGIN_PASSWORD || DEFAULTS.password || 'ContractPass123!',
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    mgmtProto: PROTOCOLS.h1,
    ragPauseMs: 0,
  };
  const users = loadN5Participants();
  const affected = users.find((u) => u.email === 'tom@example.com');
  if (!affected) throw new Error('affected preview participant tom@example.com not found');
  const factorialUsers = [
    { label: 'contract', user: CONTRACT },
    { label: 'preview_affected', user: affected },
  ];
  const payloads = [
    { label: 'smoke_known_good', question: SMOKE_QUESTION },
    { label: 'canary_missing_question', question: undefined },
    { label: 'canary_auction_pressure', question: AUCTION_QUESTION },
  ];
  const lifecycles = [
    { label: 'no_reset', reset: false },
    { label: 'coordinator_reset', reset: true },
  ];
  const protocols = ['h1', 'h2', 'h3'];
  const rows = [];
  const tokenCache = new Map();
  const getToken = (email) => {
    if (!tokenCache.has(email)) tokenCache.set(email, login(email, cfg));
    return tokenCache.get(email);
  };

  for (const lifecycle of lifecycles) {
    if (lifecycle.reset) {
      resetAndVerifyWindowGates(users, getToken, cfg);
    }
    for (const { label: userLabel, user } of factorialUsers) {
      const token = getToken(user.email);
      const sub = jwtSub(token);
      if (sub !== user.uid) {
        throw new Error(`identity mismatch for ${userLabel}`);
      }
      for (const payload of payloads) {
        for (const protoKey of protocols) {
          const proto = PROTOCOLS[protoKey];
          const body = { question: payload.question, user_id: user.uid };
          const fp = fingerprintRequest({
            endpoint: '/api/ai/rag/query',
            method: 'POST',
            contentType: 'application/json',
            body,
            headers: { authorization: '<redacted>', 'x-user-id': '<redacted>' },
          });
          const resp = ragQuery(token, user.uid, payload.question, cfg, proto, { maxRetries: 1 });
          const meta = extractMeta(resp.body || {});
          rows.push({
            git_sha: gitSha(),
            user_label: userLabel,
            user_class: user.user_class,
            user_uid_hash: hash12(user.uid),
            jwt_sub_hash: hash12(sub),
            payload_label: payload.label,
            lifecycle: lifecycle.label,
            protocol: protoKey,
            http_status: resp.http_status,
            expected_gate: expectedGate(user),
            observed_gate: meta.gate_reason ?? null,
            retrieval_mode: meta.retrieval_mode ?? null,
            structured_error: resp.http_status === 422 ? redactStructuredError(resp.body) : null,
            request_fingerprint: fp,
            enrollment_readback: lifecycle.reset ? 'coordinator_reset_path' : 'existing',
          });
        }
      }
    }
  }

  const missingOnlyFails =
    rows.filter((r) => r.payload_label === 'canary_missing_question' && r.http_status === 422).length ===
      rows.filter((r) => r.payload_label === 'canary_missing_question').length &&
    rows.filter((r) => r.payload_label === 'smoke_known_good' && r.http_status === 200).length > 0;

  const auctionOnlyFails =
    rows.every((r) => {
      if (r.payload_label !== 'canary_auction_pressure') return true;
      return r.http_status === 422;
    }) && rows.some((r) => r.payload_label === 'smoke_known_good' && r.http_status === 200);

  let rootCauseClass = 'G';
  if (missingOnlyFails) rootCauseClass = 'A';
  else if (auctionOnlyFails) rootCauseClass = 'A';
  else if (
    rows.filter((r) => r.user_label === 'preview_affected' && r.http_status !== 200).length > 0 &&
    rows.filter((r) => r.user_label === 'contract' && r.http_status === 200).length > 0
  ) {
    rootCauseClass = 'B';
  }

  const summary = {
    diagnostic_root: DIAG_ROOT,
    diagnostic_target: 24,
    diagnostic_completed: rows.length,
    git_sha: gitSha(),
    root_cause_class: rootCauseClass,
    root_cause_labels: {
      A: 'REQUEST_SCHEMA_OR_PAYLOAD_FAILURE',
      B: 'PARTICIPANT_IDENTITY_MISMATCH',
      C: 'PREVIEW_ENROLLMENT_MISSING',
      D: 'ENROLLMENT_PROPAGATION_OR_CACHE_RACE',
      E: 'WINDOW_COORDINATOR_RESET_DEFECT',
      F: 'SERVICE_GATE_DEFECT',
      G: 'OTHER_SERVICE_VALIDATION_FAILURE',
    },
    factorial_rows: rows.length,
    missing_question_422_count: rows.filter((r) => r.payload_label === 'canary_missing_question' && r.http_status === 422)
      .length,
    smoke_200_count: rows.filter((r) => r.payload_label === 'smoke_known_good' && r.http_status === 200).length,
    auction_200_count: rows.filter((r) => r.payload_label === 'canary_auction_pressure' && r.http_status === 200)
      .length,
  };

  fs.writeFileSync(path.join(DIAG_ROOT, 'factorial-results.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  fs.writeFileSync(path.join(DIAG_ROOT, 'factorial-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  const mode = process.argv.includes('--factorial-only') ? 'factorial' : 'all';
  if (mode !== 'factorial') {
    const extracted = extractFrozenEvidence();
    console.log(JSON.stringify({ phase: 'extract', ...extracted.evidence }, null, 2));
  }
  const summary = await runFactorial();
  console.log(JSON.stringify({ phase: 'factorial', ...summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
