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

test("Track C freeze: canonical inventory SHA is post-trust 12/12", () => {
  const digest = shaFile("reports/performance/outbox-owner-inventory.PREPARED.json");
  assert.equal(digest, TRACK_C_CANONICAL_INVENTORY_SHA256);
  assert.ok(!OBSOLETE_INVENTORY_SHA256.includes(digest));
  assert.ok(
    OBSOLETE_INVENTORY_SHA256.includes(
      "5707bed2b371ff95f96d16f6c203f771c17fff1ab07c3193c7475ec404119052",
    ),
  );
  assert.ok(
    OBSOLETE_INVENTORY_SHA256.includes(
      "5cb24b02e1351bcb3f886bc48e8bc3b7423e4ab91cced6f82cb6df0b89fcb6b6",
    ),
  );
  assert.ok(
    OBSOLETE_INVENTORY_SHA256.includes(
      "9ece392aac4c9a1889287e0f6e233dc6a2b3e5666e9183f7a362cfeaa8d4c7da",
    ),
  );
  assert.ok(
    OBSOLETE_INVENTORY_SHA256.includes(
      "6e8df5b92509eb0351b2f5c15b2c0b85149f01960897cf668909ccd283a82476",
    ),
  );
  assert.ok(
    OBSOLETE_INVENTORY_SHA256.includes(
      "e3ad155c4b7916d73c5ba397d13f0432832e79f2197d2fc79dce36091e730e12",
    ),
  );

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

test("Track C readiness: matrix covers all 12 with 11 executable / 1 migration / 0 blocked", () => {
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
  assert.equal(matrix.counts.lifecycle_executable, 11);
  assert.equal(matrix.counts.migration_pending, 1);
  assert.equal(matrix.counts.publisher_blocked, 0);
  assert.equal(matrix.counts.acceptance_blockers, 1);
  assert.ok(matrix.partitions.lifecycle_executable.includes("media.outbox_events"));
  assert.ok(matrix.partitions.lifecycle_executable.includes("messaging.outbox_events"));
  assert.ok(matrix.partitions.lifecycle_executable.includes("notification.outbox_events"));
  assert.ok(matrix.partitions.lifecycle_executable.includes("records.outbox_events"));
  assert.ok(matrix.partitions.lifecycle_executable.includes("shopping.outbox_events"));
  assert.ok(matrix.partitions.lifecycle_executable.includes("trust.outbox_events"));
  assert.deepEqual(matrix.partitions.publisher_blocked, []);
  assert.deepEqual(matrix.partitions.migration_pending, ["auth.outbox_events"]);
  assert.ok(matrix.owners.every((row) => row.required_for_track_c_acceptance === true));
  assert.ok(
    matrix.remediation_packet_note.includes("all 12 canonical outboxes"),
  );
});
