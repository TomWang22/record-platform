#!/usr/bin/env node

/**
 * Non-live Packet C readiness matrix for all 12 canonical Track C owners.
 *
 * Does not authorize. Does not publish. Does not seed.
 * Acceptance denominator remains 12 — never narrowed to the six publisher blockers.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertOutboxInventory,
  OBSOLETE_INVENTORY_SHA256,
  TRACK_C_CANONICAL_INVENTORY_SHA256,
  TRACK_C_EXPECTED_OWNER_COUNT,
} from "../lib/performance_track_c.mjs";
import { assertTrackCReadinessMatrix } from "../lib/track_c_inventory_guards.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const INVENTORY_REL =
  "reports/performance/outbox-owner-inventory.PREPARED.json";
const DENOM_REL =
  "reports/performance/live-evidence/track-c/TRACK_C_INVENTORY_DENOMINATOR.json";
const OUT_REL =
  "reports/performance/live-evidence/track-c/PACKET_C_READINESS_MATRIX.json";

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function shaFile(rel) {
  return sha256Bytes(readFileSync(join(REPO, rel)));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

function writeJsonSorted(rel, value) {
  const path = join(REPO, rel);
  mkdirSync(dirname(path), { recursive: true });
  const raw = `${JSON.stringify(sortKeys(value), null, 2)}\n`;
  writeFileSync(path, raw);
  const digest = sha256Bytes(Buffer.from(raw));
  writeFileSync(`${path}.sha256`, `${digest}\n`);
  return digest;
}

function classifyOwner(row) {
  if (row.publisher_present === true) {
    return {
      readiness: "LIFECYCLE_EXECUTABLE",
      packet_c_observation_eligible: true,
      blocks_track_c_acceptance: false,
      reason: "Publisher present; non-live lifecycle evidence may be prepared for this owner",
    };
  }
  const status = row.publisher_disposition?.status;
  if (status === "MIGRATION_PENDING") {
    return {
      readiness: "MIGRATION_PENDING",
      packet_c_observation_eligible: false,
      blocks_track_c_acceptance: true,
      reason:
        "Canonical table unwired; active publisher uses a different table — not live-executable until migration disposition resolves",
    };
  }
  if (status === "MISSING_BLOCKS_ACCEPTANCE") {
    return {
      readiness: "PUBLISHER_BLOCKED",
      packet_c_observation_eligible: false,
      blocks_track_c_acceptance: true,
      reason: "Missing publisher blocks Track C acceptance for this canonical owner",
    };
  }
  return {
    readiness: "UNCLASSIFIED",
    packet_c_observation_eligible: false,
    blocks_track_c_acceptance: true,
    reason: `Unexpected publisher disposition:${status}`,
  };
}

function main() {
  if (!existsSync(join(REPO, INVENTORY_REL))) {
    throw new Error(`inventory_missing:${INVENTORY_REL}`);
  }
  if (!existsSync(join(REPO, DENOM_REL))) {
    throw new Error(`inventory_denominator_freeze_missing:${DENOM_REL}`);
  }

  const inventorySha = shaFile(INVENTORY_REL);
  if (inventorySha !== TRACK_C_CANONICAL_INVENTORY_SHA256) {
    throw new Error(
      `inventory_sha_mismatch:${inventorySha}!=${TRACK_C_CANONICAL_INVENTORY_SHA256}`,
    );
  }
  if (OBSOLETE_INVENTORY_SHA256.includes(inventorySha)) {
    throw new Error(`obsolete_inventory_sha_not_allowed:${inventorySha}`);
  }

  const inventory = JSON.parse(readFileSync(join(REPO, INVENTORY_REL), "utf8"));
  assertOutboxInventory(inventory);
  if (inventory.owners.length !== TRACK_C_EXPECTED_OWNER_COUNT) {
    throw new Error(`owner_count_not_12:${inventory.owners.length}`);
  }

  const denom = JSON.parse(readFileSync(join(REPO, DENOM_REL), "utf8"));
  if (denom.inventory_sha256 !== inventorySha) {
    throw new Error("denominator_inventory_sha_drift");
  }
  if (denom.acceptance_denominator_count !== 12) {
    throw new Error("acceptance_denominator_not_12");
  }
  const expectedTables = [...(denom.canonical_owners || [])].sort();
  if (expectedTables.length !== TRACK_C_EXPECTED_OWNER_COUNT) {
    throw new Error(`denominator_canonical_owners_count:${expectedTables.length}`);
  }

  const rows = inventory.owners
    .map((owner) => {
      const classification = classifyOwner(owner);
      return {
        table: owner.table,
        database: owner.database,
        service: owner.service,
        publisher_owner: owner.publisher_owner,
        publisher_present: owner.publisher_present,
        publisher_disposition_status: owner.publisher_disposition?.status ?? null,
        topic: owner.topic,
        status_predicate: owner.status_predicate,
        required_for_track_c_acceptance: true,
        ...classification,
      };
    })
    .sort((a, b) => a.table.localeCompare(b.table));

  if (rows.length !== 12) {
    throw new Error(`matrix_row_count_not_12:${rows.length}`);
  }

  const executable = rows.filter((r) => r.readiness === "LIFECYCLE_EXECUTABLE");
  const migrationPending = rows.filter((r) => r.readiness === "MIGRATION_PENDING");
  const publisherBlocked = rows.filter((r) => r.readiness === "PUBLISHER_BLOCKED");
  const unclassified = rows.filter((r) => r.readiness === "UNCLASSIFIED");

  if (unclassified.length) {
    throw new Error(`unclassified_owners:${unclassified.map((r) => r.table).join(",")}`);
  }
  if (executable.length + migrationPending.length + publisherBlocked.length !== 12) {
    throw new Error("readiness_partition_incomplete");
  }
  if (publisherBlocked.length !== 5) {
    throw new Error(`publisher_blocked_count_not_5:${publisherBlocked.length}`);
  }
  if (executable.length !== 6) {
    throw new Error(`lifecycle_executable_count_not_6:${executable.length}`);
  }
  if (migrationPending.length !== 1) {
    throw new Error(`migration_pending_count_not_1:${migrationPending.length}`);
  }

  assertTrackCReadinessMatrix({
    matrix: {
      partitions: {
        lifecycle_executable: executable.map((r) => r.table),
        migration_pending: migrationPending.map((r) => r.table),
        publisher_blocked: publisherBlocked.map((r) => r.table),
      },
      counts: {
        lifecycle_executable: executable.length,
        migration_pending: migrationPending.length,
        publisher_blocked: publisherBlocked.length,
      },
      acceptance_denominator_count: 12,
      acceptance_denominator_tables: rows.map((r) => r.table),
      owners: rows,
      execution_authorized: false,
      platform_pass: false,
      track_c_acceptance_pass: false,
    },
    expectedTables,
    expectedOwnerCount: TRACK_C_EXPECTED_OWNER_COUNT,
  });

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const payload = {
    schema: "packet-c-readiness-matrix/v1",
    packet_id: "PACKET_C_READINESS_MATRIX",
    status: "PREPARED_NON_LIVE",
    execution_authorized: false,
    load_testing_authorized: false,
    lifecycle_publish_executed: false,
    platform_pass: false,
    track_c_acceptance_pass: false,
    emitted_at_utc: now,
    source_inventory_sha256: inventorySha,
    source_inventory_denominator_sha256: shaFile(DENOM_REL),
    acceptance_denominator_count: 12,
    acceptance_denominator_tables: rows.map((r) => r.table),
    counts: {
      canonical_owners: 12,
      lifecycle_executable: executable.length,
      migration_pending: migrationPending.length,
      publisher_blocked: publisherBlocked.length,
      observation_eligible: executable.length,
      acceptance_blockers: migrationPending.length + publisherBlocked.length,
    },
    partitions: {
      lifecycle_executable: executable.map((r) => r.table),
      migration_pending: migrationPending.map((r) => r.table),
      publisher_blocked: publisherBlocked.map((r) => r.table),
    },
    owners: rows,
    remediation_packet_note:
      "A six-service remediation/observation packet may target publisher_blocked owners only, but Track C terminal acceptance must still account for all 12 canonical outboxes.",
    obsolete_inventory_sha256: [...OBSOLETE_INVENTORY_SHA256],
    explicitly_excluded: [
      "packet_c_authorization",
      "live_outbox_publish",
      "seed_mutation",
      "acceptance_denominator_equals_six_blockers",
      "booking_or_social_targets",
    ],
    next_boundary: "NO_PACKET_C_AUTH_UNTIL_OWNER_EXPLICITLY_AUTHORIZES",
  };

  const digest = writeJsonSorted(OUT_REL, payload);
  console.log(
    JSON.stringify(
      {
        path: OUT_REL,
        packet_c_readiness_matrix_sha256: digest,
        acceptance_denominator_count: 12,
        lifecycle_executable: executable.length,
        migration_pending: migrationPending.length,
        publisher_blocked: publisherBlocked.length,
        platform_pass: false,
        execution_authorized: false,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
