#!/usr/bin/env node
/**
 * Phase 28D-R — extract grouped failures from controlled matrix shard JSONL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonl, protocolLabel } from './lib/phase28-controlled-matrix-summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRANSIENT_HTTP = new Set([429, 502, 503, 504]);

function parseArgs(argv) {
  const opts = { in: '/tmp/phase28-controlled-observability-matrix', out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
  }
  if (!opts.out) opts.out = path.join(opts.in, 'phase28-failure-triage.json');
  return opts;
}

function loadAllShardRows(inDir) {
  const rows = [];
  const shardDirs = [];
  const shardNames = ['shard-h1', 'shard-h2', 'shard-h3'];
  const hasShards = shardNames.some((name) =>
    fs.existsSync(path.join(inDir, name, 'phase28-matrix.jsonl')),
  );
  const dirs = hasShards ? shardNames.map((n) => path.join(inDir, n)) : [inDir];
  for (const dir of dirs) {
    const jsonl = path.join(dir, 'phase28-matrix.jsonl');
    if (fs.existsSync(jsonl)) {
      shardDirs.push(dir);
      rows.push(...loadJsonl(jsonl));
    }
  }
  return { rows, shardDirs };
}

function probeKey(row) {
  return [
    row.matrix_protocol || row.protocol_label,
    row.user_uid_hash,
    row.window,
    row.run,
    row.case_id,
  ].join('|');
}

function classifyRetryable(row) {
  if (row.http_status !== 200) {
    return TRANSIENT_HTTP.has(row.http_status) ? 'retryable' : 'deterministic';
  }
  if (row.gate_reason !== row.expected_gate_reason) {
    if (row.gate_reason == null || row.gate_reason === undefined) {
      return row.http_status !== 200 ? 'retryable' : 'deterministic';
    }
    return 'deterministic';
  }
  if (row.response_pass !== 'PASS') return 'deterministic';
  if (row.leakage_pass === 'FAIL') return 'deterministic';
  return null;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return Object.fromEntries(map);
}

function summarizeRunnerLogs(inDir) {
  const logs = {};
  for (const proto of ['h1', 'h2', 'h3']) {
    const logPath = path.join(inDir, `runner-${proto}.log`);
    if (!fs.existsSync(logPath)) continue;
    const text = fs.readFileSync(logPath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const lastProgress = [...lines].reverse().find((l) => l.includes('phase28 matrix progress'));
    const errors = lines.filter((l) => /error|Error|SyntaxError|ECONN|Too many requests/i.test(l));
    const exited = !text.trim().endsWith('progress') && lines.length > 0;
    logs[`shard-${proto}`] = {
      log_path: logPath,
      line_count: lines.length,
      last_progress: lastProgress || null,
      error_lines: errors.slice(-5),
      likely_stall_or_exit: exited,
    };
  }
  return logs;
}

function buildTriage(inDir) {
  const { rows, shardDirs } = loadAllShardRows(inDir);
  const wrongGateRows = rows.filter(
    (r) => r.gate_reason !== r.expected_gate_reason && r.http_status === 200,
  );
  const wrongGateProxyRows = rows.filter((r) => r.gate_reason !== r.expected_gate_reason);
  const non200Rows = rows.filter((r) => r.http_status !== 200);
  const responseFailRows = rows.filter((r) => r.response_pass !== 'PASS');

  const wrongGate = groupBy(wrongGateRows.length ? wrongGateRows : wrongGateProxyRows, (r) =>
    [
      r.protocol_label || protocolLabel(r.http_version),
      r.user_uid_hash,
      r.window,
      r.run,
      r.case_id,
      r.expected_gate_reason,
      r.gate_reason ?? 'undefined',
    ].join('|'),
  );

  const non200 = groupBy(non200Rows, (r) =>
    [
      r.protocol_label || protocolLabel(r.http_version),
      r.http_status,
      r.user_uid_hash,
      r.window,
      r.run,
      r.case_id,
    ].join('|'),
  );

  const responseFail = groupBy(responseFailRows, (r) =>
    [
      r.protocol_label || protocolLabel(r.http_version),
      r.user_uid_hash,
      r.window,
      r.run,
      r.case_id,
      r.response_pass,
    ].join('|'),
  );

  const retryableFailures = [];
  const deterministicFailures = [];
  const failureProbes = new Map();

  for (const row of rows) {
    const kind = classifyRetryable(row);
    if (!kind) continue;
    const entry = {
      probe_id: row.probe_id,
      matrix_protocol: row.matrix_protocol,
      protocol_label: row.protocol_label,
      window: row.window,
      run: row.run,
      case_id: row.case_id,
      user_uid_hash: row.user_uid_hash,
      user_class: row.user_class,
      expected_gate_reason: row.expected_gate_reason,
      gate_reason: row.gate_reason,
      http_status: row.http_status,
      response_pass: row.response_pass,
      failure_class: kind,
      lifecycle_bug_suspect: false,
    };
    if (row.http_status === 200 && row.gate_reason !== row.expected_gate_reason) {
      entry.lifecycle_bug_suspect = true;
    }
    failureProbes.set(row.probe_id, entry);
    if (kind === 'retryable') retryableFailures.push(entry);
    else deterministicFailures.push(entry);
  }

  const byProtocolNon200 = { h1: 0, h2: 0, h3: 0 };
  for (const row of non200Rows) {
    const p = row.matrix_protocol || 'unknown';
    if (byProtocolNon200[p] != null) byProtocolNon200[p] += 1;
  }

  return {
    generated_at: new Date().toISOString(),
    input_dir: inDir,
    shard_dirs: shardDirs,
    matrix_total: rows.length,
    counts: {
      wrong_gate_rows: wrongGateProxyRows.length,
      wrong_gate_true_mismatch_http200: wrongGateRows.length,
      non_200_rows: non200Rows.length,
      non_200_by_protocol: byProtocolNon200,
      response_fail_rows: responseFailRows.length,
      retryable_failures: retryableFailures.length,
      deterministic_failures: deterministicFailures.length,
      lifecycle_bug_suspect: [...failureProbes.values()].filter((f) => f.lifecycle_bug_suspect).length,
    },
    wrong_gate_by_protocol_user_window_run_case: wrongGate,
    non_200_by_protocol_status_user_window_run_case: non200,
    response_fail_by_protocol_user_window_run_case: responseFail,
    retryable_failures: retryableFailures,
    deterministic_failures: deterministicFailures,
    failure_probes: [...failureProbes.values()],
    runner_logs: summarizeRunnerLogs(inDir),
    notes: [
      'wrong_gate with http_status!=200 and undefined gate_reason are gateway transient failures, not gate parser bugs',
      'do not reclassify wrong_gate as PASS without HTTP 200 and matching gate_reason in response payload',
    ],
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const triage = buildTriage(opts.in);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, `${JSON.stringify(triage, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(triage.counts, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}

export { buildTriage, loadAllShardRows, classifyRetryable };
