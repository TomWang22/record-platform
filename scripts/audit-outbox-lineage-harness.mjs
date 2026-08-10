#!/usr/bin/env node
/**
 * Track C — independent outbox auditor (frozen inventory + lifecycle evidence only).
 *
 * No network, Kafka, SQL, subprocess, or service calls.
 * Does not authorize. Does not publish. Does not seed.
 * Canary-v3 may be cited only as auction-monitor evidence, never as Track C PASS.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertOutboxInventory,
  FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS,
  PUBLISHER_DISPOSITION_STATUSES,
  TRACK_C_EXPECTED_OWNER_COUNT,
} from "./lib/performance_track_c.mjs";
import {
  FROZEN_IDENTITY_FIELDS,
  LATENCY_BUCKETS,
  OutboxLifecycleEvidenceError,
  finalizeLifecycleEvidence,
  requiredLifecycleStatesForPass,
} from "./lib/outbox_lifecycle_evidence.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const TRACK_B_TERMINAL_SHA256 =
  "3d4d06245f0acde997bea77db4a9b32ab5be6563fc1979faeb71defe4ae569bb";

export function auditOutboxInventory(inventory) {
  const failures = [];
  try {
    assertOutboxInventory(inventory);
  } catch (err) {
    failures.push(...(err.failures || [String(err.message || err)]));
  }

  if (inventory?.canary_v3_is_platform_wide_pass === true) {
    failures.push("canary_v3_must_not_close_track_c_denominator");
  }

  const owners = inventory?.owners || inventory?.outboxes || [];
  for (const row of owners) {
    if (
      FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS.includes(row.database) ||
      FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS.includes(row.schema) ||
      String(row.table || "").startsWith("booking.") ||
      String(row.table || "").startsWith("social.")
    ) {
      failures.push(`TRACK_C_INVENTORY_INVALID:forbidden_owner:${row.table}`);
    }
    if (row.publisher_present === false) {
      const disposition = row.publisher_disposition;
      if (!disposition) {
        failures.push(`missing_publisher_disposition:${row.table}`);
        continue;
      }
      if (!PUBLISHER_DISPOSITION_STATUSES.includes(disposition.status)) {
        failures.push(`invalid_publisher_disposition:${row.table}:${disposition.status}`);
      }
      if (!disposition.reason || !String(disposition.reason).trim()) {
        failures.push(`empty_publisher_disposition_reason:${row.table}`);
      }
      if (!disposition.evidence || !String(disposition.evidence).trim()) {
        failures.push(`empty_publisher_disposition_evidence:${row.table}`);
      }
    }
  }

  const expected = inventory?.expected_count ?? inventory?.outboxes_expected;
  const discovered = inventory?.discovered_count ?? inventory?.outboxes_discovered;
  if (expected !== TRACK_C_EXPECTED_OWNER_COUNT) {
    failures.push(
      `expected_count_not_canonical:${expected}!=${TRACK_C_EXPECTED_OWNER_COUNT}`,
    );
  }
  const complete = expected === discovered && owners.length === discovered;
  if (!complete) failures.push("inventory_denominator_incomplete");

  return {
    pass: failures.length === 0,
    failures,
    expected_count: expected ?? null,
    discovered_count: discovered ?? null,
    complete,
  };
}

export function auditOutboxLifecycleEvidence(evidence) {
  const failures = [];
  if (evidence?.execution_authorized === true) {
    failures.push("execution_authorized_must_be_false");
  }
  if (evidence?.lifecycle_publish_executed === true) {
    failures.push("lifecycle_publish_executed_must_be_false");
  }
  if (!evidence?.outbox_table) failures.push("missing_outbox_table");
  if (!evidence?.run_id) failures.push("missing_run_id");
  if (!evidence?.row_key?.run_id || !evidence?.row_key?.event_id || !evidence?.row_key?.outbox_primary_key) {
    failures.push("missing_immutable_row_key");
  }

  const observed = new Set((evidence?.lifecycle_states_observed || []).map((s) => s.state));
  for (const state of requiredLifecycleStatesForPass()) {
    if (!observed.has(state)) failures.push(`missing_lifecycle_state:${state}`);
  }
  if (!observed.has("consumed")) failures.push("missing_consumer_receipt");
  if (!observed.has("offset_committed")) failures.push("missing_consumer_offset_commit");
  if (!observed.has("business_effect_applied")) {
    failures.push("missing_consumer_business_effect");
  }

  for (const field of FROZEN_IDENTITY_FIELDS) {
    if (evidence?.frozen_identity?.[field] == null) {
      failures.push(`missing_frozen_identity:${field}`);
    }
  }

  for (const bucket of LATENCY_BUCKETS) {
    const unknowns = evidence?.latency?.[bucket]?.unknowns ?? 0;
    if (unknowns !== 0) failures.push(`latency_unknown:${bucket}`);
  }

  if (failures.length) {
    return { pass: false, failures };
  }

  try {
    finalizeLifecycleEvidence(evidence);
  } catch (err) {
    const detail =
      err instanceof OutboxLifecycleEvidenceError ? err.failures || [err.message] : [String(err)];
    return { pass: false, failures: detail };
  }

  return { pass: true, failures: [] };
}

export function auditTrackCFrozenEvidence({ inventory, lifecycleEvidence = null } = {}) {
  const inventoryAudit = auditOutboxInventory(inventory);
  const failures = [...inventoryAudit.failures];

  let lifecycleAudit = null;
  if (lifecycleEvidence != null) {
    lifecycleAudit = auditOutboxLifecycleEvidence(lifecycleEvidence);
    failures.push(...lifecycleAudit.failures);
  }

  const owners = inventory?.owners || [];
  const acceptanceBlockers = owners.filter(
    (row) =>
      row.publisher_present === false &&
      row.publisher_disposition?.status === "MISSING_BLOCKS_ACCEPTANCE",
  );

  if (inventory?.canary_v3_is_platform_wide_pass === true) {
    failures.push("canary_v3_cited_as_platform_pass");
  }

  const inventoryOk = inventoryAudit.pass === true;
  const lifecycleOk =
    lifecycleEvidence == null ? true : lifecycleAudit?.pass === true;
  const harnessPass =
    inventoryOk &&
    lifecycleOk &&
    inventory?.execution_authorized === false &&
    inventory?.lifecycle_publish_executed !== true &&
    !failures.includes("canary_v3_cited_as_platform_pass");

  // Pre-authorization Track C never grants platform PASS.
  const platformPass = false;

  return {
    schema: "track-c-frozen-evidence-audit/v1",
    track: "C",
    harness_pass: harnessPass,
    inventory_denominator_pass: inventoryOk,
    lifecycle_pass: lifecycleEvidence == null ? null : lifecycleAudit.pass,
    platform_pass: platformPass,
    execution_authorized: false,
    lifecycle_publish_executed: false,
    canary_v3_is_platform_wide_pass: false,
    track_b_terminal_sha256_referenced:
      inventory?.track_b_terminal_sha256 === TRACK_B_TERMINAL_SHA256,
    missing_blocks_acceptance_count: acceptanceBlockers.length,
    acceptance_blockers: acceptanceBlockers.map((row) => row.table),
    failures: [...new Set(failures)],
    mutation_performed: false,
    network_calls: false,
  };
}

export function loadAndAuditEvidenceFile(path) {
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  if (evidence?.schema === "outbox-owner-inventory/v1" || evidence?.owners) {
    return auditTrackCFrozenEvidence({ inventory: evidence });
  }
  return auditOutboxLifecycleEvidence(evidence);
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "usage: audit-outbox-lineage-harness.mjs <inventory-or-lifecycle-evidence.json>",
    );
    process.exit(2);
  }
  const result = loadAndAuditEvidenceFile(path);
  console.log(JSON.stringify(result, null, 2));

  if (result.pass === true) {
    process.exit(0);
  }
  if (result.inventory_denominator_pass === true && result.harness_pass === true) {
    // Denominator closed; platform_pass remains false by design.
    process.exit(0);
  }
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { REPO, TRACK_B_TERMINAL_SHA256 };
