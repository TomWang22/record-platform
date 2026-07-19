/**
 * Phase 34 data-quality / provenance report builder.
 * Hard distinction violations must be zero for PASS.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  normalizeMarketEvent,
  validateHardDistinctions,
  REQUIRED_EXCLUSIONS,
} from './phase34-market-event-normalization.mjs';
import { buildEvidenceSnapshot } from './phase34-evidence-snapshot.mjs';

function rate(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 10000) / 10000;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build metrics object from normalized events, exclusions, and resolutions.
 */
export function buildDataQualityReport({
  events = [],
  exclusions = [],
  resolutions = [],
  evidence_items = [],
  metrics = {},
  capability = 'market_data_quality',
  subject = null,
} = {}) {
  const normalized = events.map((e) => (e?.content_hash ? e : normalizeMarketEvent(e)));

  let asking_as_sold_violations = 0;
  let active_as_completed_violations = 0;
  let currency_conversion_failures = 0;
  let condition_normalization_failures = 0;
  let source_rights_failures = 0;
  let events_rejected = 0;
  let events_deduplicated = 0;

  const seenHashes = new Set();
  for (const e of normalized) {
    if (e.content_hash) {
      if (seenHashes.has(e.content_hash)) events_deduplicated += 1;
      else seenHashes.add(e.content_hash);
    }
    // Remaining hard violations only — corrected/blocked inputs do not count.
    if (
      e.event_type === 'ASKING_LISTING' &&
      (e.event_status === 'COMPLETED' || e.treated_as_sold === true)
    ) {
      asking_as_sold_violations += 1;
    }
    if (e.event_status === 'ACTIVE' && e.treated_as_completed === true) {
      active_as_completed_violations += 1;
    }
    if (e._meta?.currency_conversion_failure) currency_conversion_failures += 1;
    if (e._meta?.warnings?.includes('condition_normalization_failure')) {
      condition_normalization_failures += 1;
    }
    if (e.rights_status === 'UNAVAILABLE') source_rights_failures += 1;
  }

  // Detect any surviving hard-distinction failures on canonical rows.
  try {
    validateHardDistinctions(
      normalized.map((e) => {
        const { _meta, ...rest } = e;
        return rest;
      }),
    );
  } catch (err) {
    for (const v of err.violations || []) {
      if (v.code === 'ASKING_AS_SOLD') asking_as_sold_violations += 1;
      if (v.code === 'ACTIVE_AS_COMPLETED') active_as_completed_violations += 1;
    }
  }

  const exclusionRows = Array.isArray(exclusions) ? exclusions : [];
  events_rejected = exclusionRows.filter((x) => x.included === false || x.rejected === true).length;

  const deleted = exclusionRows.filter(
    (x) => String(x.excluded_reason || '').includes('deleted'),
  ).length;
  const unauthorized = exclusionRows.filter(
    (x) => String(x.excluded_reason || '').includes('unauthorized'),
  ).length;
  const stale = normalized.filter((e) => e.staleness_status === 'STALE').length;

  const exact = resolutions.filter((r) => r.resolution_status === 'EXACT').length;
  const ambiguous = resolutions.filter(
    (r) => r.resolution_status === 'AMBIGUOUS' || r.resolution_status === 'UNRESOLVED',
  ).length;

  // Reproducibility: build snapshot twice; hashes must match.
  const items =
    evidence_items.length > 0
      ? evidence_items
      : normalized.map((e) => ({
          evidence_id: `ev-${e.content_hash.slice(0, 12)}`,
          source_id: e.source_id,
          content_hash: e.content_hash,
          included: true,
          freshness: e.staleness_status === 'STALE' ? 'stale' : 'fresh',
          pressing_confidence: e.pressing_match_confidence,
          identity_status: e.identity_resolution_status,
          event_type: e.event_type,
        }));

  const snapA = buildEvidenceSnapshot({
    capability,
    subject,
    evidence_items: items,
    metrics,
    created_at: '1970-01-01T00:00:00.000Z',
  });
  const snapB = buildEvidenceSnapshot({
    capability,
    subject,
    evidence_items: items,
    metrics,
    created_at: '1970-01-01T00:00:00.000Z',
  });
  const evidence_snapshot_reproducibility =
    snapA.evidence_snapshot_hash === snapB.evidence_snapshot_hash ? 1 : 0;

  const hard_violations =
    asking_as_sold_violations +
    active_as_completed_violations;

  const report_metrics = {
    events_ingested: normalized.length,
    events_rejected,
    events_deduplicated,
    exact_pressing_rate: rate(exact, resolutions.length || normalized.length),
    ambiguous_pressing_rate: rate(ambiguous, resolutions.length || normalized.length),
    stale_rate: rate(stale, normalized.length),
    deleted_suppression_rate: rate(deleted, exclusionRows.length || normalized.length),
    unauthorized_suppression_rate: rate(unauthorized, exclusionRows.length || normalized.length),
    asking_as_sold_violations,
    active_as_completed_violations,
    currency_conversion_failures,
    condition_normalization_failures,
    source_rights_failures,
    evidence_snapshot_reproducibility,
  };

  const pass =
    report_metrics.asking_as_sold_violations === 0 &&
    report_metrics.active_as_completed_violations === 0 &&
    report_metrics.evidence_snapshot_reproducibility === 1 &&
    hard_violations === 0;

  return {
    report_version: 'phase34-data-quality-report-v1',
    generated_at: new Date(0).toISOString(),
    required_exclusions: [...REQUIRED_EXCLUSIONS],
    metrics: report_metrics,
    hard_violations,
    verdict: pass ? 'PASS' : 'FAIL',
    evidence_snapshot_id: snapA.evidence_snapshot_id,
    evidence_snapshot_hash: snapA.evidence_snapshot_hash,
  };
}

function renderHtml(report) {
  const rows = Object.entries(report.metrics || {})
    .map(
      ([k, v]) =>
        `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Phase 34 Data Quality Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; }
    h1 { font-size: 1.4rem; }
    .verdict { font-weight: 700; }
    .PASS { color: #0a7a32; }
    .FAIL { color: #b00020; }
    table { border-collapse: collapse; margin-top: 1rem; }
    td, th { border: 1px solid #ccc; padding: 0.4rem 0.7rem; text-align: left; }
  </style>
</head>
<body>
  <h1>Phase 34 Data Quality Report</h1>
  <p>Version: ${escapeHtml(report.report_version)}</p>
  <p class="verdict ${escapeHtml(report.verdict)}">Verdict: ${escapeHtml(report.verdict)}</p>
  <p>Hard violations: ${escapeHtml(report.hard_violations)}</p>
  <p>Snapshot: ${escapeHtml(report.evidence_snapshot_id)} / ${escapeHtml(report.evidence_snapshot_hash)}</p>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}

/**
 * Write reports/data-quality-report.json and .html under outDir (creates dirs).
 */
export function writeDataQualityReports(outDir, reportInput = {}) {
  if (!outDir) throw new Error('outDir is required');
  const reportsDir = path.join(outDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const report =
    reportInput.metrics && reportInput.verdict
      ? reportInput
      : buildDataQualityReport(reportInput);

  const jsonPath = path.join(reportsDir, 'data-quality-report.json');
  const htmlPath = path.join(reportsDir, 'data-quality-report.html');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(htmlPath, renderHtml(report), 'utf8');

  const checksum = crypto
    .createHash('sha256')
    .update(fs.readFileSync(jsonPath))
    .digest('hex');

  return {
    reportsDir,
    jsonPath,
    htmlPath,
    report,
    checksum,
  };
}
