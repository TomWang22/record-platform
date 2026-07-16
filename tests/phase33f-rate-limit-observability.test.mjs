/**
 * Phase 33F HTTP status / rate-limit observability unit tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyHttpError,
  assertInterBatchInterval,
  INTER_BATCH_INTERVAL_MIN_MS,
  INTER_BATCH_INTERVAL_MS,
  EDGE_RATE_LIMITED,
  parseRetryAfterMs,
} from '../scripts/lib/phase33f-rate-limit.mjs';
import { issueCapabilityProbe } from '../scripts/lib/phase33f-capability-probe.mjs';

test('plaintext 429 preserves HTTP status and EDGE_RATE_LIMITED class', () => {
  const row = {
    probe_id: 'p1',
    batch_id: 'b1',
    capability: 'embeddings',
    protocol: 'h1',
    schema_version: 't',
    principal_fixture: 'a',
    authorization_scopes: [],
    prohibited_scopes: [],
    seed: 1,
    request: { mode: 'baseline' },
  };
  const result = issueCapabilityProbe(row, {
    skipLogin: true,
    executeCurl: () => ({
      http_status: 429,
      http_version: '1.1',
      version_ok: true,
      curl_time_total_ms: 12,
      headers: {
        'retry-after': '52',
        'ratelimit-limit': '300',
        'ratelimit-remaining': '0',
      },
      body: { _non_json: true, _body_prefix: 'Too many requests, please try again later.' },
      body_format: 'PLAINTEXT',
      json_parse_status: 'NOT_JSON',
      body_raw_prefix: 'Too many requests, please try again later.',
    }),
  });
  assert.equal(result.http_status, 429);
  assert.equal(result.error_class, EDGE_RATE_LIMITED);
  assert.equal(result.body_format, 'PLAINTEXT');
  assert.equal(result.json_parse_status, 'NOT_JSON');
  assert.equal(result.retries, 0);
  assert.equal(result.ok, false);
  assert.equal(result.retry_after_ms, 52000);
});

test('malformed JSON body still preserves HTTP status via curl result', () => {
  const row = {
    probe_id: 'p2',
    batch_id: 'b2',
    capability: 'scarcity',
    protocol: 'h2',
    schema_version: 't',
    principal_fixture: 'a',
    authorization_scopes: [],
    prohibited_scopes: [],
    seed: 2,
    request: { mode: 'baseline' },
  };
  const result = issueCapabilityProbe(row, {
    executeCurl: () => ({
      http_status: 200,
      http_version: '2',
      version_ok: true,
      curl_time_total_ms: 10,
      headers: { 'content-type': 'text/plain' },
      body: { _non_json: true, _body_prefix: 'not-json' },
      body_format: 'PLAINTEXT',
      json_parse_status: 'NOT_JSON',
      body_raw_prefix: 'not-json',
    }),
  });
  assert.equal(result.http_status, 200);
  assert.equal(result.json_parse_status, 'NOT_JSON');
});

test('JSON error body remains parseable object', () => {
  const row = {
    probe_id: 'p3',
    batch_id: 'b3',
    capability: 'valuation',
    protocol: 'h1',
    schema_version: 't',
    principal_fixture: 'a',
    authorization_scopes: [],
    prohibited_scopes: [],
    seed: 3,
    request: { mode: 'baseline' },
  };
  const result = issueCapabilityProbe(row, {
    executeCurl: () => ({
      http_status: 400,
      http_version: '1.1',
      version_ok: true,
      curl_time_total_ms: 8,
      headers: { 'content-type': 'application/json' },
      body: { error: 'bad_request', code: 'REQUEST_SCHEMA_INVALID' },
      body_format: 'JSON',
      json_parse_status: 'OK',
    }),
  });
  assert.equal(result.http_status, 400);
  assert.equal(result.body.code, 'REQUEST_SCHEMA_INVALID');
  assert.equal(result.body_format, 'JSON');
});

test('Retry-After parsed safely from headers', () => {
  assert.equal(parseRetryAfterMs({ 'retry-after': '10' }), 10000);
  assert.equal(parseRetryAfterMs({}), null);
  const cls = classifyHttpError({
    http_status: 429,
    body_format: 'PLAINTEXT',
    headers: { 'retry-after': '3' },
  });
  assert.equal(cls.error_code, EDGE_RATE_LIMITED);
  assert.equal(cls.retry_count, 0);
  assert.equal(cls.retry_after_ms, 3000);
});

test('status capture does not require response JSON', () => {
  const cls = classifyHttpError({
    http_status: 429,
    body_format: 'PLAINTEXT',
    headers: {},
  });
  assert.equal(cls.http_status, 429);
  assert.notEqual(cls.http_status, null);
});

test('invalid inter-batch interval blocks launch policy', () => {
  assert.equal(assertInterBatchInterval(INTER_BATCH_INTERVAL_MS), INTER_BATCH_INTERVAL_MS);
  assert.throws(() => assertInterBatchInterval(INTER_BATCH_INTERVAL_MIN_MS - 1), /below approved minimum/);
});

test('curl failure path retains http_status when present on error', () => {
  const row = {
    probe_id: 'p4',
    batch_id: 'b4',
    capability: 'embeddings',
    protocol: 'h3',
    schema_version: 't',
    principal_fixture: 'a',
    authorization_scopes: [],
    prohibited_scopes: [],
    seed: 4,
    request: { mode: 'baseline' },
  };
  const result = issueCapabilityProbe(row, {
    executeCurl: () => {
      const err = new Error('curl failed: boom');
      err.curl_exit_code = 1;
      err.curl_error_class = 'curl_exit';
      err.http_status = 429;
      err.body_format = 'PLAINTEXT';
      err.json_parse_status = 'NOT_JSON';
      err.headers = { 'retry-after': '1' };
      throw err;
    },
  });
  assert.equal(result.http_status, 429);
  assert.equal(result.error_class, EDGE_RATE_LIMITED);
  assert.equal(result.ok, false);
});
