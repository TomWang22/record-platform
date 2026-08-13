/**
 * Per-cell cleanup-then-seed and harness cardinality stability.
 * Harness rows stay distinguishable by frozen benchmark identity (note / event type).
 */
export function inspectHarnessCardinalities(opts) {
  const counts = opts.counts || {};
  return {
    schema: opts.schema || null,
    domain_touch: Number(counts.domain_touch) || 0,
    unpublished_seed: Number(counts.unpublished_seed) || 0,
    published_seed: Number(counts.published_seed) || 0,
    unpublished_domain_touch_outbox: Number(counts.unpublished_domain_touch_outbox) || 0,
    published_domain_touch_outbox: Number(counts.published_domain_touch_outbox) || 0,
    lease_benchmark_rows: counts.lease_benchmark_rows ?? null,
    dlq_benchmark_rows: counts.dlq_benchmark_rows ?? null,
  };
}

export function cardinalitySnapshotsEqual(a, b) {
  if (!a || !b) return false;
  const keys = [
    "domain_touch",
    "unpublished_seed",
    "published_seed",
    "unpublished_domain_touch_outbox",
    "published_domain_touch_outbox",
    "lease_benchmark_rows",
    "dlq_benchmark_rows",
  ];
  return keys.every((k) => a[k] === b[k]);
}

/**
 * CLEAN → SEED → inspect A → W1/W2/W3/WMIX → CLEAN → SEED → inspect B
 */
export function runSeedCleanupStabilityCycle(opts) {
  opts.cleanup();
  opts.seed();
  const baseline_a = opts.inspect();
  opts.workloads.W1();
  opts.workloads.W2();
  opts.workloads.W3();
  opts.workloads.WMIX();
  opts.cleanup();
  opts.seed();
  const baseline_b = opts.inspect();
  const ok = cardinalitySnapshotsEqual(baseline_a, baseline_b);
  return {
    ok,
    schema: opts.schema,
    baseline_a,
    baseline_b,
    reason: ok ? null : "SEED_CLEANUP_CARDINALITY_DRIFT",
  };
}

export const CLEANUP_SQL_REL = "scripts/performance/pgbench/common/cleanup.sql";
export const SEED_SQL_REL = "scripts/performance/pgbench/common/seed.sql";
export const INDEXES_SQL_REL = "scripts/performance/pgbench/common/indexes.sql";
