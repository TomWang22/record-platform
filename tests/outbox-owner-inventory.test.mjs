import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertOutboxInventory,
  buildPreparedOutboxInventoryForRepo,
  buildTrackCResult,
  discoverOutboxDdlFiles,
} from "../scripts/performance/build-outbox-inventory.mjs";
import {
  FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS,
  LIFECYCLE_STATES,
  OBSOLETE_INVENTORY_SHA256,
  OUTBOX_REGISTRY,
  PUBLISHER_DISPOSITION_STATUSES,
  REQUIRED_CONTRACT_FIELDS,
  SUPPLEMENTAL_OUTBOX_TABLES,
  TRACK_C_EXPECTED_OWNER_COUNT,
  assertNoForbiddenOutboxOwners,
} from "../scripts/lib/performance_track_c.mjs";
import { auditTrackCFrozenEvidence } from "../scripts/audit-outbox-lineage-harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRACK_B_TERMINAL =
  "3d4d06245f0acde997bea77db4a9b32ab5be6563fc1979faeb71defe4ae569bb";

test("Track C: discovers all infra/db outbox DDL files including forbidden stale DDL", () => {
  const ddl = discoverOutboxDdlFiles(REPO);
  assert.equal(ddl.length, 13);
  assert.ok(ddl.includes("01-auth-outbox.sql"));
  assert.ok(ddl.includes("03-listings-outbox.sql"));
  assert.ok(ddl.includes("03-booking-outbox.sql"));
  assert.ok(ddl.includes("01-social-outbox.sql"));
});

test("Track C: prepared inventory closes 12-row denominator without booking/social", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  assert.equal(inv.execution_authorized, false);
  assert.equal(inv.canary_v3_is_platform_wide_pass, false);
  assert.equal(inv.lifecycle_publish_executed, false);
  assert.equal(inv.expected_count, TRACK_C_EXPECTED_OWNER_COUNT);
  assert.equal(inv.discovered_count, 12);
  assert.equal(inv.complete, true);
  assert.equal(inv.outboxes_expected, 12);
  assert.equal(inv.outboxes_discovered, 12);
  assert.equal(inv.ddl_outbox_sql_files, 11);
  assert.equal(inv.ddl_outbox_sql_files_on_disk, 13);
  assert.equal(inv.supplemental_tables, SUPPLEMENTAL_OUTBOX_TABLES.length);
  assert.equal(inv.track_b_terminal_sha256, TRACK_B_TERMINAL);
  assert.deepEqual(inv.obsolete_inventory_sha256, [...OBSOLETE_INVENTORY_SHA256]);
  assert.equal(inv.forbidden_nonexistent_services.booking, "FORBIDDEN_NONEXISTENT_SERVICE");
  assert.equal(inv.forbidden_nonexistent_services.social, "FORBIDDEN_NONEXISTENT_SERVICE");
  assert.equal(inv.forbidden_nonexistent_services.inventory_status, "ABSENT_BY_CONTRACT");
  assert.equal(assertOutboxInventory(inv), true);
  assertNoForbiddenOutboxOwners(inv.owners);

  const tables = inv.owners.map((o) => o.table);
  assert.ok(!tables.includes("booking.outbox_events"));
  assert.ok(!tables.includes("social.outbox_events"));

  const result = buildTrackCResult(inv);
  assert.equal(result.track, "C");
  assert.equal(result.verdict, "HARNESS_PASS");
  assert.equal(result.platform_pass, false);
  assert.equal(result.publisher_absent_rows_explicit, true);
  assert.equal(result.lifecycle_publish_executed, false);
  assert.equal(result.missing_blocks_acceptance_count, 0);
  assert.deepEqual(result.acceptance_blockers, []);
});

test("Track C: every owner row has full contract fields and lifecycle states", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  for (const row of inv.owners) {
    for (const field of REQUIRED_CONTRACT_FIELDS) {
      assert.notEqual(row[field], undefined, `${row.table} missing ${field}`);
      assert.notEqual(row[field], null, `${row.table} null ${field}`);
    }
    assert.deepEqual(row.lifecycle_states_supported, LIFECYCLE_STATES);
  }
});

test("Track C: registry covers every discovered table and excludes forbidden", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  const tables = inv.owners.map((o) => o.table).sort();
  const registryKeys = Object.keys(OUTBOX_REGISTRY).sort();
  assert.deepEqual(tables, registryKeys);
  for (const schema of FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS) {
    assert.ok(!registryKeys.some((t) => t.startsWith(`${schema}.`)));
  }
});

