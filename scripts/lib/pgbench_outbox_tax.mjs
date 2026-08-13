/**
 * Cell-matched OUTBOX_DB_TAX with W1/W2 workload equivalence guard.
 * Do not compute tax from averaged unrelated client levels.
 */

const EQUIV_FIELDS = [
  "owner",
  "mode",
  "distribution",
  "clients",
  "threads",
  "repetition",
  "random_seed",
  "warmup_seconds",
  "measured_seconds",
];

/**
 * W1 and W2 are comparable only when they share the frozen corpus dimensions.
 * W2 may differ only by workload name (adds outbox insert).
 */
export function assertWorkloadEquivalence(w1, w2) {
  if (!w1 || !w2) {
    return { ok: false, reason: "WORKLOAD_CONTRACT_MISMATCH", detail: "missing pair" };
  }
  if (w1.workload !== "W1_DOMAIN_ONLY" || w2.workload !== "W2_DOMAIN_PLUS_OUTBOX") {
    return {
      ok: false,
      reason: "WORKLOAD_CONTRACT_MISMATCH",
      detail: "workloads must be W1 then W2",
    };
  }
  for (const f of EQUIV_FIELDS) {
    if (String(w1[f] ?? "") !== String(w2[f] ?? "")) {
      return {
        ok: false,
        reason: "WORKLOAD_CONTRACT_MISMATCH",
        detail: `${f}: ${w1[f]} != ${w2[f]}`,
      };
    }
  }
  if (w1.status !== "PASS" || w2.status !== "PASS") {
    return { ok: false, reason: "WORKLOAD_CONTRACT_MISMATCH", detail: "both must PASS" };
  }
  if (w1.avg_latency_ms == null || w2.avg_latency_ms == null) {
    return { ok: false, reason: "WORKLOAD_CONTRACT_MISMATCH", detail: "missing latency" };
  }
  return { ok: true };
}

function matchKey(row) {
  return [
    row.owner,
    row.mode,
    row.distribution,
    row.clients,
    row.threads,
    row.repetition,
    row.random_seed,
    row.warmup_seconds,
    row.measured_seconds,
  ].join("|");
}

/**
 * Pair each W1 with the W2 that shares the equivalence key.
 * Note: W1/W2 currently use different cell_ids and typically different seeds
 * (seed is derived from cell_id). For tax pairing we match on corpus dimensions
 * excluding random_seed when seeds differ solely due to cell_id hashing —
 * BUT the GO requires same random_seed. So we pair on dimensions except seed,
 * and require seeds equal when both present; if seeds differ, INVALID.
 *
 * Practical approach for matrix: pair on owner/mode/distribution/clients/threads/repetition/warmup/measured
 * and require identical random_seed. The runner should assign a shared pair_seed for W1/W2 cells
 * that share those dimensions so tax is computable.
 */
export function computeCellMatchedOutboxTax(results) {
  const w1s = results.filter((r) => r.workload === "W1_DOMAIN_ONLY");
  const w2s = results.filter((r) => r.workload === "W2_DOMAIN_PLUS_OUTBOX");
  /** @type {any[]} */
  const out = [];

  for (const w1 of w1s) {
    const candidates = w2s.filter(
      (w2) =>
        w2.owner === w1.owner &&
        w2.mode === w1.mode &&
        w2.distribution === w1.distribution &&
        w2.clients === w1.clients &&
        w2.threads === w1.threads &&
        w2.repetition === w1.repetition &&
        Number(w2.warmup_seconds) === Number(w1.warmup_seconds) &&
        Number(w2.measured_seconds) === Number(w1.measured_seconds),
    );
    // Prefer exact seed match; else first candidate (will fail equivalence if seeds differ)
    const w2 =
      candidates.find((c) => Number(c.random_seed) === Number(w1.random_seed)) ||
      candidates[0];

    if (!w2) {
      out.push({
        owner: w1.owner,
        mode: w1.mode,
        distribution: w1.distribution,
        clients: w1.clients,
        threads: w1.threads,
        repetition: w1.repetition,
        status: "INVALID",
        reason: "WORKLOAD_CONTRACT_MISMATCH",
        detail: "missing W2 peer",
        OUTBOX_DB_TAX_ABS: null,
        OUTBOX_DB_TAX_PERCENT: null,
        OUTBOX_TPS_TAX_PERCENT: null,
        w1_cell_id: w1.cell_id,
        w2_cell_id: null,
      });
      continue;
    }

    const eq = assertWorkloadEquivalence(w1, w2);
    if (!eq.ok) {
      out.push({
        owner: w1.owner,
        mode: w1.mode,
        distribution: w1.distribution,
        clients: w1.clients,
        threads: w1.threads,
        repetition: w1.repetition,
        status: "INVALID",
        reason: eq.reason,
        detail: eq.detail,
        OUTBOX_DB_TAX_ABS: null,
        OUTBOX_DB_TAX_PERCENT: null,
        OUTBOX_TPS_TAX_PERCENT: null,
        w1_cell_id: w1.cell_id,
        w2_cell_id: w2.cell_id,
      });
      continue;
    }

    const abs = w2.avg_latency_ms - w1.avg_latency_ms;
    const pct = w1.avg_latency_ms > 0 ? (w2.avg_latency_ms / w1.avg_latency_ms - 1) * 100 : null;
    const tpsTax =
      w1.tps != null && w2.tps != null && w1.tps > 0 ? (1 - w2.tps / w1.tps) * 100 : null;

    out.push({
      owner: w1.owner,
      mode: w1.mode,
      distribution: w1.distribution,
      clients: w1.clients,
      threads: w1.threads,
      repetition: w1.repetition,
      random_seed: w1.random_seed,
      status: "OK",
      reason: null,
      OUTBOX_DB_TAX_ABS: abs,
      OUTBOX_DB_TAX_PERCENT: pct,
      OUTBOX_TPS_TAX_PERCENT: tpsTax,
      w1_latency_ms: w1.avg_latency_ms,
      w2_latency_ms: w2.avg_latency_ms,
      w1_tps: w1.tps,
      w2_tps: w2.tps,
      w1_cell_id: w1.cell_id,
      w2_cell_id: w2.cell_id,
      match_key: matchKey(w1),
    });
  }

  return out;
}

export function summarizeOutboxTax(taxes) {
  const valid = taxes.filter((t) => t.status === "OK" && t.OUTBOX_DB_TAX_ABS != null);
  const invalid = taxes.filter((t) => t.status === "INVALID");
  const mean =
    valid.length === 0
      ? null
      : valid.reduce((s, t) => s + t.OUTBOX_DB_TAX_ABS, 0) / valid.length;
  const sorted = valid.map((t) => t.OUTBOX_DB_TAX_ABS).sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return {
    valid_pairs: valid.length,
    invalid_pairs: invalid.length,
    mean_abs_tax: mean,
    median_abs_tax: median,
    note: "Primary tax is cell-matched; mean/median are secondary summaries only",
  };
}
