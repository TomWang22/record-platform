/**
 * Derive p50/p95/p99/max from pgbench -l latency samples.
 * Never invent percentiles from average/stddev.
 */

/**
 * @param {number[]} samplesMs
 */
export function percentilesFromSamples(samplesMs) {
  if (!Array.isArray(samplesMs) || samplesMs.length === 0) {
    return {
      status: "METRIC_UNAVAILABLE",
      reason: "no latency samples",
      n: 0,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    };
  }
  const sorted = [...samplesMs].map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      status: "METRIC_UNAVAILABLE",
      reason: "no finite latency samples",
      n: 0,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    };
  }
  const at = (p) => {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  };
  return {
    status: "OK",
    n: sorted.length,
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Parse pgbench --log lines.
 * Format: client_id transaction_no time(us) script_no time_epoch time_us
 * The 3rd field is latency in microseconds for modern pgbench.
 * @param {string} text
 * @returns {number[]} latency ms
 */
export function parsePgbenchLatencyLog(text) {
  /** @type {number[]} */
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const latencyUs = Number(parts[2]);
    if (!Number.isFinite(latencyUs)) continue;
    out.push(latencyUs / 1000);
  }
  return out;
}
