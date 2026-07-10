/**
 * Phase 31M — merge targeted replay shards and emit summary artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AFFECTED_USER_UID_HASH,
  DEFAULT_OUT,
  TARGETED_EVIDENCE_LABEL,
  TARGETED_REPLAY_PER_PROTOCOL,
  TARGETED_REPLAY_TOTAL,
} from './phase31-targeted-replay-config.mjs';
import {
  loadJsonl,
  percentile,
  protocolLabel,
  summarizeMatrixRows,
} from './phase31-controlled-matrix-summary.mjs';

export function loadTargetedShardRows(inDir) {
  const rows = [];
  const shardNames = ['shard-h1', 'shard-h2', 'shard-h3'];
  for (const name of shardNames) {
    const jsonl = path.join(inDir, name, 'phase31m-matrix.jsonl');
    if (fs.existsSync(jsonl)) rows.push(...loadJsonl(jsonl));
  }
  const retryPath = path.join(inDir, 'phase31m-retry-failures.jsonl');
  if (fs.existsSync(retryPath)) {
    const byKey = new Map(
      rows.map((r) => [
        [r.matrix_protocol, r.window, r.run, r.case_id, r.user_uid_hash].join('|'),
        r,
      ]),
    );
    for (const row of loadJsonl(retryPath)) {
      const key = [row.matrix_protocol, row.window, row.run, row.case_id, row.user_uid_hash].join('|');
      byKey.set(key, { ...row, retry_override: true });
    }
    return [...byKey.values()].sort((a, b) => a.probe_id - b.probe_id);
  }
  return rows.sort((a, b) => a.probe_id - b.probe_id);
}

export function gateChecks(rows) {
  const previewRows = rows.filter(
    (r) =>
      r.user_uid_hash === AFFECTED_USER_UID_HASH && r.expected_gate_reason === 'preview_opt_in',
  );
  const contractRows = rows.filter((r) => r.expected_gate_reason === 'allowlist');
  const previewKeywordDefault = previewRows.filter((r) => r.gate_reason === 'keyword_default').length;
  const previewOptIn = previewRows.filter((r) => r.gate_reason === 'preview_opt_in').length;
  const contractAllowlist = contractRows.filter((r) => r.gate_reason === 'allowlist').length;
  return {
    preview_rows: previewRows.length,
    preview_opt_in_observed: previewOptIn,
    preview_keyword_default_observed: previewKeywordDefault,
    contract_rows: contractRows.length,
    contract_allowlist_observed: contractAllowlist,
  };
}

export function summarizeTargetedReplay(rows) {
  const summary = summarizeMatrixRows(rows, {
    targetPerProtocol: TARGETED_REPLAY_PER_PROTOCOL,
    targetTotal: TARGETED_REPLAY_TOTAL,
    evidenceLabel: TARGETED_EVIDENCE_LABEL,
  });
  const gates = gateChecks(rows);
  const pass =
    summary.status === 'PASS' &&
    gates.preview_keyword_default_observed === 0 &&
    gates.preview_opt_in_observed === gates.preview_rows &&
    gates.contract_allowlist_observed === gates.contract_rows;

  return {
    ...summary,
    status: pass ? 'PASS' : rows.length < TARGETED_REPLAY_TOTAL ? 'IN_PROGRESS' : 'BLOCKED',
    gate_checks: gates,
    targeted_replay_total: `${rows.length}/${TARGETED_REPLAY_TOTAL}`,
  };
}

export function writeTargetedReplayArtifacts(outDir, rows, extra = {}) {
  const summary = summarizeTargetedReplay(rows);
  fs.mkdirSync(outDir, { recursive: true });
  const outliers = [...rows]
    .filter((r) => typeof r.rag_total_ms === 'number')
    .sort((a, b) => b.rag_total_ms - a.rag_total_ms)
    .slice(0, 20);
  const files = {
    'phase31m-summary.json': { ...summary, ...extra, generated_at: new Date().toISOString() },
    'phase31m-latency-by-protocol.json': summary.latency_by_protocol,
    'phase31m-latency-by-case.json': summary.latency_by_case,
    'phase31m-latency-by-gate.json': summary.latency_by_gate,
    'phase31m-latency-by-user-class.json': summary.latency_by_user_class,
    'phase31m-latency-outliers-top20.json': outliers,
  };
  for (const [name, payload] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return summary;
}

export function compactTargetedSummary(summary) {
  const per = summary.per_protocol_counts || {};
  const lat = Object.fromEntries((summary.latency_by_protocol || []).map((r) => [r.protocol, r]));
  const fmt = (p) => {
    const x = lat[p];
    return x ? `${x.p50}/${x.p95}/${x.p99}/${x.max}` : 'n/a';
  };
  const totalParts = (summary.targeted_replay_total || summary.matrix_total || '0/0').split('/');
  return {
    total: Number(totalParts[0] || 0),
    target: Number(totalParts[1] || 0),
    status: summary.status,
    h1: per['HTTP/1.1'],
    h2: per['HTTP/2'],
    h3: per['HTTP/3'],
    fallback: summary.fallback_count,
    wrong_protocol: summary.wrong_protocol_count,
    wrong_gate: summary.wrong_gate_count,
    response_pass_rate: summary.response_pass_rate,
    sentiment_pass_rate: summary.sentiment_pass_rate,
    red_team_safety_pass_rate: summary.red_team_safety_pass_rate,
    leakage_failures: summary.leakage_failures,
    gate_checks: summary.gate_checks,
    latency_h1: fmt('HTTP/1.1'),
    latency_h2: fmt('HTTP/2'),
    latency_h3: fmt('HTTP/3'),
  };
}

export function mergeAndSummarize(inDir = DEFAULT_OUT, extra = {}) {
  const rows = loadTargetedShardRows(inDir);
  return writeTargetedReplayArtifacts(inDir, rows, extra);
}
