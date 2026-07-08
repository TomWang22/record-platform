/**
 * Phase 28D/E — controlled observability matrix summary and latency tables.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MATRIX_EVIDENCE_LABEL =
  'Phase 28 controlled observability production-readiness matrix: 25920/25920 target';

export const MATRIX_TARGET = {
  total: 25920,
  perProtocol: 8640,
  windows: 16,
  users: 6,
  runs: 10,
  cases: 9,
};

export const FORBIDDEN_FIELDS = [
  'response_body',
  'raw_response_body',
  'message_body',
  'raw_message_body',
  'jwt',
  'token',
  'password',
  'proxy_max_bid',
  'private_message',
  'authorization_header',
];

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function assertRedactedRow(row) {
  const text = JSON.stringify(row).toLowerCase();
  for (const field of FORBIDDEN_FIELDS) {
    if (text.includes(`"${field}"`)) {
      throw new Error(`forbidden field in matrix row: ${field}`);
    }
  }
  if (/\beyj[a-z0-9]/i.test(text)) {
    throw new Error('jwt-like token detected in matrix row');
  }
}

export function protocolLabel(httpVersion) {
  if (httpVersion === '1.1') return 'HTTP/1.1';
  if (httpVersion === '2') return 'HTTP/2';
  if (httpVersion === '3') return 'HTTP/3';
  return 'unknown';
}

export function summarizeMatrixRows(rows, { targetPerProtocol = MATRIX_TARGET.perProtocol } = {}) {
  const byProtocol = {};
  const byCase = {};
  const byGate = {};
  let http200 = 0;
  let fallback = 0;
  let wrongProtocol = 0;
  let wrongGate = 0;
  let keywordDefault = 0;
  let responsePass = 0;
  let sentimentRequired = 0;
  let sentimentPass = 0;
  let redTeamTotal = 0;
  let redTeamPass = 0;
  let leakageFailures = 0;

  for (const row of rows) {
    assertRedactedRow(row);
    const proto = row.protocol_label || protocolLabel(row.http_version);
    if (!byProtocol[proto]) {
      byProtocol[proto] = {
        protocol: proto,
        count: 0,
        http200: 0,
        latencies: [],
        fallback: 0,
        wrong_protocol: 0,
        wrong_gate: 0,
      };
    }
    const bucket = byProtocol[proto];
    bucket.count += 1;
    if (row.http_status === 200) {
      http200 += 1;
      bucket.http200 += 1;
    }
    fallback += row.fallback_count || 0;
    bucket.fallback += row.fallback_count || 0;
    if (!row.version_ok) {
      wrongProtocol += 1;
      bucket.wrong_protocol += 1;
    }
    if (row.gate_reason !== row.expected_gate_reason) {
      wrongGate += 1;
      bucket.wrong_gate += 1;
    }
    if (row.gate_reason === 'keyword_default') keywordDefault += 1;
    if (row.response_pass === 'PASS') responsePass += 1;
    if (row.sentiment_required) {
      sentimentRequired += 1;
      if (row.sentiment_pass === 'PASS') sentimentPass += 1;
    }
    if (row.red_team_case) {
      redTeamTotal += 1;
      if (row.response_pass === 'PASS' && row.leakage_pass === 'PASS') redTeamPass += 1;
    }
    if (row.leakage_pass === 'FAIL') leakageFailures += 1;
    if (typeof row.rag_total_ms === 'number') bucket.latencies.push(row.rag_total_ms);

    const caseId = row.case_id;
    if (!byCase[caseId]) {
      byCase[caseId] = { case_id: caseId, h1: [], h2: [], h3: [], response_pass: 0, total: 0, sentiment_pass: 0, sentiment_required: 0, leakage_failures: 0 };
    }
    const caseBucket = byCase[caseId];
    caseBucket.total += 1;
    if (row.response_pass === 'PASS') caseBucket.response_pass += 1;
    if (row.sentiment_required) {
      caseBucket.sentiment_required += 1;
      if (row.sentiment_pass === 'PASS') caseBucket.sentiment_pass += 1;
    }
    if (row.leakage_pass === 'FAIL') caseBucket.leakage_failures += 1;
    if (proto === 'HTTP/1.1' && typeof row.rag_total_ms === 'number') caseBucket.h1.push(row.rag_total_ms);
    if (proto === 'HTTP/2' && typeof row.rag_total_ms === 'number') caseBucket.h2.push(row.rag_total_ms);
    if (proto === 'HTTP/3' && typeof row.rag_total_ms === 'number') caseBucket.h3.push(row.rag_total_ms);

    const gateKey = `${row.gate_reason || 'unknown'}|${proto}`;
    if (!byGate[gateKey]) {
      byGate[gateKey] = {
        gate_reason: row.gate_reason,
        protocol: proto,
        count: 0,
        latencies: [],
        fallback_count: 0,
      };
    }
    byGate[gateKey].count += 1;
    if (typeof row.rag_total_ms === 'number') byGate[gateKey].latencies.push(row.rag_total_ms);
    byGate[gateKey].fallback_count += row.fallback_count || 0;
  }

  const latencyByProtocol = Object.values(byProtocol).map((bucket) => ({
    protocol: bucket.protocol,
    count: bucket.count,
    http200: bucket.http200,
    p50: percentile(bucket.latencies, 50),
    p90: percentile(bucket.latencies, 90),
    p95: percentile(bucket.latencies, 95),
    p99: percentile(bucket.latencies, 99),
    max: bucket.latencies.length ? Math.max(...bucket.latencies) : null,
    fallback: bucket.fallback,
    wrong_protocol: bucket.wrong_protocol,
    wrong_gate: bucket.wrong_gate,
  }));

  const latencyByCase = Object.values(byCase).map((bucket) => ({
    case_id: bucket.case_id,
    h1_p50: percentile(bucket.h1, 50),
    h1_p95: percentile(bucket.h1, 95),
    h2_p50: percentile(bucket.h2, 50),
    h2_p95: percentile(bucket.h2, 95),
    h3_p50: percentile(bucket.h3, 50),
    h3_p95: percentile(bucket.h3, 95),
    response_pass_rate: bucket.total ? bucket.response_pass / bucket.total : null,
    sentiment_pass_rate: bucket.sentiment_required ? bucket.sentiment_pass / bucket.sentiment_required : null,
    leakage_failures: bucket.leakage_failures,
  }));

  const latencyByGate = Object.values(byGate).map((bucket) => ({
    gate_reason: bucket.gate_reason,
    protocol: bucket.protocol,
    count: bucket.count,
    p50: percentile(bucket.latencies, 50),
    p95: percentile(bucket.latencies, 95),
    fallback_count: bucket.fallback_count,
  }));

  const perProtocolCounts = Object.fromEntries(
    latencyByProtocol.map((row) => [row.protocol, row.count]),
  );
  const complete =
    rows.length === MATRIX_TARGET.total &&
    perProtocolCounts['HTTP/1.1'] === targetPerProtocol &&
    perProtocolCounts['HTTP/2'] === targetPerProtocol &&
    perProtocolCounts['HTTP/3'] === targetPerProtocol &&
    http200 === rows.length &&
    fallback === 0 &&
    wrongProtocol === 0 &&
    wrongGate === 0 &&
    keywordDefault === 0 &&
    leakageFailures === 0 &&
    responsePass === rows.length &&
    (sentimentRequired === 0 || sentimentPass === sentimentRequired) &&
    (redTeamTotal === 0 || redTeamPass === redTeamTotal);

  return {
    evidence_label: MATRIX_EVIDENCE_LABEL,
    matrix_total: `${rows.length}/${MATRIX_TARGET.total}`,
    http200,
    fallback_count: fallback,
    wrong_protocol_count: wrongProtocol,
    wrong_gate_count: wrongGate,
    keyword_default_during_matrix: keywordDefault,
    response_pass_rate: rows.length ? responsePass / rows.length : 0,
    sentiment_pass_rate: sentimentRequired ? sentimentPass / sentimentRequired : null,
    red_team_safety_pass_rate: redTeamTotal ? redTeamPass / redTeamTotal : null,
    leakage_failures: leakageFailures,
    latency_by_protocol: latencyByProtocol,
    latency_by_case: latencyByCase,
    latency_by_gate: latencyByGate,
    per_protocol_counts: perProtocolCounts,
    status: complete ? 'PASS' : rows.length < MATRIX_TARGET.total ? 'IN_PROGRESS' : 'BLOCKED',
  };
}

export function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function writeMatrixArtifacts(outDir, rows, extra = {}) {
  const summary = summarizeMatrixRows(rows);
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    'phase28-summary.json': { ...summary, ...extra, generated_at: new Date().toISOString() },
    'phase28-latency-by-protocol.json': summary.latency_by_protocol,
    'phase28-latency-by-case.json': summary.latency_by_case,
  };
  for (const [name, payload] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return summary;
}
