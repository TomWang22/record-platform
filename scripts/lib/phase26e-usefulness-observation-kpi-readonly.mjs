/**
 * Phase 26E — usefulness KPI aggregation from ai_kpi_usefulness_observations (read-only).
 */

const PROTOCOL_LABELS = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function passRate(rows, field) {
  const values = rows.map((row) => row[field]).filter((value) => typeof value === 'boolean');
  if (!values.length) return null;
  const passed = values.filter(Boolean).length;
  return passed / values.length;
}

function emptyByProtocol() {
  return Object.fromEntries(
    PROTOCOL_LABELS.map((protocol) => [protocol, { response_pass_rate: null, sample_count: 0 }]),
  );
}

function countByField(rows, field) {
  return rows.reduce((acc, row) => {
    const key = row[field] == null || row[field] === '' ? 'unknown' : String(row[field]);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildTimeSeries(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const observedAt = row.observed_at ? String(row.observed_at) : 'unknown';
    const day = observedAt.slice(0, 10);
    if (!buckets.has(day)) {
      buckets.set(day, []);
    }
    buckets.get(day).push(row);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bucketRows]) => ({
      day,
      sample_count: bucketRows.length,
      response_pass_rate: passRate(bucketRows, 'response_pass'),
      sentiment_pass_rate: passRate(bucketRows, 'sentiment_pass'),
      red_team_safety_pass_rate: passRate(bucketRows, 'red_team_safety_pass'),
    }));
}

export function summarizeUsefulnessKpiFromObservations(observationRows) {
  if (!Array.isArray(observationRows) || observationRows.length === 0) {
    return {
      status: 'GAP',
      source: 'uninstrumented_fallback',
      kpi_usefulness_observations_available: false,
      by_protocol: emptyByProtocol(),
      by_evidence_label: {},
      by_workflow: {},
      time_series: [],
      response_pass_rate: null,
      sentiment_pass_rate: null,
      red_team_safety_pass_rate: null,
      leakage_failures: 0,
      quality_score_avg: null,
      quality_score_worst: null,
      notes: [
        'No ai.ai_kpi_usefulness_observations rows available',
        'Usefulness/rubric pass rate only — not model accuracy without ground truth',
        '171315/171315 is labeled H1+H2+H3 only',
        'Phase 22C 7200/7200 is sample only',
        'Phase 22B 15/15 is smoke only',
      ],
    };
  }

  const byProtocol = emptyByProtocol();
  for (const protocol of PROTOCOL_LABELS) {
    const protocolRows = observationRows.filter((row) => row.protocol === protocol);
    byProtocol[protocol] = {
      response_pass_rate: passRate(protocolRows, 'response_pass'),
      sample_count: protocolRows.length,
    };
  }

  const protocolsWithSamples = PROTOCOL_LABELS.filter(
    (protocol) => byProtocol[protocol].sample_count > 0,
  );
  const evidenceLabels = new Set(
    observationRows.map((row) => row.evidence_label).filter((label) => label),
  );

  let status = 'PASS';
  if (!protocolsWithSamples.length && !evidenceLabels.size) {
    status = 'GAP';
  } else if (protocolsWithSamples.length < PROTOCOL_LABELS.length || evidenceLabels.size < 3) {
    status = 'PARTIAL';
  }

  const qualityScores = observationRows
    .map((row) => row.quality_score)
    .filter((score) => score != null && score !== '')
    .map((score) => toNumber(score));

  return {
    status,
    source: 'ai.ai_kpi_usefulness_observations',
    kpi_usefulness_observations_available: true,
    by_protocol: byProtocol,
    by_evidence_label: countByField(observationRows, 'evidence_label'),
    by_workflow: countByField(observationRows, 'workflow'),
    time_series: buildTimeSeries(observationRows),
    response_pass_rate: passRate(observationRows, 'response_pass'),
    sentiment_pass_rate: passRate(observationRows, 'sentiment_pass'),
    red_team_safety_pass_rate: passRate(observationRows, 'red_team_safety_pass'),
    leakage_failures: observationRows.reduce((sum, row) => sum + toNumber(row.leakage_failures), 0),
    quality_score_avg: qualityScores.length
      ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length
      : null,
    quality_score_worst: qualityScores.length ? Math.min(...qualityScores) : null,
    notes: [
      'Usefulness/rubric pass rate only — not model accuracy without ground truth',
      '171315/171315 is labeled H1+H2+H3 only',
      'Phase 22C 7200/7200 is sample only',
      'Phase 22B 15/15 is smoke only',
    ],
  };
}

export function summarizeUsefulnessKpiHonest(observationRows) {
  return summarizeUsefulnessKpiFromObservations(observationRows);
}
