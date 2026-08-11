import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertOutboxInventory,
  OBSOLETE_INVENTORY_SHA256,
  TRACK_C_CANONICAL_INVENTORY_SHA256,
  buildPreparedOutboxInventory,
} from "../scripts/lib/performance_track_c.mjs";
import {
  assertObsoleteInventoryDigests,
  assertTrackCReadinessMatrix,
  assertTrackCRemediationPacket,
} from "../scripts/lib/track_c_inventory_guards.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadJson(rel) {
  return JSON.parse(readFileSync(join(REPO, rel), "utf8"));
}

function loadMatrix() {
  return loadJson(
    "reports/performance/live-evidence/track-c/PACKET_C_READINESS_MATRIX.json",
  );
}

function loadExpectedTables() {
  const denom = loadJson(
    "reports/performance/live-evidence/track-c/TRACK_C_INVENTORY_DENOMINATOR.json",
  );
  return [...denom.canonical_owners].sort();
}

function loadRemediationPacket() {
  return loadJson(
    "reports/performance/live-evidence/owner-packets/PACKET_C_REMEDIATION_SIX_PUBLISHERS.PREPARED.json",
  );
}

test("Track C guards: frozen readiness matrix is exhaustive and disjoint", () => {
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  assert.equal(
    assertTrackCReadinessMatrix({ matrix, expectedTables }),
    true,
  );
  assert.equal(matrix.counts.lifecycle_executable, 11);
  assert.equal(matrix.counts.migration_pending, 1);
  assert.equal(matrix.counts.publisher_blocked, 0);
  assert.equal(
    matrix.counts.lifecycle_executable +
      matrix.counts.migration_pending +
      matrix.counts.publisher_blocked,
    12,
  );
});

test("Track C guards: auth.outbox_events stays migration_pending only", () => {
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  assert.deepEqual(matrix.partitions.migration_pending, ["auth.outbox_events"]);
  assert.ok(!matrix.partitions.lifecycle_executable.includes("auth.outbox_events"));
  assert.ok(!matrix.partitions.publisher_blocked.includes("auth.outbox_events"));

  const badExecutable = structuredClone(matrix);
  badExecutable.partitions.lifecycle_executable.push("auth.outbox_events");
  badExecutable.partitions.migration_pending = [];
  badExecutable.counts.lifecycle_executable = 8;
  badExecutable.counts.migration_pending = 0;
  assert.throws(
    () =>
      assertTrackCReadinessMatrix({
        matrix: badExecutable,
        expectedTables,
      }),
    /auth_outbox_events_must_not_be_lifecycle_executable|sole_migration_pending|migration_pending|lifecycle_executable_count/,
  );

  const badBlocked = structuredClone(matrix);
  badBlocked.partitions.publisher_blocked.push("auth.outbox_events");
  badBlocked.partitions.migration_pending = [];
  badBlocked.counts.publisher_blocked = 5;
  badBlocked.counts.migration_pending = 0;
  assert.throws(
    () =>
      assertTrackCReadinessMatrix({
        matrix: badBlocked,
        expectedTables,
      }),
    /auth_outbox_events_must_not_be_publisher_blocked|sole_migration_pending|migration_pending|publisher_blocked_count/,
  );
});

test("Track C guards: overlapping partitions fail closed", () => {
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  const bad = structuredClone(matrix);
  bad.partitions.publisher_blocked = [
    ...bad.partitions.publisher_blocked,
    bad.partitions.lifecycle_executable[0],
  ];
  bad.counts.publisher_blocked = bad.partitions.publisher_blocked.length;
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: bad, expectedTables }),
    /partition_count|owners_not_disjoint|publisher_blocked_count|partition_tables/,
  );
});

test("Track C guards: incomplete partition set fails closed", () => {
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  const bad = structuredClone(matrix);
  bad.partitions.lifecycle_executable =
    bad.partitions.lifecycle_executable.slice(1);
  bad.counts.lifecycle_executable = bad.partitions.lifecycle_executable.length;
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: bad, expectedTables }),
    /partition_count|lifecycle_executable_count|counts_sum|partition_tables/,
  );
});

test("Track C guards: mismatched counts.* vs partition lengths fail closed", () => {
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  const bad = structuredClone(matrix);
  bad.counts.lifecycle_executable = 4;
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: bad, expectedTables }),
    /lifecycle_executable_count_field/,
  );

  const badPending = structuredClone(matrix);
  badPending.counts.migration_pending = 2;
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: badPending, expectedTables }),
    /migration_pending_count_field/,
  );

  const badBlocked = structuredClone(matrix);
  badBlocked.counts.publisher_blocked = 2;
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: badBlocked, expectedTables }),
    /publisher_blocked_count_field/,
  );
});

