#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDeterministicHttpStatus,
  isTransientHttpStatus,
  probeAttemptDelayMs,
  shouldRetryProbeResponse,
  shouldRetryRagQuery,
  classifyHttp422RootCause,
} from '../scripts/lib/http-retry-policy.mjs';

describe('http retry policy', () => {
  it('422 is deterministic and not retried', () => {
    assert.equal(isDeterministicHttpStatus(422), true);
    assert.equal(shouldRetryRagQuery(422), false);
    assert.equal(
      shouldRetryProbeResponse({ http_status: 422, retrieval_mode: null, attempt: 0, maxAttempts: 16 }),
      false,
    );
  });

  it('502/503/504 remain retryable', () => {
    for (const status of [502, 503, 504]) {
      assert.equal(isTransientHttpStatus(status), true);
      assert.equal(shouldRetryRagQuery(status), true);
      assert.equal(
        shouldRetryProbeResponse({ http_status: status, retrieval_mode: null, attempt: 0, maxAttempts: 16 }),
        true,
      );
    }
  });

  it('429 obeys bounded backoff helper', () => {
    const delay = probeAttemptDelayMs(3, 429);
    assert.ok(delay <= 8000);
    assert.ok(delay > 0);
  });

  it('classifies structured 422 errors', () => {
    assert.equal(classifyHttp422RootCause({ error_code: 'validation_error' }), 'REQUEST_SCHEMA_422');
    assert.equal(classifyHttp422RootCause({ detail: 'preview enrollment missing' }), 'PREVIEW_ENROLLMENT_MISSING_422');
  });
});
