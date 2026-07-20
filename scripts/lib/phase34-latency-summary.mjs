/**
 * Produces statistically honest latency summaries.
 *
 * Tail percentiles use integer parts-per-million so thresholds stay exact
 * (no accidental 1001/10001 from floating-point 1 - 99.9/100).
 * Unsupported percentile values are suppressed; p100 is observed max only.
 */

export const LATENCY_MEASUREMENT_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE_RUN',
  COMPLETE_OWNER_PROOF_SCHEDULE: 'COMPLETE_OWNER_PROOF_SCHEDULE',
  PARTIAL: 'PARTIAL_RUN',
  PARTIAL_ABORTED: 'PARTIAL_ABORTED_RUN',
  EMPTY: 'NO_MEASUREMENTS',
});

export const LATENCY_REPRESENTATIVE_STATUS = Object.freeze({
  THIS_RUN: 'REPRESENTATIVE_OF_THIS_RUN',
  OWNER_PROOF_ONLY: 'OWNER_PROOF_ONLY_NOT_PLATFORM_PERFORMANCE',
  NOT_FULL_RUN: 'NOT_REPRESENTATIVE_OF_FULL_RUN',
});

export const LATENCY_ACCEPTANCE_STATUS = Object.freeze({
  PASS: 'PASS',
  BLOCKED_POST_EXECUTION: 'BLOCKED_POST_EXECUTION',
  N_A: 'NOT_APPLICABLE',
});

export const PERCENTILE_SUPPORT = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  LOW_SAMPLE: 'LOW_SAMPLE_ESTIMATE',
  NOT_ESTIMABLE: 'NOT_ESTIMABLE',
  OBSERVED_MAX_ONLY: 'OBSERVED_MAX_ONLY',
});

/** Cumulative percentile as parts-per-million of the distribution below the cut. */
export const PERCENTILE_PPM = Object.freeze({
  p50: 500_000,
  p90: 900_000,
  p95: 950_000,
  p99: 990_000,
  p99_9: 999_000,
  p99_99: 999_900,
  p99_999: 999_990,
  p99_9999: 999_999,
  p100: 1_000_000,
});

const DEFAULT_PERCENTILE_KEYS = Object.freeze(Object.keys(PERCENTILE_PPM));

