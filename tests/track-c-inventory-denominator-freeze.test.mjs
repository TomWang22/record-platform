import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertOutboxInventory,
  OBSOLETE_INVENTORY_SHA256,
  TRACK_C_CANONICAL_INVENTORY_SHA256,
  TRACK_C_EXPECTED_OWNER_COUNT,
  buildPreparedOutboxInventory,
} from "../scripts/lib/performance_track_c.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function shaFile(rel) {
  return createHash("sha256")
    .update(readFileSync(join(REPO, rel)))
    .digest("hex");
}

test("Track C freeze: canonical inventory SHA is 5707bed2 12/12", () => {
  const digest = shaFile("reports/performance/outbox-owner-inventory.PREPARED.json");
  assert.equal(digest, TRACK_C_CANONICAL_INVENTORY_SHA256);
  assert.ok(!OBSOLETE_INVENTORY_SHA256.includes(digest));

  const inv = JSON.parse(
    readFileSync(join(REPO, "reports/performance/outbox-owner-inventory.PREPARED.json"), "utf8"),
  );
  assert.equal(inv.expected_count, 12);
  assert.equal(inv.discovered_count, 12);
  assert.equal(inv.complete, true);
  assert.equal(inv.owners.length, TRACK_C_EXPECTED_OWNER_COUNT);
  assertOutboxInventory(inv);
});

test("Track C freeze: inventory denominator freeze binds 12/12 and platform_pass false", () => {
  const denom = JSON.parse(
    readFileSync(
      join(REPO, "reports/performance/live-evidence/track-c/TRACK_C_INVENTORY_DENOMINATOR.json"),
      "utf8",
    ),
  );
  assert.equal(denom.schema, "track-c-inventory-denominator/v1");
  assert.equal(denom.inventory_sha256, TRACK_C_CANONICAL_INVENTORY_SHA256);
  assert.equal(denom.expected_count, 12);
  assert.equal(denom.discovered_count, 12);
  assert.equal(denom.complete, true);
  assert.equal(denom.inventory_denominator_pass, true);
  assert.equal(denom.platform_pass, false);
  assert.equal(denom.track_c_acceptance_pass, false);
  assert.equal(denom.execution_authorized, false);
  assert.equal(denom.acceptance_denominator_count, 12);
  assert.equal(denom.canonical_owners.length, 12);
  assert.ok(!denom.canonical_owners.includes("booking.outbox_events"));
  assert.ok(!denom.canonical_owners.includes("social.outbox_events"));
  assert.deepEqual(denom.obsolete_inventory_sha256, [...OBSOLETE_INVENTORY_SHA256]);
});

test("Track C freeze: reject any 14-owner inventory artifact", () => {
  const inv = buildPreparedOutboxInventory(REPO);
  while (inv.owners.length < 14) {
    inv.owners.push({
      ...inv.owners[0],
      table: `synthetic_${inv.owners.length}.outbox_events`,
      database: `synthetic_${inv.owners.length}`,
      schema: `synthetic_${inv.owners.length}`,
    });
  }
  inv.expected_count = 14;
  inv.discovered_count = 14;
  inv.outboxes_expected = 14;
  inv.outboxes_discovered = 14;
  inv.complete = true;
  assert.equal(inv.owners.length, 14);
  assert.throws(
    () => assertOutboxInventory(inv),
    /fourteen_owner_artifact|expected_count_not_canonical|owner_count_not_canonical/,
  );
});

test("Track C freeze: reject obsolete 70ae0ee0 inventory SHA if presented", () => {
  const inv = buildPreparedOutboxInventory(REPO);
  inv.inventory_sha256 = OBSOLETE_INVENTORY_SHA256[0];
  assert.throws(() => assertOutboxInventory(inv), /obsolete_inventory_sha/);
});

test("Track C readiness: matrix covers all 12 with 5 executable / 1 migration / 6 blocked", () => {
  const matrix = JSON.parse(
    readFileSync(
      join(REPO, "reports/performance/live-evidence/track-c/PACKET_C_READINESS_MATRIX.json"),
      "utf8",
    ),
  );
  assert.equal(matrix.schema, "packet-c-readiness-matrix/v1");
  assert.equal(matrix.execution_authorized, false);
  assert.equal(matrix.platform_pass, false);
  assert.equal(matrix.track_c_acceptance_pass, false);
  assert.equal(matrix.acceptance_denominator_count, 12);
  assert.equal(matrix.owners.length, 12);
  assert.equal(matrix.counts.lifecycle_executable, 5);
  assert.equal(matrix.counts.migration_pending, 1);
  assert.equal(matrix.counts.publisher_blocked, 6);
  assert.equal(matrix.counts.acceptance_blockers, 7);
  assert.deepEqual(
    matrix.partitions.publisher_blocked.sort(),
    [
      "media.outbox_events",
      "messaging.outbox_events",
      "notification.outbox_events",
      "records.outbox_events",
      "shopping.outbox_events",
      "trust.outbox_events",
    ].sort(),
  );
  assert.deepEqual(matrix.partitions.migration_pending, ["auth.outbox_events"]);
  assert.ok(matrix.owners.every((row) => row.required_for_track_c_acceptance === true));
  assert.ok(
    matrix.remediation_packet_note.includes("all 12 canonical outboxes"),
  );
});
