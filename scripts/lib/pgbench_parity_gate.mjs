/**
 * Fail-closed gate for scripts/performance/run-pgbench-matrix.mjs.
 * Missing / malformed / stale parity evidence must never default-allow.
 */

export const PGBENCH_BLOCKED = "PGBENCH_EXECUTION_BLOCKED";

const CANONICAL_TABLES = [
  "ai.outbox_events",
  "analytics.outbox_events",
  "auction_monitor.outbox_events",
  "auth.outbox_events",
  "listings.outbox_events",
  "media.outbox_events",
  "messaging.outbox_events",
  "notification.outbox_events",
  "records.outbox_events",
  "shopping.outbox_events",
  "trust.outbox_events",
];

/**
 * @param {unknown} parity
 * @returns {{ allowed: boolean, reasons: string[] }}
 */
export function evaluatePgbenchParityGate(parity) {
  const reasons = [];

  if (parity === null || typeof parity !== "object" || Array.isArray(parity)) {
    return { allowed: false, reasons: ["artifact_missing_or_malformed"] };
  }

  const doc = /** @type {Record<string, unknown>} */ (parity);

  if (doc.schema !== "record-platform-outbox-publisher-parity/v1") {
    reasons.push(`schema=${String(doc.schema)} (required record-platform-outbox-publisher-parity/v1)`);
  }
  if (doc.status !== "PARITY_PASS") {
    reasons.push(`status=${String(doc.status)} (required PARITY_PASS; AUDIT_DRAFT/stale is blocked)`);
  }

  const acceptance =
    doc.acceptance && typeof doc.acceptance === "object" && !Array.isArray(doc.acceptance)
      ? /** @type {Record<string, unknown>} */ (doc.acceptance)
      : null;
  if (!acceptance) {
    reasons.push("acceptance_missing");
  } else {
    if (Number(acceptance.canonical_owner_count) !== 11) {
      reasons.push(`canonical_owner_count=${String(acceptance.canonical_owner_count)} (required 11)`);
    }
    if (Number(acceptance.parity_pass_count) !== 11) {
      reasons.push(
        `parity_pass_count=${String(acceptance.parity_pass_count)} (required 11). Do not begin pgbench before publisher parity is green.`,
      );
    }
    if (Number(acceptance.unknowns) !== 0) {
      reasons.push(`unknowns=${String(acceptance.unknowns)} (required 0)`);
    }
  }

  const rows = Array.isArray(doc.rows) ? doc.rows : null;
  if (!rows) {
    reasons.push("rows_missing");
  } else {
    const tables = rows.map((row) =>
      row && typeof row === "object" ? /** @type {Record<string, unknown>} */ (row).table : undefined,
    );
    const sorted = [...tables].map(String).sort();
    if (sorted.length !== 11 || sorted.join("\0") !== [...CANONICAL_TABLES].sort().join("\0")) {
      reasons.push("canonical_rows_not_exactly_11_owners");
    }
    const nonPass = rows.filter(
      (row) =>
        !(row && typeof row === "object") ||
        /** @type {Record<string, unknown>} */ (row).status !== "PASS",
    );
    if (nonPass.length > 0) {
      reasons.push(`row_status_not_all_PASS (${nonPass.length})`);
    }
  }

  const supplemental =
    doc.supplemental && typeof doc.supplemental === "object" && !Array.isArray(doc.supplemental)
      ? /** @type {Record<string, unknown>} */ (doc.supplemental)
      : null;
  if (!supplemental || supplemental.table !== "auth.auth_outbox") {
    reasons.push("supplemental_auth.auth_outbox_missing");
  } else if (supplemental.parity_required !== false) {
    reasons.push("supplemental_auth.auth_outbox_parity_required_must_be_false");
  }

  if (doc.execution_authorized !== false) {
    reasons.push(
      "execution_authorized must be false (live-enablement leak; pgbench must not treat that as a GO)",
    );
  }
  if (doc.track_c_acceptance_pass !== false) {
    reasons.push("track_c_acceptance_pass must be false");
  }
  if (doc.pgbench_execution_authorized !== true) {
    reasons.push(
      "pgbench_execution_authorized=false (explicit later GO required even after parity is green)",
    );
  }

  return { allowed: reasons.length === 0, reasons };
}