test("Track C guards: duplicate denominator tables fail closed", () => {
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  const bad = structuredClone(matrix);
  bad.acceptance_denominator_tables = [
    ...bad.acceptance_denominator_tables,
    bad.acceptance_denominator_tables[0],
  ];
  bad.acceptance_denominator_count = bad.acceptance_denominator_tables.length;
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: bad, expectedTables }),
    /acceptance_denominator|duplicates|count/,
  );
});

test("Track C guards: unexpected denominator table fails closed", () => {
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  const bad = structuredClone(matrix);
  bad.acceptance_denominator_tables = bad.acceptance_denominator_tables.map(
    (table, index) => (index === 0 ? "booking.outbox_events" : table),
  );
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: bad, expectedTables }),
    /acceptance_denominator_tables_missing|acceptance_denominator_tables_unexpected/,
  );
});

test("Track C guards: obsolete_inventory_sha256 must be array of allowlisted digests", () => {
  const inv = buildPreparedOutboxInventory(REPO);
  assert.equal(
    assertObsoleteInventoryDigests(inv, OBSOLETE_INVENTORY_SHA256),
    true,
  );

  assert.throws(
    () => assertObsoleteInventoryDigests(inv, "not-an-array"),
    /obsolete_inventory_allowlist_must_be_array/,
  );

  inv.obsolete_inventory_sha256 = OBSOLETE_INVENTORY_SHA256[0];
  assert.throws(
    () => assertObsoleteInventoryDigests(inv, OBSOLETE_INVENTORY_SHA256),
    /obsolete_inventory_sha256_must_be_array/,
  );
  assert.throws(() => assertOutboxInventory(inv), /obsolete_inventory_sha256_must_be_array/);

  const inv2 = buildPreparedOutboxInventory(REPO);
  inv2.obsolete_inventory_sha256 = ["not-a-sha"];
  assert.throws(
    () => assertObsoleteInventoryDigests(inv2, OBSOLETE_INVENTORY_SHA256),
    /bad_obsolete_inventory_sha256/,
  );

  const inv3 = buildPreparedOutboxInventory(REPO);
  inv3.obsolete_inventory_sha256 = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ];
  assert.throws(
    () => assertObsoleteInventoryDigests(inv3, OBSOLETE_INVENTORY_SHA256),
    /unknown_obsolete_inventory_sha256/,
  );
});

