#!/usr/bin/env node

/**
 * Freeze Track C inventory denominator (discovery only; not Track C acceptance).
 *
 * Does not authorize. Does not publish. Does not seed.
 * Binds the corrected 12/12 inventory SHA and rejects obsolete 14/14 artifacts.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertOutboxInventory,
  FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS,
  OBSOLETE_INVENTORY_SHA256,
  TRACK_C_CANONICAL_INVENTORY_SHA256,
  TRACK_C_EXPECTED_OWNER_COUNT,
} from "../lib/performance_track_c.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const INVENTORY_REL =
  "reports/performance/outbox-owner-inventory.PREPARED.json";
const TRACK_B_TERMINAL_REL =
  "reports/performance/live-evidence/track-b/TRACK_B_TERMINAL.json";
const OUT_REL =
  "reports/performance/live-evidence/track-c/TRACK_C_INVENTORY_DENOMINATOR.json";

const TRACK_B_TERMINAL_SHA256 =
  "3d4d06245f0acde997bea77db4a9b32ab5be6563fc1979faeb71defe4ae569bb";

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

function main() {
  if (!existsSync(join(REPO, INVENTORY_REL))) {
    throw new Error(`inventory_missing:${INVENTORY_REL}`);
  }
  if (!existsSync(join(REPO, TRACK_B_TERMINAL_REL))) {
    throw new Error(`track_b_terminal_missing:${TRACK_B_TERMINAL_REL}`);
  }

  const inventorySha = shaFile(INVENTORY_REL);
  const trackBSha = shaFile(TRACK_B_TERMINAL_REL);

  if (inventorySha !== TRACK_C_CANONICAL_INVENTORY_SHA256) {
    throw new Error(
      `inventory_sha_mismatch:${inventorySha}!=${TRACK_C_CANONICAL_INVENTORY_SHA256}`,
    );
  }
  if (OBSOLETE_INVENTORY_SHA256.includes(inventorySha)) {
    throw new Error(`obsolete_inventory_sha_not_allowed:${inventorySha}`);
  }
  if (trackBSha !== TRACK_B_TERMINAL_SHA256) {
    throw new Error(`track_b_terminal_sha_mismatch:${trackBSha}`);
  }

  const inventory = JSON.parse(readFileSync(join(REPO, INVENTORY_REL), "utf8"));
  assertOutboxInventory(inventory);

  if (inventory.expected_count !== TRACK_C_EXPECTED_OWNER_COUNT) {
    throw new Error("expected_count_not_12");
  }
  if (inventory.discovered_count !== TRACK_C_EXPECTED_OWNER_COUNT) {
    throw new Error("discovered_count_not_12");
  }
  if (inventory.complete !== true) {
    throw new Error("inventory_not_complete");
  }
  if (inventory.owners.length !== 12) {
    throw new Error(`owner_count_not_12:${inventory.owners.length}`);
  }
  if (inventory.owners.length === 14) {
    throw new Error("TRACK_C_INVENTORY_INVALID:fourteen_owner_artifact");
  }

  for (const row of inventory.owners) {
    if (FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS.includes(row.database)) {
      throw new Error(`TRACK_C_INVENTORY_INVALID:forbidden_owner:${row.table}`);
    }
  }

  const owners = inventory.owners.map((row) => ({
    table: row.table,
    database: row.database,
    service: row.service,
    publisher_owner: row.publisher_owner,
    publisher_present: row.publisher_present,
    publisher_disposition_status: row.publisher_disposition?.status ?? null,
  }));

  const acceptanceBlockers = owners
    .filter((o) => o.publisher_disposition_status === "MISSING_BLOCKS_ACCEPTANCE")
    .map((o) => o.table)
    .sort();
  const migrationPending = owners
    .filter((o) => o.publisher_disposition_status === "MIGRATION_PENDING")
    .map((o) => o.table)
    .sort();
  const lifecycleExecutable = owners
    .filter((o) => o.publisher_present === true)
    .map((o) => o.table)
    .sort();

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const payload = {
    schema: "track-c-inventory-denominator/v1",
    track: "C",
    freeze_kind: "INVENTORY_DENOMINATOR_ONLY",
    verdict: "INVENTORY_DENOMINATOR_PASS",
    platform_pass: false,
    track_c_acceptance_pass: false,
    execution_authorized: false,
    lifecycle_publish_executed: false,
    emitted_at_utc: now,
    inventory_path: INVENTORY_REL,
    inventory_sha256: inventorySha,
    track_b_terminal_sha256: trackBSha,
    expected_count: 12,
    discovered_count: 12,
    complete: true,
    inventory_denominator_pass: true,
    acceptance_denominator_count: 12,
    acceptance_denominator_note:
      "Track C terminal acceptance must account for all 12 canonical outboxes; a six-blocker remediation packet must not redefine the acceptance denominator.",
    canonical_owners: owners.map((o) => o.table).sort(),
    owners,
    lifecycle_executable_owners: lifecycleExecutable,
    lifecycle_executable_count: lifecycleExecutable.length,
    migration_pending_owners: migrationPending,
    missing_blocks_acceptance_owners: acceptanceBlockers,
    missing_blocks_acceptance_count: acceptanceBlockers.length,
    forbidden_nonexistent_services: {
      booking: "FORBIDDEN_NONEXISTENT_SERVICE",
      social: "FORBIDDEN_NONEXISTENT_SERVICE",
      inventory_status: "ABSENT_BY_CONTRACT",
    },
    obsolete_inventory_sha256: [...OBSOLETE_INVENTORY_SHA256],
    explicitly_excluded: [
      "packet_c_authorization",
      "live_outbox_publish",
      "seed_mutation",
      "reinterpret_14_owner_inventory_as_pass",
      "narrow_acceptance_denominator_to_six_blockers",
    ],
    next_boundary: "PACKET_C_READINESS_MATRIX_THEN_NO_LIVE_UNTIL_AUTHORIZED",
  };

  const digest = writeJsonSorted(OUT_REL, payload);
  console.log(
    JSON.stringify(
      {
        path: OUT_REL,
        track_c_inventory_denominator_sha256: digest,
        inventory_sha256: inventorySha,
        expected_count: 12,
        discovered_count: 12,
        platform_pass: false,
        track_c_acceptance_pass: false,
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
