/**
 * PostgreSQL wait_event classifier for Gate-3 / Gate-5 attribution.
 * Missing wait_event histograms → METRIC_UNAVAILABLE with null counts (never invented zeros).
 * Observed empty/partial histograms may contain zeros only for classes that were counted.
 */

const LOCK_TYPES = new Set(["Lock", "LWLock", "BufferPin"]);

/**
 * @param {string | null | undefined} wait_event_type
 * @param {{ state?: string | null }} [opts]
 * @returns {"lock" | "io" | "cpu" | "other"}
 */
export function classifyWaitEventType(wait_event_type, opts = {}) {
  if (wait_event_type == null || wait_event_type === "") {
    return opts.state === "active" ? "cpu" : "other";
  }
  if (LOCK_TYPES.has(wait_event_type)) return "lock";
  if (wait_event_type === "IO") return "io";
  if (wait_event_type === "CPU") return "cpu";
  return "other";
}

function unavailable(reason) {
  return {
    status: "METRIC_UNAVAILABLE",
    reason,
    locks: null,
    io: null,
    cpu: null,
    other: null,
  };
}

/**
 * @param {any} input
 */
export function classifyPostgresWaitEvents(input) {
  if (input == null) {
    return unavailable("wait_events histogram absent");
  }
  const events = Array.isArray(input)
    ? input
    : Array.isArray(input.wait_events)
      ? input.wait_events
      : null;
  if (events == null) {
    return unavailable("wait_events histogram absent");
  }

  const counts = { lock: 0, io: 0, cpu: 0, other: 0 };
  /** @type {Record<string, Record<string, number>>} */
  const byEvent = { lock: {}, io: {}, cpu: {}, other: {} };
  for (const row of events) {
    if (!row || typeof row !== "object") continue;
    const n = Number(row.n ?? row.count ?? 1);
    const add = Number.isFinite(n) ? n : 0;
    const cls = classifyWaitEventType(row.wait_event_type, { state: row.state });
    counts[cls] += add;
    const name = row.wait_event || row.wait_event_type || cls;
    byEvent[cls][name] = (byEvent[cls][name] || 0) + add;
  }

  return {
    status: "OK",
    reason: null,
    locks: { count: counts.lock, events: byEvent.lock },
    io: { count: counts.io, events: byEvent.io },
    cpu: { count: counts.cpu, events: byEvent.cpu },
    other: { count: counts.other, events: byEvent.other },
  };
}

/**
 * Merge per-cell histograms. Any cell without wait_events keeps the owner summary unavailable.
 * @param {any[]} histograms
 */
export function mergeWaitEventClassifications(histograms) {
  const list = Array.isArray(histograms) ? histograms : [];
  if (!list.length) return unavailable("no wait_event histograms");
  if (list.some((h) => !h || h.status !== "OK")) {
    return unavailable("one or more cells lack wait_event histograms");
  }
  const locks = { count: 0, events: {} };
  const io = { count: 0, events: {} };
  const cpu = { count: 0, events: {} };
  const other = { count: 0, events: {} };
  for (const h of list) {
    locks.count += Number(h.locks?.count || 0);
    io.count += Number(h.io?.count || 0);
    cpu.count += Number(h.cpu?.count || 0);
    other.count += Number(h.other?.count || 0);
  }
  return { status: "OK", reason: null, locks, io, cpu, other };
}