const MILLION = 1_000_000;

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function assertValidCount(value, fieldName, { allowZero = true } = {}) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${fieldName} must be an integer`);
  }
  const minimum = allowZero ? 0 : 1;
  if (value < minimum) {
    throw new RangeError(`${fieldName} must be >= ${minimum}`);
  }
}

function validateSamples(samplesMs) {
  if (!Array.isArray(samplesMs)) {
    throw new TypeError('samplesMs must be an array');
  }
  return samplesMs.map((value, index) => {
    if (!Number.isFinite(value)) {
      throw new TypeError(`samplesMs[${index}] must be finite`);
    }
    if (value < 0) {
      throw new RangeError(`samplesMs[${index}] must be non-negative`);
    }
    return value;
  });
}

/**
 * Convert a percentile key or numeric percent into cumulative PPM.
 * Accepts 99.9, "99.9", "p99_9", "p99.9".
 */
export function percentileToPpm(percentile) {
  if (typeof percentile === 'string') {
    const key = percentile.startsWith('p')
      ? percentile.replace(/\./g, '_')
      : `p${String(percentile).replace(/\./g, '_')}`;
    if (PERCENTILE_PPM[key] != null) return PERCENTILE_PPM[key];
    const asNumber = Number(percentile.replace(/^p/, '').replace(/_/g, '.'));
    if (!Number.isFinite(asNumber)) {
      throw new RangeError(`unknown percentile: ${percentile}`);
    }
    return percentileToPpm(asNumber);
  }
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new RangeError('percentile must be > 0 and <= 100');
  }
  // Exact known cuts first.
  const exact = Object.entries(PERCENTILE_PPM).find(([, ppm]) => ppm === Math.round(percentile * 10_000));
  if (exact) return exact[1];
  return Math.round(percentile * 10_000);
}

/**
 * Nearest-rank on sorted ascending samples. For p100 returns the max.
 */
export function nearestRankPercentile(sortedSamples, percentile) {
  if (!Array.isArray(sortedSamples) || sortedSamples.length === 0) return null;
  const ppm = percentileToPpm(percentile);
  if (ppm === MILLION) return sortedSamples[sortedSamples.length - 1];
  const rank = Math.ceil((ppm / MILLION) * sortedSamples.length);
  const index = Math.min(Math.max(rank - 1, 0), sortedSamples.length - 1);
  return sortedSamples[index];
}

/**
 * Classify support using integer PPM tail mass: expected = n * tailPpm / 1e6.
 */
export function classifyPercentileSupport(sampleCount, percentile) {
  assertValidCount(sampleCount, 'sampleCount');
  const ppm = percentileToPpm(percentile);

  if (sampleCount === 0) {
    return {
      support: PERCENTILE_SUPPORT.NOT_ESTIMABLE,
      percentile_ppm: ppm,
      expected_tail_observations: 0,
      minimum_samples_for_one_tail_observation: null,
      minimum_samples_for_ten_tail_observations: null,
    };
  }

  if (ppm === MILLION) {
    return {
      support: PERCENTILE_SUPPORT.OBSERVED_MAX_ONLY,
      percentile_ppm: ppm,
      expected_tail_observations: 0,
      minimum_samples_for_one_tail_observation: null,
      minimum_samples_for_ten_tail_observations: null,
    };
  }

  if (ppm === PERCENTILE_PPM.p50) {
    return {
      support:
        sampleCount >= 3
          ? PERCENTILE_SUPPORT.SUPPORTED
          : PERCENTILE_SUPPORT.LOW_SAMPLE,
      percentile_ppm: ppm,
      expected_tail_observations: sampleCount * 0.5,
      minimum_samples_for_one_tail_observation: 2,
      minimum_samples_for_ten_tail_observations: 20,
    };
  }

  const tailPpm = MILLION - ppm;
  // expected = n * tailPpm / 1e6 — keep as exact rational rounded for display
  const expectedTailObservations = (sampleCount * tailPpm) / MILLION;
  const minimumForOne = Math.ceil(MILLION / tailPpm);
  const minimumForTen = Math.ceil((10 * MILLION) / tailPpm);

  let support = PERCENTILE_SUPPORT.SUPPORTED;
  if (expectedTailObservations < 1) {
    support = PERCENTILE_SUPPORT.NOT_ESTIMABLE;
  } else if (expectedTailObservations < 10) {
    support = PERCENTILE_SUPPORT.LOW_SAMPLE;
  }

  return {
    support,
    percentile_ppm: ppm,
    expected_tail_observations: round(expectedTailObservations, 6),
    minimum_samples_for_one_tail_observation: minimumForOne,
    minimum_samples_for_ten_tail_observations: minimumForTen,
  };
}

function calculateMean(samples) {
  if (samples.length === 0) return null;
  return samples.reduce((total, value) => total + value, 0) / samples.length;
}

function deriveMeasurementStatus({
  actualCount,
  plannedCount,
  runCompleted,
  runAborted,
  ownerProofSchedule = false,
}) {
  if (actualCount === 0) return LATENCY_MEASUREMENT_STATUS.EMPTY;
  if (runAborted) return LATENCY_MEASUREMENT_STATUS.PARTIAL_ABORTED;
  if (!runCompleted || actualCount < plannedCount) {
    return LATENCY_MEASUREMENT_STATUS.PARTIAL;
  }
  if (ownerProofSchedule) {
    return LATENCY_MEASUREMENT_STATUS.COMPLETE_OWNER_PROOF_SCHEDULE;
  }
  return LATENCY_MEASUREMENT_STATUS.COMPLETE;
}

function buildPercentileEntry(sortedSamples, percentileKey) {
  const support = classifyPercentileSupport(sortedSamples.length, percentileKey);
  const observedValue = nearestRankPercentile(sortedSamples, percentileKey);

  if (support.support === PERCENTILE_SUPPORT.OBSERVED_MAX_ONLY) {
    return {
      percentile: percentileKey,
      value_ms: null,
      observed_maximum_ms: round(observedValue, 3),
      observed_order_statistic_ms: round(observedValue, 3),
      support: support.support,
      expected_tail_observations: support.expected_tail_observations,
      minimum_samples_for_one_tail_observation:
        support.minimum_samples_for_one_tail_observation,
      minimum_samples_for_ten_tail_observations:
        support.minimum_samples_for_ten_tail_observations,
    };
  }

  const publishable =
    support.support === PERCENTILE_SUPPORT.SUPPORTED ||
    support.support === PERCENTILE_SUPPORT.LOW_SAMPLE;

  return {
    percentile: percentileKey,
    value_ms: publishable ? round(observedValue, 3) : null,
    observed_order_statistic_ms: round(observedValue, 3),
    support: support.support,
    expected_tail_observations: support.expected_tail_observations,
    minimum_samples_for_one_tail_observation:
      support.minimum_samples_for_one_tail_observation,
    minimum_samples_for_ten_tail_observations:
      support.minimum_samples_for_ten_tail_observations,
  };
}

/**
 * @param {number[]} samplesMs
 * @param {{
 *   plannedTurns: number,
 *   runCompleted?: boolean,
 *   runAborted?: boolean,
 *   ownerProofSchedule?: boolean,
 *   acceptanceStatus?: string | null,
 *   acceptanceFailureClass?: string | null,
 *   metricName?: string,
 *   runId?: string | null,
 *   percentileKeys?: string[],
 *   warmCold?: string | null,
 *   capability?: string | null,
 *   scenarioClass?: string | null,
 *   viewport?: string | null,
 *   modelTier?: string | null,
 *   retrievalMode?: string | null,
 *   cacheState?: string | null,
 * }} options
 */
export function summarizeLatency(samplesMs, options) {
  const samples = validateSamples(samplesMs);
  const {
    plannedTurns,
    runCompleted = false,
    runAborted = false,
    ownerProofSchedule = false,
    acceptanceStatus = null,
    acceptanceFailureClass = null,
    metricName = 'browser_action_to_terminal_ready_ms',
    runId = null,
    percentileKeys = DEFAULT_PERCENTILE_KEYS,
    warmCold = null,
    capability = null,
    scenarioClass = null,
    viewport = null,
    modelTier = null,
    retrievalMode = null,
    cacheState = null,
  } = options ?? {};

  assertValidCount(plannedTurns, 'plannedTurns', { allowZero: false });

  if (samples.length > plannedTurns) {
    throw new RangeError(
      `sample count ${samples.length} exceeds plannedTurns ${plannedTurns}`,
    );
  }
  if (runCompleted && runAborted) {
    throw new Error('runCompleted and runAborted cannot both be true');
  }
  if (runCompleted && samples.length !== plannedTurns) {
    throw new Error(
      'A completed run must contain exactly plannedTurns measurements',
    );
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const actualCount = sorted.length;
  const measurementStatus = deriveMeasurementStatus({
    actualCount,
    plannedCount: plannedTurns,
    runCompleted,
    runAborted,
    ownerProofSchedule,
  });

  const percentileResults = {};
  for (const key of percentileKeys) {
    percentileResults[key] = buildPercentileEntry(sorted, key);
  }

  const scheduleComplete =
    runCompleted &&
    !runAborted &&
    actualCount === plannedTurns;

  let representative;
  if (!scheduleComplete) {
    representative = LATENCY_REPRESENTATIVE_STATUS.NOT_FULL_RUN;
  } else if (ownerProofSchedule) {
    representative = LATENCY_REPRESENTATIVE_STATUS.OWNER_PROOF_ONLY;
  } else {
    representative = LATENCY_REPRESENTATIVE_STATUS.THIS_RUN;
  }

  const observedMedian =
    actualCount > 0 ? nearestRankPercentile(sorted, 'p50') : null;
  const observedMax =
    actualCount > 0 ? sorted[actualCount - 1] : null;

  const resolvedAcceptance =
    acceptanceStatus ||
    (scheduleComplete
      ? LATENCY_ACCEPTANCE_STATUS.N_A
      : LATENCY_ACCEPTANCE_STATUS.N_A);

  const note =
    actualCount === 0
      ? `No ${metricName} observations were recorded.`
      : scheduleComplete && ownerProofSchedule
        ? `${actualCount}/${plannedTurns} planned turns were measured for this owner-proof schedule (${metricName}). Descriptive statistics are SUPPORTED for this schedule only and are not platform-wide performance claims. High percentiles remain NOT_ESTIMABLE until larger performance tiers run.`
        : scheduleComplete
          ? `${actualCount}/${plannedTurns} planned turns were measured for ${metricName}. Tail percentile support is reported per percentile. High percentiles remain NOT_ESTIMABLE until larger performance tiers run.`
          : `${actualCount}/${plannedTurns} planned turns were measured before the run ended. This schedule-biased partial sample must not be presented as platform-wide performance. Unsupported tail percentiles are suppressed. Coverage ${actualCount}/${plannedTurns}.`;

  return {
    schema_version: 'phase34-latency-summary-v4',
    run_id: runId,
    metric_name: metricName,
    unit: 'milliseconds',
    measurement_status: measurementStatus,
    run_completed: runCompleted,
    run_aborted: runAborted,
    schedule_state: scheduleComplete ? 'COMPLETE' : runAborted ? 'ABORTED' : 'PARTIAL',
    acceptance_status: resolvedAcceptance,
    acceptance_failure_class: acceptanceFailureClass,
    representative_status: representative,
    actual_sample_count: actualCount,
    planned_turn_count: plannedTurns,
    schedule_coverage: `${actualCount}/${plannedTurns}`,
    coverage_ratio: round(actualCount / plannedTurns, 6),
    warm_cold: warmCold,
    capability,
    scenario_class: scenarioClass,
    viewport,
    model_tier: modelTier,
    retrieval_mode: retrievalMode,
    cache_state: cacheState,
    descriptive_statistics: {
      minimum_ms: actualCount > 0 ? round(sorted[0], 3) : null,
      observed_median_ms: observedMedian == null ? null : round(observedMedian, 3),
      mean_ms: actualCount > 0 ? round(calculateMean(sorted), 3) : null,
      observed_maximum_ms: observedMax == null ? null : round(observedMax, 3),
    },
    percentiles: percentileResults,
    note,
  };
}

/** Mathematical threshold helpers for tests (no large arrays). */
export function minimumSamplesForTenTailObservations(percentile) {
  const ppm = percentileToPpm(percentile);
  if (ppm === MILLION) return null;
  const tailPpm = MILLION - ppm;
  return Math.ceil((10 * MILLION) / tailPpm);
}

export function minimumSamplesForOneTailObservation(percentile) {
  const ppm = percentileToPpm(percentile);
  if (ppm === MILLION) return null;
  const tailPpm = MILLION - ppm;
  return Math.ceil(MILLION / tailPpm);
}
