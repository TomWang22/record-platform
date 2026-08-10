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
  assert.equal(matrix.counts.lifecycle_executable, 5);
  assert.equal(matrix.counts.migration_pending, 1);
  assert.equal(matrix.counts.publisher_blocked, 6);
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
  badExecutable.counts.lifecycle_executable = 6;
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
  badBlocked.counts.publisher_blocked = 7;
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
  bad.partitions.publisher_blocked = bad.partitions.publisher_blocked.slice(0, 5);
  bad.counts.publisher_blocked = 5;
  assert.throws(
    () => assertTrackCReadinessMatrix({ matrix: bad, expectedTables }),
    /partition_count|publisher_blocked_count|counts_sum|partition_tables/,
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
  badBlocked.counts.publisher_blocked = 5;
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

test("Track C remediation packet: six blocked targets pinned to 12-owner denominator", () => {
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
  assert.equal(packet.remediation_target_count, 6);
  assert.equal(packet.pins.inventory_sha256, TRACK_C_CANONICAL_INVENTORY_SHA256);
  assert.equal(
    packet.pins.readiness_matrix_sha256,
    "f2ba461d31da4bc6db029a8c528a101ebd73108299f046619ca5e1dbdd0e9bf4",
  );
  assert.equal(
    packet.pins.inventory_denominator_sha256,
    "4330610d2f5fa727839ca0e5e5cd821ae31eff53a9298b1ba20fcbe2dd128f7e",
  );
  assert.ok(packet.pins.source);
  assert.ok(packet.pins.source.track_c_inventory_guards_mjs);
  assert.ok(packet.pins.source.prepare_packet_c_remediation_mjs);
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
  bad.remediation_targets[0] = {
    ...bad.remediation_targets[0],
    table: executable,
    readiness: "LIFECYCLE_EXECUTABLE",
  };
  assert.throws(
    () =>
      assertTrackCRemediationPacket({
        packet: bad,
        matrix,
        expectedTables,
      }),
    /remediation_targets_missing|remediation_targets_unexpected|lifecycle_executable_targeted/,
  );
});
