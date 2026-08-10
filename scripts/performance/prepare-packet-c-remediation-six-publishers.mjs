#!/usr/bin/env node

/**
 * Prepare non-live Packet C publisher-remediation readiness packet.
 *
 * Targets only remaining PUBLISHER_BLOCKED owners. Does not authorize, publish, or seed.
 * Acceptance denominator remains the frozen 12-owner Track C set.
 *
 * Pins both data artifacts and source/test/generator implementation digests so
 * the PREPARED freeze cannot silently drift after validation.
 *
 * After media publisher remediation: remaining blocked = 5 (messaging…trust).
 * Pre-media freeze 288fd8aa… is obsolete and must never be authorized.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  OBSOLETE_INVENTORY_SHA256,
  TRACK_C_CANONICAL_INVENTORY_SHA256,
  TRACK_C_EXPECTED_OWNER_COUNT,
} from "../lib/performance_track_c.mjs";
import {
  assertTrackCReadinessMatrix,
  assertTrackCRemediationPacket,
} from "../lib/track_c_inventory_guards.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const INVENTORY_REL =
  "reports/performance/outbox-owner-inventory.PREPARED.json";
const DENOM_REL =
  "reports/performance/live-evidence/track-c/TRACK_C_INVENTORY_DENOMINATOR.json";
const MATRIX_REL =
  "reports/performance/live-evidence/track-c/PACKET_C_READINESS_MATRIX.json";
const OUT_REL =
  "reports/performance/live-evidence/owner-packets/PACKET_C_REMEDIATION_SIX_PUBLISHERS.PREPARED.json";

const EXPECTED_DENOM_SHA256 =
  "065f0c7832531f9f32fae36a14d6e67868c5c1be08b2b2171e0cbd8c5d818ac6";
const EXPECTED_MATRIX_SHA256 =
  "b15959513b5e728be8679a2dc85c17eeaf02ab02f4ba932f3a2b571b3cb349ec";

/** Prior remediation PREPARED freezes — never authorize against these. */
export const OBSOLETE_REMEDIATION_PREPARED_SHA256 = Object.freeze([
  // data-only pins (missing source/test/generator pins)
  "91c033c997e3f3c8ab56a0594165bc814a1892e043839f9df3e01aad6e2fb9b8",
  // data pins present, still missing source/test/generator pins
  "c3c432b91001967eceec651f7b2e201576e1f442a3ccbf256fa01c2c63da77f6",
  // pre-media source-pinned freeze (6 blocked)
  "288fd8aa40f22634acd087a2b2192ddb459beb07412bfa2a58be2e1e7872b694",
  // post-media but claim-released-before-send / default-on gaps
  "6fbc2410995cc409cb9e3a06f7474ab87216e23f7e77db3e5f9f16531cf9f905",
]);

const SOURCE_PIN_PATHS = Object.freeze({
  track_c_inventory_guards_mjs: "scripts/lib/track_c_inventory_guards.mjs",
  performance_track_c_mjs: "scripts/lib/performance_track_c.mjs",
  prepare_packet_c_remediation_mjs:
    "scripts/performance/prepare-packet-c-remediation-six-publishers.mjs",
  build_packet_c_readiness_matrix_mjs:
    "scripts/performance/build-packet-c-readiness-matrix.mjs",
  freeze_track_c_inventory_denominator_mjs:
    "scripts/performance/freeze-track-c-inventory-denominator.mjs",
  build_outbox_inventory_mjs: "scripts/performance/build-outbox-inventory.mjs",
  track_c_inventory_guards_test_mjs: "tests/track-c-inventory-guards.test.mjs",
  track_c_inventory_denominator_freeze_test_mjs:
    "tests/track-c-inventory-denominator-freeze.test.mjs",
  outbox_owner_inventory_test_mjs: "tests/outbox-owner-inventory.test.mjs",
  media_outbox_publisher_ts:
    "services/media-service/src/outbox/publishOutbox.ts",
  media_outbox_publisher_test_ts:
    "services/media-service/tests/media-outbox-publisher.test.ts",
});

const EXPECTED_BLOCKED = Object.freeze([
  "messaging.outbox_events",
  "notification.outbox_events",
  "records.outbox_events",
  "shopping.outbox_events",
  "trust.outbox_events",
]);

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

function collectSourcePins() {
  const pins = {};
  for (const [key, rel] of Object.entries(SOURCE_PIN_PATHS)) {
    if (!existsSync(join(REPO, rel))) {
      throw new Error(`source_pin_path_missing:${rel}`);
    }
    pins[key] = shaFile(rel);
  }
  return pins;
}