test("Track C: preserve known specials as annotations", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  const auction = inv.owners.find((o) => o.table === "auction_monitor.outbox_events");
  assert.equal(auction.publisher_present, true);
  assert.ok(auction.annotations?.some((a) => a.includes("capacity-limited")));

  const media = inv.owners.find((o) => o.service === "media-service");
  assert.equal(media.publisher_present, true);
  assert.equal(media.disposition, "INVENTORIED");
  assert.equal(media.publisher_disposition, null);
  assert.ok(media.publisher_implementation.includes("publishOutbox.ts"));
  assert.ok(media.poll_batch?.claim?.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(media.annotations?.some((a) => a.includes("MEDIA_OUTBOX_PUBLISHER must be exactly 1")));
  assert.ok(media.annotations?.some((a) => a.includes("FOR UPDATE SKIP LOCKED through broker ack")));

  const messaging = inv.owners.find((o) => o.table === "messaging.outbox_events");
  assert.equal(messaging.publisher_present, true);
  assert.equal(messaging.disposition, "INVENTORIED");
  assert.equal(messaging.publisher_disposition, null);
  assert.ok(messaging.publisher_implementation.includes("publishOutbox.ts"));
  assert.ok(messaging.publisher_implementation.includes("messageOutbox.ts"));
  assert.ok(messaging.poll_batch?.claim?.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(messaging.annotations?.some((a) => a.includes("MESSAGING_OUTBOX_PUBLISHER must be exactly 1")));

  const notification = inv.owners.find((o) => o.table === "notification.outbox_events");
  assert.equal(notification.publisher_present, true);
  assert.equal(notification.disposition, "INVENTORIED");
  assert.equal(notification.publisher_disposition, null);
  assert.ok(notification.publisher_implementation.includes("publishOutbox.ts"));
  assert.ok(notification.publisher_implementation.includes("notificationOutbox.ts"));
  assert.ok(notification.poll_batch?.claim?.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(
    notification.annotations?.some((a) =>
      a.includes("NOTIFICATION_OUTBOX_PUBLISHER must be exactly 1"),
    ),
  );

  const records = inv.owners.find((o) => o.table === "records.outbox_events");
  assert.equal(records.publisher_present, true);
  assert.equal(records.disposition, "INVENTORIED");
  assert.equal(records.publisher_disposition, null);
  assert.ok(records.publisher_implementation.includes("publishOutbox.ts"));
  assert.ok(records.publisher_implementation.includes("recordOutbox.ts"));
  assert.ok(records.poll_batch?.claim?.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(
    records.annotations?.some((a) =>
      a.includes("RECORDS_OUTBOX_PUBLISHER must be exactly 1"),
    ),
  );

  const shopping = inv.owners.find((o) => o.table === "shopping.outbox_events");
  assert.equal(shopping.publisher_present, true);
  assert.equal(shopping.disposition, "INVENTORIED");
  assert.equal(shopping.publisher_disposition, null);
  assert.ok(shopping.publisher_implementation.includes("publishOutbox.ts"));
  assert.ok(shopping.publisher_implementation.includes("shoppingOutbox.ts"));
  assert.ok(shopping.poll_batch?.claim?.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(
    shopping.annotations?.some((a) =>
      a.includes("SHOPPING_OUTBOX_PUBLISHER must be exactly 1"),
    ),
  );
  assert.ok(shopping.annotations?.some((a) => a.includes("SaleCompleted remains listings")));

  const trust = inv.owners.find((o) => o.table === "trust.outbox_events");
  assert.equal(trust.publisher_present, true);
  assert.equal(trust.disposition, "INVENTORIED");
  assert.equal(trust.publisher_disposition, null);
  assert.ok(trust.publisher_implementation.includes("publishOutbox.ts"));
  assert.ok(trust.publisher_implementation.includes("trustOutbox.ts"));
  assert.ok(trust.poll_batch?.claim?.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(
    trust.annotations?.some((a) =>
      a.includes("TRUST_OUTBOX_PUBLISHER must be exactly 1"),
    ),
  );
  assert.ok(trust.annotations?.some((a) => a.includes("ListingFlagSubmittedV1")));

  const authCanonical = inv.owners.find((o) => o.table === "auth.outbox_events");
  assert.equal(authCanonical.publisher_disposition.status, "MIGRATION_PENDING");

  const listings = inv.owners.find((o) => o.table === "listings.outbox_events");
  assert.ok(listings.dlq.present);
  assert.ok(listings.annotations?.some((a) => a.toLowerCase().includes("dlq")));
  assert.ok(listings.annotations?.some((a) => a.toLowerCase().includes("orphan")));
});

test("Track C: publisher_disposition statuses are closed enum", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  for (const row of inv.owners) {
    if (row.publisher_present === false) {
      assert.ok(
        PUBLISHER_DISPOSITION_STATUSES.includes(row.publisher_disposition.status),
        row.table,
      );
    } else {
      assert.equal(row.publisher_disposition, null);
    }
  }
});

test("Track C: booking/social inventory rows are hard-forbidden", () => {
  const bad = buildPreparedOutboxInventoryForRepo(REPO);
  bad.owners.push({
    service: "reservation-mesh",
    publisher_owner: "reservation-mesh",
    publisher_present: false,
    disposition: "INTENTIONALLY_NO_PUBLISHER",
    database: "booking",
    schema: "booking",
    table: "booking.outbox_events",
    topic: "x",
    status_predicate: "published=false",
    publisher_disposition: {
      status: "INTENTIONALLY_NO_PUBLISHER",
      reason: "should never be inventoried",
      evidence: "test",
    },
    creation_transition: "x",
    publisher_implementation: "x",
    poll_batch: {},
    kafka_principal: "x",
    acl_expectations: [],
    retry: {},
    lease: {},
    terminal_predicates: [],
    dlq: { present: false },
    broker_ack: {},
    db_ack: {},
    consumer_groups: [],
    business_effect: "x",
    cleanup_disposition: "x",
    lifecycle_states_supported: [...LIFECYCLE_STATES],
  });
  bad.discovered_count = bad.owners.length;
  bad.expected_count = bad.owners.length;
  bad.outboxes_discovered = bad.owners.length;
  bad.outboxes_expected = bad.owners.length;
  assert.throws(() => assertOutboxInventory(bad), /TRACK_C_INVENTORY_INVALID|forbidden/);
});

test("Track C: reject missing publisher_owner", () => {
  const bad = buildPreparedOutboxInventoryForRepo(REPO);
  delete bad.owners[0].publisher_owner;
  assert.throws(() => assertOutboxInventory(bad), /missing_publisher_owner/);
});

test("Track C: reject silent ack for absent publisher", () => {
  const bad = buildPreparedOutboxInventoryForRepo(REPO);
  bad.owners[0].publisher_present = false;
  bad.owners[0].disposition = "INVENTORIED";
  assert.throws(() => assertOutboxInventory(bad), /silent_ack_publisher_absent/);
});

test("Track C: reject absent publisher without structured disposition", () => {
  const bad = buildPreparedOutboxInventoryForRepo(REPO);
  const absent = bad.owners.find((o) => o.publisher_present === false);
  absent.publisher_disposition = null;
  assert.throws(
    () => assertOutboxInventory(bad),
    /_missing|evidence_empty|reason_empty|publisher_disposition/,
  );
});

test("Track C: reject duplicate database+table ownership", () => {
  const bad = buildPreparedOutboxInventoryForRepo(REPO);
  bad.owners.push({ ...bad.owners[0] });
  bad.discovered_count = bad.owners.length;
  bad.expected_count = bad.owners.length;
  bad.outboxes_discovered = bad.owners.length;
  bad.outboxes_expected = bad.owners.length;
  assert.throws(() => assertOutboxInventory(bad), /duplicate_database_table_ownership|expected_count_not_canonical/);
});

test("Track C: auditor rejects canary-v3 as platform PASS", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  inv.canary_v3_is_platform_wide_pass = true;
  const audit = auditTrackCFrozenEvidence({ inventory: inv });
  assert.equal(audit.platform_pass, false);
  assert.ok(audit.failures.some((f) => f.includes("canary_v3")));
});

test("Track C: auditor accepts frozen 12-row inventory harness without platform PASS", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  const audit = auditTrackCFrozenEvidence({ inventory: inv });
  assert.equal(audit.inventory_denominator_pass, true);
  assert.equal(audit.harness_pass, true);
  assert.equal(audit.platform_pass, false);
  assert.equal(audit.track_b_terminal_sha256_referenced, true);
  assert.equal(audit.missing_blocks_acceptance_count, 0);
  assert.equal(audit.mutation_performed, false);
  assert.equal(audit.network_calls, false);
});

test("Track C: auditor rejects booking/social if injected", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  inv.owners[0] = {
    ...inv.owners[0],
    database: "social",
    schema: "social",
    table: "social.outbox_events",
  };
  const audit = auditTrackCFrozenEvidence({ inventory: inv });
  assert.equal(audit.inventory_denominator_pass, false);
  assert.ok(audit.failures.some((f) => f.includes("TRACK_C_INVENTORY_INVALID")));
});

test("Track C: PREPARED artifact on disk matches builder and rejects obsolete 14/14 SHA", () => {
  const inv = buildPreparedOutboxInventoryForRepo(REPO);
  const onDisk = JSON.parse(
    readFileSync(join(REPO, "reports/performance/outbox-owner-inventory.PREPARED.json"), "utf8"),
  );
  assert.equal(onDisk.discovered_count, 12);
  assert.equal(onDisk.complete, true);
  const digest = readFileSync(
    join(REPO, "reports/performance/outbox-owner-inventory.PREPARED.json.sha256"),
    "utf8",
  ).trim();
  assert.ok(!OBSOLETE_INVENTORY_SHA256.includes(digest));
  assert.equal(onDisk.expected_count, inv.expected_count);
});
