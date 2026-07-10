import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzePhase32LatencyRca,
  completionGapMs,
  groupPercentiles,
  jsonlAttributionLimits,
  maxLatencyAttribution,
  parseMonitorEvents,
  topOutliers,
} from '../scripts/lib/phase32-latency-rca-analyzer.mjs';

describe('phase32 latency rca analyzer', () => {
  it('documents JSONL attribution limits', () => {
    const limits = jsonlAttributionLimits();
    assert.equal(limits.latency_field, 'rag_total_ms');
    assert.match(limits.includes_retry_delay, /unknown/i);
    assert.match(limits.includes_coordinator_wait, /unknown/i);
  });

  it('computes grouped percentiles', () => {
    const rows = [
      { protocol_label: 'HTTP/1.1', case_id: 'a', window: 1, user_class: 'real_participant', rag_total_ms: 100 },
      { protocol_label: 'HTTP/1.1', case_id: 'a', window: 1, user_class: 'real_participant', rag_total_ms: 300 },
      { protocol_label: 'HTTP/2', case_id: 'b', window: 2, user_class: 'contract_control', rag_total_ms: 200 },
    ];
    const byProto = groupPercentiles(rows, (r) => r.protocol_label, 'protocol');
    assert.equal(byProto.length, 2);
    assert.equal(byProto.find((r) => r.protocol === 'HTTP/1.1').count, 2);
  });

  it('ranks top outliers with provenance', () => {
    const rows = [
      { row: { probe_id: 'p1', rag_total_ms: 50, protocol_label: 'HTTP/1.1', case_id: 'x', window: 1, run: 1, user_class: 'real_participant' }, shardDir: '/tmp/shard-h1' },
      { row: { probe_id: 'p2', rag_total_ms: 5000, protocol_label: 'HTTP/2', case_id: 'y', window: 2, run: 1, user_class: 'contract_control' }, shardDir: '/tmp/shard-h2' },
    ];
    const outliers = topOutliers(rows, 10);
    assert.equal(outliers[0].probe_id, 'p2');
    assert.equal(outliers[0].rag_total_ms, 5000);
  });

  it('marks max row as rag_total_ms not curl', () => {
    const row = { probe_id: 'max', rag_total_ms: 1_037_645.8, protocol_label: 'HTTP/1.1' };
    const prov = maxLatencyAttribution(row);
    assert.equal(prov.attribution.max_is_rag_total_ms, true);
    assert.equal(prov.attribution.max_is_curl_time_total, false);
  });

  it('parses monitor restart and lock events', () => {
    const text = [
      '===== h1 runner stopped; inspecting log before restart =====',
      'Error: ENOENT window-coordinator/lock/meta.json',
      '===== restarting h1 with --resume =====',
    ].join('\n');
    const events = parseMonitorEvents(text);
    assert.ok(events.some((e) => e.type === 'shard_restart'));
    assert.ok(events.some((e) => e.type === 'coordinator_lock_error'));
  });

  it('computes completion gaps', () => {
    const gap = completionGapMs('2026-07-10T12:00:00.000Z', '2026-07-10T12:17:17.645Z');
    assert.ok(gap > 1_000_000);
  });

  it('writes analyzer outputs under /tmp out dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32-rca-'));
    const matrixIn = path.join(tmp, 'matrix');
    const shard = path.join(matrixIn, 'shard-h1');
    fs.mkdirSync(shard, { recursive: true });
    const row = {
      probe_id: 'p1',
      matrix_protocol: 'h1',
      protocol_label: 'HTTP/1.1',
      case_id: 'final_tagged_plan',
      window: 13,
      run: 3,
      user_uid_hash: 'u1',
      user_class: 'real_participant',
      rag_total_ms: 1037645.8,
      gate_reason: 'preview_opt_in',
      http_status: 200,
      completed_at: '2026-07-10T12:17:17.645Z',
    };
    fs.writeFileSync(path.join(shard, 'phase31-matrix.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
    fs.writeFileSync(
      path.join(matrixIn, 'phase31-monitor.log'),
      '===== restarting h1 with --resume =====\n',
      'utf8',
    );
    const outDir = path.join(tmp, 'out');
    const { report, files } = analyzePhase32LatencyRca({ matrixIn, outDir, topN: 5 });
    assert.equal(report.row_count, 1);
    assert.equal(report.latency_rca_status, 'CLASSIFIED');
    assert.equal(report.max_outlier_explained_from_jsonl, false);
    assert.ok(fs.existsSync(files.summary));
    assert.ok(fs.existsSync(files.top_outliers));
  });
});
