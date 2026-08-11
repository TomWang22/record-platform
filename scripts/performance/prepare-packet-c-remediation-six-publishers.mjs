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
 * After trust publisher remediation: remaining blocked = 0.
 * Post-shopping freeze 7176a934… is obsolete and must never be authorized.
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
  "1b614ba485e03bddf7bcf296c9bf0c89fee97b7013e9f034d8fdc7ea77079074";
const EXPECTED_MATRIX_SHA256 =
  "e2908e28e468229b8609e9a726d0ae22875be6032d9bbdf0888510300dffae2b";

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
  // post-media lock-through-ack; pre-messaging Phase B (5 blocked)
  "3c679ecde42b800ddefa77a85ca9399562bc0be292dd6cc448cc83fb59b153de",
  // post-messaging Phase B; pre-notification Phase B (4 blocked)
  "9efd0a0333741909d6b4b75256973bbb4035a18709e69d4a6441d07487edb1e7",
  // post-notification Phase B; pre-records Phase B (3 blocked)
  "ca9a35c7a97d660878837b46cc2c4a4828c4a1d3c1ca972b827bfc08ff349f46",
  // post-records Phase B; pre-shopping Phase B (2 blocked)
  "380993598d3f2d419a54eec5fbb43e7562bdd5b30cc94f130d2a98d66806a7e9",
  // post-shopping Phase B; pre-trust Phase B (1 blocked)
  "7176a934cdf80152c57d9a336e57898983833c20b476637dbcf1a0f9b7ee312f",
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
  messaging_outbox_publisher_ts:
    "services/messaging-service/src/outbox/publishOutbox.ts",
  messaging_message_outbox_ts:
    "services/messaging-service/src/application/messageOutbox.ts",
  messaging_outbox_publisher_test_ts:
    "services/messaging-service/tests/messaging-outbox-publisher.test.ts",
  messaging_message_outbox_test_ts:
    "services/messaging-service/tests/messaging-message-outbox.test.ts",
  notification_outbox_publisher_ts:
    "services/notification-service/src/outbox/publishOutbox.ts",
  notification_outbox_enqueue_ts:
    "services/notification-service/src/outbox/enqueueOutbox.ts",
  notification_message_outbox_ts:
    "services/notification-service/src/application/notificationOutbox.ts",
  notification_kafka_events_ts:
    "services/notification-service/src/notificationKafkaEvents.ts",
  notification_outbox_publisher_test_ts:
    "services/notification-service/tests/notification-outbox-publisher.test.ts",
  notification_message_outbox_test_ts:
    "services/notification-service/tests/notification-message-outbox.test.ts",
  records_outbox_publisher_ts:
    "services/records-service/src/outbox/publishOutbox.ts",
  records_outbox_enqueue_ts:
    "services/records-service/src/outbox/enqueueOutbox.ts",
  records_message_outbox_ts:
    "services/records-service/src/application/recordOutbox.ts",
  records_kafka_events_ts:
    "services/records-service/src/recordsKafkaEvents.ts",
  records_outbox_publisher_test_ts:
    "services/records-service/tests/records-outbox-publisher.test.ts",
  records_message_outbox_test_ts:
    "services/records-service/tests/records-message-outbox.test.ts",
  shopping_outbox_publisher_ts:
    "services/shopping-service/src/outbox/publishOutbox.ts",
  shopping_outbox_enqueue_ts:
    "services/shopping-service/src/outbox/enqueueOutbox.ts",
  shopping_message_outbox_ts:
    "services/shopping-service/src/application/shoppingOutbox.ts",
  shopping_kafka_events_ts:
    "services/shopping-service/src/shoppingKafkaEvents.ts",
  shopping_outbox_publisher_test_ts:
    "services/shopping-service/tests/shopping-outbox-publisher.test.ts",
  shopping_message_outbox_test_ts:
    "services/shopping-service/tests/shopping-message-outbox.test.ts",
  trust_outbox_publisher_ts:
    "services/trust-service/src/outbox/publishOutbox.ts",
  trust_outbox_enqueue_ts:
    "services/trust-service/src/outbox/enqueueOutbox.ts",
  trust_message_outbox_ts:
    "services/trust-service/src/application/trustOutbox.ts",
  trust_kafka_events_ts:
    "services/trust-service/src/trustKafkaEvents.ts",
  trust_outbox_publisher_test_ts:
    "services/trust-service/tests/trust-outbox-publisher.test.ts",
  trust_message_outbox_test_ts:
    "services/trust-service/tests/trust-message-outbox.test.ts",
  trust_outbox_wiring_test_ts:
    "services/trust-service/tests/trust-outbox-wiring.test.ts",
});

const EXPECTED_BLOCKED = Object.freeze([]);

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

  if (remediationTargets.length !== 0) {
    throw new Error(`remediation_target_count_not_0:${remediationTargets.length}`);
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
      "Remediation/observation readiness for remaining PUBLISHER_BLOCKED canonical outboxes (trust+shopping+records+notification+messaging+media publishers present; 0 blocked remains)",
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
    remediation_target_count: 0,
    remediation_targets: remediationTargets,
    not_in_remediation_scope: {
      lifecycle_executable: [...matrix.partitions.lifecycle_executable].sort(),
      migration_pending: [...matrix.partitions.migration_pending].sort(),
      note:
        "auth.outbox_events remains MIGRATION_PENDING; trust/shopping/records/media/messaging/notification.outbox_events are LIFECYCLE_EXECUTABLE with lock-through-ack publishers (opt-in env===1; live still unauthorized)",
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
      "do_not_authorize_obsolete_prepared_3c679ecd",
      "do_not_authorize_obsolete_prepared_9efd0a03",
      "do_not_authorize_obsolete_prepared_ca9a35c7",
      "do_not_authorize_obsolete_prepared_38099359",
      "do_not_authorize_obsolete_prepared_7176a934",
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
      "authorize_obsolete_prepared_3c679ecd",
      "authorize_obsolete_prepared_9efd0a03",
      "authorize_obsolete_prepared_ca9a35c7",
      "authorize_obsolete_prepared_38099359",
      "authorize_obsolete_prepared_7176a934",
    ],
    next_boundary:
      "STOP_NO_AUTH_NO_LIVE_PUBLISH",
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
        remediation_target_count: 0,
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