test("Track C remediation packet: remaining blocked targets pinned to 12-owner denominator", () => {
  const packet = loadRemediationPacket();
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  assert.equal(
    assertTrackCRemediationPacket({ packet, matrix, expectedTables }),
    true,
  );
  assert.equal(packet.packet_id, "PACKET_C_REMEDIATION_SIX_PUBLISHERS");
  assert.equal(packet.execution_authorized, false);
  assert.equal(packet.platform_pass, false);
  assert.equal(packet.track_c_acceptance_pass, false);
  assert.equal(packet.acceptance_denominator_count, 12);
  assert.equal(packet.remediation_target_count, 0);
  assert.equal(packet.pins.inventory_sha256, TRACK_C_CANONICAL_INVENTORY_SHA256);
  assert.equal(
    packet.pins.readiness_matrix_sha256,
    "e2908e28e468229b8609e9a726d0ae22875be6032d9bbdf0888510300dffae2b",
  );
  assert.equal(
    packet.pins.inventory_denominator_sha256,
    "1b614ba485e03bddf7bcf296c9bf0c89fee97b7013e9f034d8fdc7ea77079074",
  );
  assert.ok(packet.pins.source);
  assert.ok(packet.pins.source.track_c_inventory_guards_mjs);
  assert.ok(packet.pins.source.prepare_packet_c_remediation_mjs);
  assert.ok(packet.pins.source.media_outbox_publisher_ts);
  assert.ok(packet.pins.source.media_outbox_publisher_test_ts);
  assert.ok(packet.pins.source.messaging_outbox_publisher_ts);
  assert.ok(packet.pins.source.messaging_message_outbox_ts);
  assert.ok(packet.pins.source.messaging_message_outbox_test_ts);
  assert.ok(packet.pins.source.notification_outbox_publisher_ts);
  assert.ok(packet.pins.source.notification_message_outbox_ts);
  assert.ok(packet.pins.source.notification_message_outbox_test_ts);
  assert.ok(packet.pins.source.records_outbox_publisher_ts);
  assert.ok(packet.pins.source.records_message_outbox_ts);
  assert.ok(packet.pins.source.records_message_outbox_test_ts);
  assert.ok(packet.pins.source.shopping_outbox_publisher_ts);
  assert.ok(packet.pins.source.shopping_message_outbox_ts);
  assert.ok(packet.pins.source.shopping_message_outbox_test_ts);
  assert.ok(packet.pins.source.trust_outbox_publisher_ts);
  assert.ok(packet.pins.source.trust_message_outbox_ts);
  assert.ok(packet.pins.source.trust_message_outbox_test_ts);
  assert.ok(packet.pins.source.trust_outbox_wiring_test_ts);
  assert.ok(packet.pins.source.track_c_inventory_guards_test_mjs);
  assert.ok(Object.keys(packet.pins.source).length >= 5);
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "91c033c997e3f3c8ab56a0594165bc814a1892e043839f9df3e01aad6e2fb9b8",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "c3c432b91001967eceec651f7b2e201576e1f442a3ccbf256fa01c2c63da77f6",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "288fd8aa40f22634acd087a2b2192ddb459beb07412bfa2a58be2e1e7872b694",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "6fbc2410995cc409cb9e3a06f7474ab87216e23f7e77db3e5f9f16531cf9f905",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "3c679ecde42b800ddefa77a85ca9399562bc0be292dd6cc448cc83fb59b153de",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "9efd0a0333741909d6b4b75256973bbb4035a18709e69d4a6441d07487edb1e7",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "ca9a35c7a97d660878837b46cc2c4a4828c4a1d3c1ca972b827bfc08ff349f46",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "380993598d3f2d419a54eec5fbb43e7562bdd5b30cc94f130d2a98d66806a7e9",
    ),
  );
  assert.ok(
    packet.obsolete_prepared_sha256.includes(
      "7176a934cdf80152c57d9a336e57898983833c20b476637dbcf1a0f9b7ee312f",
    ),
  );
  assert.ok(!packet.remediation_targets.some((t) => t.table === "media.outbox_events"));
  assert.ok(!packet.remediation_targets.some((t) => t.table === "messaging.outbox_events"));
  assert.ok(!packet.remediation_targets.some((t) => t.table === "notification.outbox_events"));
  assert.ok(!packet.remediation_targets.some((t) => t.table === "records.outbox_events"));
  assert.ok(!packet.remediation_targets.some((t) => t.table === "shopping.outbox_events"));
  assert.ok(!packet.remediation_targets.some((t) => t.table === "trust.outbox_events"));
  assert.ok(packet.not_in_remediation_scope.lifecycle_executable.includes("media.outbox_events"));
  assert.ok(packet.not_in_remediation_scope.lifecycle_executable.includes("messaging.outbox_events"));
  assert.ok(packet.not_in_remediation_scope.lifecycle_executable.includes("notification.outbox_events"));
  assert.ok(packet.not_in_remediation_scope.lifecycle_executable.includes("records.outbox_events"));
  assert.ok(packet.not_in_remediation_scope.lifecycle_executable.includes("shopping.outbox_events"));
  assert.ok(packet.not_in_remediation_scope.lifecycle_executable.includes("trust.outbox_events"));
  assert.deepEqual(
    packet.remediation_targets.map((t) => t.table).sort(),
    [...matrix.partitions.publisher_blocked].sort(),
  );
  assert.deepEqual(packet.not_in_remediation_scope.migration_pending, [
    "auth.outbox_events",
  ]);
});

test("Track C remediation packet: missing source pins fail closed", () => {
  const packet = loadRemediationPacket();
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  const bad = structuredClone(packet);
  delete bad.pins.source;
  assert.throws(
    () =>
      assertTrackCRemediationPacket({
        packet: bad,
        matrix,
        expectedTables,
      }),
    /source_pins_missing/,
  );
});

test("Track C remediation packet: swapped executable target fails closed", () => {
  const packet = loadRemediationPacket();
  const matrix = loadMatrix();
  const expectedTables = loadExpectedTables();
  const bad = structuredClone(packet);
  const executable = matrix.partitions.lifecycle_executable[0];
  bad.remediation_targets = [
    {
      table: executable,
      readiness: "LIFECYCLE_EXECUTABLE",
    },
  ];
  bad.remediation_target_count = 1;
  assert.throws(
    () =>
      assertTrackCRemediationPacket({
        packet: bad,
        matrix,
        expectedTables,
      }),
    /remediation_targets_missing|remediation_targets_unexpected|remediation_targets_count|lifecycle_executable_targeted/,
  );
});