function main() {
  for (const rel of [INVENTORY_REL, DENOM_REL, MATRIX_REL]) {
    if (!existsSync(join(REPO, rel))) {
      throw new Error(`required_artifact_missing:${rel}`);
    }
  }

  const inventorySha = shaFile(INVENTORY_REL);
  const denomSha = shaFile(DENOM_REL);
  const matrixSha = shaFile(MATRIX_REL);
  const sourcePins = collectSourcePins();

  if (inventorySha !== TRACK_C_CANONICAL_INVENTORY_SHA256) {
    throw new Error(`inventory_sha_mismatch:${inventorySha}`);
  }
  if (denomSha !== EXPECTED_DENOM_SHA256) {
    throw new Error(`denominator_sha_mismatch:${denomSha}`);
  }
  if (matrixSha !== EXPECTED_MATRIX_SHA256) {
    throw new Error(`readiness_matrix_sha_mismatch:${matrixSha}`);
  }
  if (OBSOLETE_INVENTORY_SHA256.includes(inventorySha)) {
    throw new Error(`obsolete_inventory_sha_not_allowed:${inventorySha}`);
  }

  const denom = JSON.parse(readFileSync(join(REPO, DENOM_REL), "utf8"));
  const expectedTables = [...(denom.canonical_owners || [])].sort();
  const matrix = JSON.parse(readFileSync(join(REPO, MATRIX_REL), "utf8"));
  assertTrackCReadinessMatrix({
    matrix,
    expectedTables,
    expectedOwnerCount: TRACK_C_EXPECTED_OWNER_COUNT,
  });

  const blocked = [...matrix.partitions.publisher_blocked].sort();
  if (JSON.stringify(blocked) !== JSON.stringify([...EXPECTED_BLOCKED].sort())) {
    throw new Error(`publisher_blocked_set_drift:${blocked.join(",")}`);
  }

  const remediationTargets = matrix.owners
    .filter((row) => blocked.includes(row.table))
    .map((row) => ({
      table: row.table,
      database: row.database,
      service: row.service,
      publisher_owner: row.publisher_owner,
      readiness: row.readiness,
      publisher_disposition_status: row.publisher_disposition_status,
      required_for_track_c_acceptance: true,
      remediation_in_scope: true,
      live_publish_authorized: false,
    }))
    .sort((a, b) => a.table.localeCompare(b.table));

  if (remediationTargets.length !== 5) {
    throw new Error(`remediation_target_count_not_5:${remediationTargets.length}`);
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const payload = {
    schema: "packet-c-remediation-six-publishers/v1",
    packet_id: "PACKET_C_REMEDIATION_SIX_PUBLISHERS",
    status: "PREPARED_NON_LIVE",
    execution_authorized: false,
    load_testing_authorized: false,
    lifecycle_publish_executed: false,
    platform_pass: false,
    track_c_acceptance_pass: false,
    emitted_at_utc: now,
    purpose:
      "Remediation/observation readiness for remaining PUBLISHER_BLOCKED canonical outboxes (media publisher present; 5 blocked remain)",
    pins: {
      inventory_sha256: TRACK_C_CANONICAL_INVENTORY_SHA256,
      inventory_denominator_sha256: EXPECTED_DENOM_SHA256,
      readiness_matrix_sha256: EXPECTED_MATRIX_SHA256,
      track_b_terminal_sha256:
        "3d4d06245f0acde997bea77db4a9b32ab5be6563fc1979faeb71defe4ae569bb",
      source: sourcePins,
    },
    acceptance_denominator_count: TRACK_C_EXPECTED_OWNER_COUNT,
    acceptance_denominator_tables: [...expectedTables],
    remediation_target_count: 5,
    remediation_targets: remediationTargets,
    not_in_remediation_scope: {
      lifecycle_executable: [...matrix.partitions.lifecycle_executable].sort(),
      migration_pending: [...matrix.partitions.migration_pending].sort(),
      note:
        "auth.outbox_events remains MIGRATION_PENDING; media.outbox_events is LIFECYCLE_EXECUTABLE with lock-through-ack publisher (MEDIA_OUTBOX_PUBLISHER===1 opt-in; live still unauthorized)",
    },
    hard_rules: [
      "acceptance_denominator_remains_12",
      "remediation_packet_must_not_redefine_track_c_acceptance_denominator",
      "terminal_track_c_pass_requires_lifecycle_closure_and_unknowns_0_for_all_12",
      "booking_and_social_forbidden",
      "no_live_publish_without_separate_authorization",
      "source_and_test_pins_required",
      "do_not_authorize_obsolete_prepared_288fd8aa",
      "do_not_authorize_obsolete_prepared_6fbc2410",
    ],
    obsolete_inventory_sha256: [...OBSOLETE_INVENTORY_SHA256],
    obsolete_prepared_sha256: [...OBSOLETE_REMEDIATION_PREPARED_SHA256],
    explicitly_excluded: [
      "packet_c_authorization",
      "live_outbox_publish",
      "seed_mutation",
      "include_auth_outbox_events_as_blocked",
      "include_lifecycle_executable_owners",
      "narrow_acceptance_denominator_to_six",
      "authorize_obsolete_prepared_91c033c9",
      "authorize_obsolete_prepared_c3c432b9",
      "authorize_obsolete_prepared_288fd8aa",
      "authorize_obsolete_prepared_6fbc2410",
    ],
    next_boundary:
      "IMPLEMENT_REMAINING_FIVE_PUBLISHERS_ONE_TABLE_AT_A_TIME_STARTING_MESSAGING_NO_LIVE_PUBLISH",
  };

  assertTrackCRemediationPacket({
    packet: payload,
    matrix,
    expectedTables,
    expectedOwnerCount: TRACK_C_EXPECTED_OWNER_COUNT,
    expectedSourcePins: sourcePins,
    obsoletePreparedSha256: OBSOLETE_REMEDIATION_PREPARED_SHA256,
  });

  const digest = writeJsonSorted(OUT_REL, payload);
  if (OBSOLETE_REMEDIATION_PREPARED_SHA256.includes(digest)) {
    throw new Error(`prepared_sha_collides_with_obsolete:${digest}`);
  }

  console.log(
    JSON.stringify(
      {
        path: OUT_REL,
        prepared_sha256: digest,
        remediation_target_count: 5,
        acceptance_denominator_count: 12,
        readiness_matrix_sha256: EXPECTED_MATRIX_SHA256,
        source_pin_count: Object.keys(sourcePins).length,
        obsolete_prepared_sha256: [...OBSOLETE_REMEDIATION_PREPARED_SHA256],
        execution_authorized: false,
        platform_pass: false,
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
