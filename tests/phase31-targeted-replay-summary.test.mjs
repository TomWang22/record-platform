#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTargetedReplayManifest } from '../scripts/phase31-build-targeted-replay-manifest.mjs';
import {
  TARGETED_REPLAY_TOTAL,
  TARGETED_REPLAY_PER_PROTOCOL,
  AFFECTED_USER_UID_HASH,
} from '../scripts/lib/phase31-targeted-replay-config.mjs';
import {
  gateChecks,
  summarizeTargetedReplay,
  compactTargetedSummary,
} from '../scripts/lib/phase31-targeted-replay-summary.mjs';

describe('phase31 targeted replay summary', () => {
  it('manifest totals 3672 probes across three protocols', () => {
    const rows = buildTargetedReplayManifest();
    assert.equal(rows.length, TARGETED_REPLAY_TOTAL);
    assert.equal(rows.length / 3, TARGETED_REPLAY_PER_PROTOCOL);
    const h1 = rows.filter((r) => r.matrix_protocol === 'h1').length;
    assert.equal(h1, TARGETED_REPLAY_PER_PROTOCOL);
  });

  it('PASS requires clean gates for preview and contract rows', () => {
    const rows = buildTargetedReplayManifest().slice(0, 4).map((r, i) => ({
      ...r,
      user_uid_hash: r.role === 'allowlist' ? 'f1cee31f7599' : AFFECTED_USER_UID_HASH,
      http_status: 200,
      version_ok: true,
      gate_reason: r.expected_gate_reason,
      response_pass: 'PASS',
      sentiment_pass: 'PASS',
      leakage_pass: 'PASS',
      fallback_count: 0,
      rag_total_ms: 100 + i,
      red_team_case: false,
      sentiment_required: r.case_id === 'buyer_psychology',
    }));
    const gates = gateChecks(rows);
    assert.equal(gates.preview_keyword_default_observed, 0);
    assert.equal(gates.contract_allowlist_observed, gates.contract_rows);
  });

  it('keyword_default on preview rows blocks targeted PASS', () => {
    const base = buildTargetedReplayManifest()[0];
    const rows = [
      {
        ...base,
        user_uid_hash: AFFECTED_USER_UID_HASH,
        expected_gate_reason: 'preview_opt_in',
        gate_reason: 'keyword_default',
        http_status: 200,
        version_ok: true,
        response_pass: 'PASS',
        sentiment_pass: 'PASS',
        leakage_pass: 'PASS',
        fallback_count: 0,
        rag_total_ms: 50,
      },
    ];
    const summary = summarizeTargetedReplay(rows);
    assert.equal(summary.status, 'IN_PROGRESS');
    assert.equal(summary.gate_checks.preview_keyword_default_observed, 1);
  });

  it('compact summary exposes numeric total for monitor JSON', () => {
    const compact = compactTargetedSummary({
      matrix_total: '100/3672',
      targeted_replay_total: '100/3672',
      status: 'IN_PROGRESS',
      per_protocol_counts: {},
      latency_by_protocol: [],
      fallback_count: 0,
      wrong_protocol_count: 0,
      wrong_gate_count: 0,
      response_pass_rate: 1,
      sentiment_pass_rate: 1,
      red_team_safety_pass_rate: 1,
      leakage_failures: 0,
    });
    assert.equal(compact.total, 100);
    assert.equal(compact.target, 3672);
  });

  it('runner and manifest modules import without executing CLI main', async () => {
    const manifestMod = await import('../scripts/phase31-build-targeted-replay-manifest.mjs');
    const runnerMod = await import('../scripts/phase31-targeted-preview-lifecycle-replay.mjs');
    assert.equal(typeof manifestMod.buildTargetedReplayManifest, 'function');
    assert.equal(typeof runnerMod.runTargetedReplay, 'function');
    assert.equal(typeof runnerMod.loadManifestForProtocol, 'function');
  });

  it('loadManifestForProtocol rejects missing manifest file', async () => {
    const { loadManifestForProtocol } = await import('../scripts/phase31-targeted-preview-lifecycle-replay.mjs');
    assert.throws(
      () => loadManifestForProtocol('/tmp/does-not-exist-phase31m-manifest.jsonl', 'h1'),
      /manifest not found/,
    );
  });
});
