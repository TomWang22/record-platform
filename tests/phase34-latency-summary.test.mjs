import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LATENCY_MEASUREMENT_STATUS,
  PERCENTILE_SUPPORT,
  classifyPercentileSupport,
  minimumSamplesForOneTailObservation,
  minimumSamplesForTenTailObservations,
  nearestRankPercentile,
  summarizeLatency,
} from '../scripts/lib/phase34-latency-summary.mjs';

test('nearest-rank percentile returns an observed value', () => {
  const samples = [1000, 2000, 2887, 6000, 7006];
  assert.equal(nearestRankPercentile(samples, 50), 2887);
  assert.equal(nearestRankPercentile(samples, 'p95'), 7006);
  assert.equal(nearestRankPercentile(samples, 'p100'), 7006);
});

test('n=5 suppresses p90 and all higher estimated percentiles', () => {
  for (const key of ['p90', 'p95', 'p99', 'p99_9', 'p99_99', 'p99_999', 'p99_9999']) {
    const result = classifyPercentileSupport(5, key);
    assert.equal(
      result.support,
      PERCENTILE_SUPPORT.NOT_ESTIMABLE,
      `${key} should not be estimable from five observations`,
    );
  }
});

test('p100 is always OBSERVED_MAX_ONLY', () => {
  for (const n of [1, 5, 27, 1000]) {
    assert.equal(
      classifyPercentileSupport(n, 'p100').support,
      PERCENTILE_SUPPORT.OBSERVED_MAX_ONLY,
    );
  }
});

test('integer PPM thresholds avoid floating-point 1001/10001 mistakes', () => {
  assert.equal(minimumSamplesForOneTailObservation('p99_9'), 1000);
  assert.equal(minimumSamplesForTenTailObservations('p99_9'), 10_000);
  assert.equal(minimumSamplesForOneTailObservation('p99_99'), 10_000);
  assert.equal(minimumSamplesForTenTailObservations('p99_99'), 100_000);
  assert.equal(minimumSamplesForOneTailObservation('p99_999'), 100_000);
  assert.equal(minimumSamplesForTenTailObservations('p99_999'), 1_000_000);
  assert.equal(minimumSamplesForOneTailObservation('p99_9999'), 1_000_000);
  assert.equal(minimumSamplesForTenTailObservations('p99_9999'), 10_000_000);
});

test('n=27 makes p90 and p95 LOW_SAMPLE, not SUPPORTED; p99 remains NOT_ESTIMABLE', () => {
  assert.equal(classifyPercentileSupport(27, 'p90').support, PERCENTILE_SUPPORT.LOW_SAMPLE);
  assert.equal(classifyPercentileSupport(27, 'p95').support, PERCENTILE_SUPPORT.LOW_SAMPLE);
  assert.equal(classifyPercentileSupport(27, 'p99').support, PERCENTILE_SUPPORT.NOT_ESTIMABLE);
  assert.equal(classifyPercentileSupport(27, 'p99_9').support, PERCENTILE_SUPPORT.NOT_ESTIMABLE);
});

test('supported thresholds for ten expected tail observations', () => {
  assert.equal(classifyPercentileSupport(100, 'p90').support, PERCENTILE_SUPPORT.SUPPORTED);
  assert.equal(classifyPercentileSupport(100, 'p90').expected_tail_observations, 10);
  assert.equal(classifyPercentileSupport(200, 'p95').support, PERCENTILE_SUPPORT.SUPPORTED);
  assert.equal(classifyPercentileSupport(200, 'p95').expected_tail_observations, 10);
  assert.equal(classifyPercentileSupport(1000, 'p99').support, PERCENTILE_SUPPORT.SUPPORTED);
  assert.equal(classifyPercentileSupport(1000, 'p99').expected_tail_observations, 10);
  assert.equal(classifyPercentileSupport(10_000, 'p99_9').support, PERCENTILE_SUPPORT.SUPPORTED);
  assert.equal(classifyPercentileSupport(10_000, 'p99_9').expected_tail_observations, 10);
  assert.equal(classifyPercentileSupport(100_000, 'p99_99').support, PERCENTILE_SUPPORT.SUPPORTED);
  assert.equal(classifyPercentileSupport(1_000_000, 'p99_999').support, PERCENTILE_SUPPORT.SUPPORTED);
  assert.equal(classifyPercentileSupport(10_000_000, 'p99_9999').support, PERCENTILE_SUPPORT.SUPPORTED);
});

test('aborted five-turn run suppresses unsupported tails and stays non-representative', () => {
  const summary = summarizeLatency([1589, 2764, 2887, 3794, 7006], {
    plannedTurns: 27,
    runAborted: true,
    metricName: 'browser_action_to_terminal_ready_ms',
    runId: 'phase34-owner-proof-live-recapture-v4',
  });

  assert.equal(summary.measurement_status, LATENCY_MEASUREMENT_STATUS.PARTIAL_ABORTED);
  assert.equal(summary.representative_status, 'NOT_REPRESENTATIVE_OF_FULL_RUN');
  assert.equal(summary.actual_sample_count, 5);
  assert.equal(summary.planned_turn_count, 27);
  assert.equal(summary.schedule_coverage, '5/27');
  assert.equal(summary.coverage_ratio, 0.185185);
  assert.equal(summary.descriptive_statistics.observed_median_ms, 2887);
  assert.equal(summary.descriptive_statistics.observed_maximum_ms, 7006);

  for (const key of ['p90', 'p95', 'p99', 'p99_9', 'p99_99', 'p99_999', 'p99_9999']) {
    assert.equal(summary.percentiles[key].value_ms, null, key);
    assert.equal(summary.percentiles[key].support, PERCENTILE_SUPPORT.NOT_ESTIMABLE, key);
  }
  assert.equal(summary.percentiles.p100.support, PERCENTILE_SUPPORT.OBSERVED_MAX_ONLY);
  assert.equal(summary.percentiles.p100.value_ms, null);
  assert.equal(summary.percentiles.p100.observed_maximum_ms, 7006);

  assert.match(summary.note, /5\/27/);
  assert.doesNotMatch(summary.note, /81 protocol rows/);
});

test('summary refuses to claim completion with missing turns', () => {
  assert.throws(
    () =>
      summarizeLatency([100, 200, 300], {
        plannedTurns: 27,
        runCompleted: true,
      }),
    /completed run must contain exactly plannedTurns/i,
  );
});

test('summary rejects invalid samples', () => {
  assert.throws(
    () => summarizeLatency([100, -1], { plannedTurns: 2 }),
    /non-negative/,
  );
  assert.throws(
    () => summarizeLatency([100, Number.NaN], { plannedTurns: 2 }),
    /finite/,
  );
});

test('aborted runs are never REPRESENTATIVE even with full planned count', () => {
  const samples = Array.from({ length: 27 }, (_, i) => 1000 + i);
  const summary = summarizeLatency(samples, {
    plannedTurns: 27,
    runAborted: true,
  });
  assert.equal(summary.representative_status, 'NOT_REPRESENTATIVE_OF_FULL_RUN');
  assert.equal(summary.measurement_status, LATENCY_MEASUREMENT_STATUS.PARTIAL_ABORTED);
});
