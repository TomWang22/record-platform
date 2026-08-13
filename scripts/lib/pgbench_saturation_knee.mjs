/**
 * Owner-scoped saturation-knee generator.
 * Incomplete owners (not 1218/1218 valid) return INCOMPLETE with knee=null.
 * Never invents saturation metrics (CPU/lock/IO stay METRIC_UNAVAILABLE without series).
 */

export const SATURATION_KNEE_THRESHOLDS = {
  tps_scale_min: 1.25,
  latency_accel_min: 1.6,
};

function unavailable(reason) {
  return { status: "METRIC_UNAVAILABLE", value: null, reason };
}

function incomplete(opts, reason) {
  return {
    schema: "record-platform-pgbench-saturation-knee/v1",
    owner: opts.owner || null,
    status: "INCOMPLETE",
    reason,
    knee: null,
    TPS_SCALE_KNEE: null,
    P95_ACCELERATION: null,
    P99_ACCELERATION: null,
    CONNECTION_SATURATION: unavailable("requires time-aligned connection series"),
    CPU_SATURATION: unavailable("host ps aggregate only; not cgroup-isolated"),
    LOCK_WAIT_ACCELERATION: unavailable("wait_event lock histogram not attributed across client steps"),
    IO_DOMINANCE: unavailable("wait_event IO histogram not attributed across client steps"),
    owner_complete: opts.owner_complete === true,
    valid_owner_cells: Number(opts.valid_owner_cells) || 0,
    expected_owner_cells: Number(opts.expected_owner_cells) || 1218,
  };
}

/**
 * Detect TPS/p95/p99 knees on a clients-doubling series. Same thresholds as Gate-3 deriveSaturation.
 * @param {any[]} series sorted by clients
 */
export function detectClientDoublingKnees(series, thresholds = SATURATION_KNEE_THRESHOLDS) {
  let tps_knee = null;
  let p95_knee = null;
  let p99_knee = null;
  const rows = Array.isArray(series) ? series : [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (Number(cur.clients) / Number(prev.clients) < 1.9) continue;
    if (
      tps_knee == null &&
      Number(prev.tps) > 0 &&
      Number(cur.tps) / Number(prev.tps) < thresholds.tps_scale_min
    ) {
      tps_knee = Number(cur.clients);
    }
    if (
      p95_knee == null &&
      prev.p95 != null &&
      cur.p95 != null &&
      Number(cur.p95) / Number(prev.p95) > thresholds.latency_accel_min
    ) {
      p95_knee = Number(cur.clients);
    }
    if (
      p99_knee == null &&
      prev.p99 != null &&
      cur.p99 != null &&
      Number(cur.p99) / Number(prev.p99) > thresholds.latency_accel_min
    ) {
      p99_knee = Number(cur.clients);
    }
  }
  return { TPS_SCALE_KNEE: tps_knee, P95_ACCELERATION: p95_knee, P99_ACCELERATION: p99_knee };
}

function primarySeries(rows, owner) {
  const filtered = (rows || []).filter(
    (r) =>
      r &&
      r.status === "PASS" &&
      r.mode === "PER_OWNER_CEILING" &&
      (!owner || r.owner === owner),
  );
  const preferred = filtered.filter(
    (r) => r.workload === "W1_DOMAIN_ONLY" && r.distribution === "UNIFORM",
  );
  const use = preferred.length ? preferred : filtered;
  /** @type {Map<number, any>} */
  const best = new Map();
  for (const r of use) {
    const prev = best.get(r.clients);
    if (!prev || Number(r.threads) > Number(prev.threads)) best.set(r.clients, r);
  }
  return [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => r);
}

/**
 * @param {{
 *   owner?: string,
 *   owner_complete?: boolean,
 *   valid_owner_cells?: number,
 *   expected_owner_cells?: number,
 *   rows?: any[],
 * }} opts
 */
export function generateSaturationKnee(opts = {}) {
  const expected = Number(opts.expected_owner_cells) || 1218;
  const valid = Number(opts.valid_owner_cells) || 0;
  if (opts.owner_complete !== true || valid !== expected || expected !== 1218) {
    return incomplete(
      opts,
      "owner does not have 1218/1218 valid cells — knee stays null",
    );
  }

  const series = primarySeries(opts.rows, opts.owner);
  const knees = detectClientDoublingKnees(series);
  const kneeClients = knees.TPS_SCALE_KNEE ?? knees.P95_ACCELERATION ?? knees.P99_ACCELERATION;
  return {
    schema: "record-platform-pgbench-saturation-knee/v1",
    owner: opts.owner || null,
    status: "OK",
    reason: null,
    knee: kneeClients == null ? null : { clients: kneeClients, method: "client_doubling" },
    ...knees,
    CONNECTION_SATURATION: unavailable("requires time-aligned connection series"),
    CPU_SATURATION: unavailable("host ps aggregate only; not cgroup-isolated"),
    LOCK_WAIT_ACCELERATION: unavailable("wait_event lock histogram not attributed across client steps"),
    IO_DOMINANCE: unavailable("wait_event IO histogram not attributed across client steps"),
    owner_complete: true,
    valid_owner_cells: valid,
    expected_owner_cells: expected,
    series: series.map((r) => ({
      clients: r.clients,
      threads: r.threads,
      tps: r.tps,
      p95: r.p95 ?? null,
      p99: r.p99 ?? null,
    })),
  };
}
