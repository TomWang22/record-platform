/**
 * Phase 26C — searchability KPI aggregation from ai_kpi_searchability_checks (read-only).
 */
import { summarizeDataToSearchableKpi } from './phase24b-ai-kpi-readonly.mjs';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

function summarizeTiming(values) {
  if (!values.length) {
    return { p50: null, p95: null, max: null, sample_count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    sample_count: sorted.length,
  };
}

export function summarizeSearchabilityKpiFromChecks(checkRows, runLevelFallback = null) {
  if (!Array.isArray(checkRows) || checkRows.length === 0) {
    const fallback = summarizeDataToSearchableKpi(runLevelFallback);
    return {
      ...fallback,
      source: 'uninstrumented_fallback',
      kpi_searchability_checks_available: false,
    };
  }

  const arrivalValues = checkRows.map((row) => toNumber(row.arrival_to_searchable_ms)).filter((v) => v >= 0);
  const runLevel = summarizeDataToSearchableKpi(runLevelFallback);

  return {
    status: arrivalValues.length ? 'PASS' : 'GAP',
    source: 'ai.ai_kpi_searchability_checks',
    kpi_searchability_checks_available: true,
    arrival_to_searchable_ms: summarizeTiming(arrivalValues),
    searchable_verified_at_present: checkRows.some((row) => row.searchable_verified_at),
    by_source_type: checkRows.reduce((acc, row) => {
      const sourceType = row.source_type;
      if (!acc[sourceType]) acc[sourceType] = [];
      acc[sourceType].push(toNumber(row.arrival_to_searchable_ms));
      return acc;
    }, {}),
    run_level: {
      started_at_present: runLevel.started_at_present ?? false,
      finished_at_present: runLevel.finished_at_present ?? false,
    },
    notes: [
      'arrival_to_searchable_ms derived from ai.ai_kpi_searchability_checks only',
      'Do not invent timing when check rows are absent',
    ],
  };
}

export function summarizeSearchabilityKpiHonest(checkRows, runLevelFallback = null) {
  if (!Array.isArray(checkRows) || checkRows.length === 0) {
    return summarizeSearchabilityKpiFromChecks([], runLevelFallback);
  }
  return summarizeSearchabilityKpiFromChecks(checkRows, runLevelFallback);
}
