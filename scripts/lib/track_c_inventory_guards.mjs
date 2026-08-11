/**
 * Track C inventory / readiness fail-closed guards.
 */

const SHA256_RE = /^[a-f0-9]{64}$/;

function assertStringArray(value, failure) {
  if (!Array.isArray(value)) {
    throw new Error(failure);
  }

  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(`${failure}:invalid_item:${String(item)}`);
    }
  }

  return value;
}

function assertUnique(values, failure) {
  if (new Set(values).size !== values.length) {
    throw new Error(failure);
  }
}

function assertExactSet({ actual, expected, label }) {
  assertStringArray(actual, `TRACK_C_READINESS_INVALID:${label}_not_array`);
  assertStringArray(expected, `TRACK_C_READINESS_INVALID:${label}_expected_not_array`);

  assertUnique(actual, `TRACK_C_READINESS_INVALID:${label}_duplicates`);
  assertUnique(expected, `TRACK_C_READINESS_INVALID:${label}_expected_duplicates`);

  if (actual.length !== expected.length) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:${label}_count:${actual.length}!=${expected.length}`,
    );
  }

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  for (const value of expectedSet) {
    if (!actualSet.has(value)) {
      throw new Error(`TRACK_C_READINESS_INVALID:${label}_missing:${value}`);
    }
  }

  for (const value of actualSet) {
    if (!expectedSet.has(value)) {
      throw new Error(`TRACK_C_READINESS_INVALID:${label}_unexpected:${value}`);
    }
  }
}

export function assertObsoleteInventoryDigests(inventory, obsoleteInventorySha256) {
  if (!Array.isArray(obsoleteInventorySha256)) {
    throw new Error(
      "TRACK_C_INVENTORY_INVALID:obsolete_inventory_allowlist_must_be_array",
    );
  }

  for (const digest of obsoleteInventorySha256) {
    if (typeof digest !== "string" || !SHA256_RE.test(digest)) {
      throw new Error(
        `TRACK_C_INVENTORY_INVALID:bad_obsolete_inventory_allowlist_digest:${String(digest)}`,
      );
    }
  }

  const allowlist = new Set(obsoleteInventorySha256);
  const digests = inventory?.obsolete_inventory_sha256;

  if (digests == null) {
    return true;
  }

  if (!Array.isArray(digests)) {
    throw new Error(
      "TRACK_C_INVENTORY_INVALID:obsolete_inventory_sha256_must_be_array",
    );
  }

  for (const digest of digests) {
    if (typeof digest !== "string" || digest.length !== 64) {
      throw new Error(
        `TRACK_C_INVENTORY_INVALID:bad_obsolete_inventory_sha256:${String(digest)}`,
      );
    }

    if (!SHA256_RE.test(digest)) {
      throw new Error(
        `TRACK_C_INVENTORY_INVALID:bad_obsolete_inventory_sha256_hex:${digest}`,
      );
    }

    if (!allowlist.has(digest)) {
      throw new Error(
        `TRACK_C_INVENTORY_INVALID:unknown_obsolete_inventory_sha256:${digest}`,
      );
    }
  }

  return true;
}

/**
 * Validate the frozen Track C readiness partition.
 *
 * After trust publisher remediation the live freeze is 11 + 1 + 0.
 * expectedTables must come from the frozen 12-owner denominator artifact,
 * rather than being reconstructed from the readiness matrix itself.
 */
export function assertTrackCReadinessMatrix({
  matrix,
  expectedTables,
  expectedOwnerCount = 12,
  expectedLifecycleExecutableCount = 11,
  expectedPublisherBlockedCount = 0,
}) {
  if (!matrix || typeof matrix !== "object") {
    throw new Error("TRACK_C_READINESS_INVALID:matrix_missing");
  }

  assertStringArray(
    expectedTables,
    "TRACK_C_READINESS_INVALID:expected_tables_not_array",
  );

  assertUnique(
    expectedTables,
    "TRACK_C_READINESS_INVALID:expected_tables_not_disjoint",
  );

  if (expectedTables.length !== expectedOwnerCount) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:expected_tables_count:${expectedTables.length}!=${expectedOwnerCount}`,
    );
  }

  const lifecycleExecutable = matrix?.partitions?.lifecycle_executable;
  const migrationPending = matrix?.partitions?.migration_pending;
  const publisherBlocked = matrix?.partitions?.publisher_blocked;

  for (const [name, value] of [
    ["lifecycle_executable", lifecycleExecutable],
    ["migration_pending", migrationPending],
    ["publisher_blocked", publisherBlocked],
  ]) {
    assertStringArray(
      value,
      `TRACK_C_READINESS_INVALID:partition_not_array:${name}`,
    );

    assertUnique(
      value,
      `TRACK_C_READINESS_INVALID:partition_duplicates:${name}`,
    );
  }

  if (lifecycleExecutable.length !== expectedLifecycleExecutableCount) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:lifecycle_executable_count:${lifecycleExecutable.length}!=${expectedLifecycleExecutableCount}`,
    );
  }

  if (migrationPending.length !== 1) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:migration_pending_count:${migrationPending.length}!=1`,
    );
  }

  if (publisherBlocked.length !== expectedPublisherBlockedCount) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:publisher_blocked_count:${publisherBlocked.length}!=${expectedPublisherBlockedCount}`,
    );
  }

  if (lifecycleExecutable.includes("auth.outbox_events")) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:auth_outbox_events_must_not_be_lifecycle_executable",
    );
  }

  if (publisherBlocked.includes("auth.outbox_events")) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:auth_outbox_events_must_not_be_publisher_blocked",
    );
  }

  if (
    migrationPending.length !== 1 ||
    migrationPending[0] !== "auth.outbox_events"
  ) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:auth_outbox_events_must_be_sole_migration_pending",
    );
  }

  const partitions = [
    ...lifecycleExecutable,
    ...migrationPending,
    ...publisherBlocked,
  ];

  if (partitions.length !== expectedOwnerCount) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:partition_count:${partitions.length}!=${expectedOwnerCount}`,
    );
  }

  assertUnique(partitions, "TRACK_C_READINESS_INVALID:owners_not_disjoint");

  assertExactSet({
    actual: partitions,
    expected: expectedTables,
    label: "partition_tables",
  });

  const counts = matrix?.counts;
  if (!counts || typeof counts !== "object") {
    throw new Error("TRACK_C_READINESS_INVALID:counts_missing");
  }

  if (counts.lifecycle_executable !== lifecycleExecutable.length) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:lifecycle_executable_count_field:${counts.lifecycle_executable}!=${lifecycleExecutable.length}`,
    );
  }

  if (counts.migration_pending !== migrationPending.length) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:migration_pending_count_field:${counts.migration_pending}!=${migrationPending.length}`,
    );
  }

  if (counts.publisher_blocked !== publisherBlocked.length) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:publisher_blocked_count_field:${counts.publisher_blocked}!=${publisherBlocked.length}`,
    );
  }

  const countSum =
    counts.lifecycle_executable +
    counts.migration_pending +
    counts.publisher_blocked;

  if (countSum !== expectedOwnerCount) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:counts_sum:${countSum}!=${expectedOwnerCount}`,
    );
  }

  if (matrix?.acceptance_denominator_count !== expectedOwnerCount) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:acceptance_denominator:${matrix?.acceptance_denominator_count}!=${expectedOwnerCount}`,
    );
  }

  assertExactSet({
    actual: matrix?.acceptance_denominator_tables,
    expected: expectedTables,
    label: "acceptance_denominator_tables",
  });

  if (!Array.isArray(matrix?.owners)) {
    throw new Error("TRACK_C_READINESS_INVALID:owners_array_missing");
  }

  if (matrix.owners.length !== expectedOwnerCount) {
    throw new Error(
      `TRACK_C_READINESS_INVALID:owners_array_count:${matrix.owners.length}!=${expectedOwnerCount}`,
    );
  }

  const ownerTables = matrix.owners.map((row) => row?.table);

  if (ownerTables.some((table) => typeof table !== "string" || !table)) {
    throw new Error("TRACK_C_READINESS_INVALID:owners_array_table_missing");
  }

  assertExactSet({
    actual: ownerTables,
    expected: expectedTables,
    label: "owner_tables",
  });

  const lifecycleSet = new Set(lifecycleExecutable);
  const migrationSet = new Set(migrationPending);
  const blockedSet = new Set(publisherBlocked);

  for (const row of matrix.owners) {
    const table = row.table;

    let expectedReadiness;
    if (lifecycleSet.has(table)) {
      expectedReadiness = "LIFECYCLE_EXECUTABLE";
    } else if (migrationSet.has(table)) {
      expectedReadiness = "MIGRATION_PENDING";
    } else if (blockedSet.has(table)) {
      expectedReadiness = "PUBLISHER_BLOCKED";
    } else {
      throw new Error(
        `TRACK_C_READINESS_INVALID:owner_not_partitioned:${table}`,
      );
    }

    if (row.readiness !== expectedReadiness) {
      throw new Error(
        `TRACK_C_READINESS_INVALID:owner_readiness_mismatch:${table}:${row.readiness}!=${expectedReadiness}`,
      );
    }
  }

  const authRow = matrix.owners.find(
    (row) => row.table === "auth.outbox_events",
  );

  if (!authRow) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:auth_outbox_events_owner_missing",
    );
  }

  if (authRow.readiness !== "MIGRATION_PENDING") {
    throw new Error(
      "TRACK_C_READINESS_INVALID:auth_outbox_events_readiness_not_migration_pending",
    );
  }

  if (authRow.packet_c_observation_eligible !== false) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:auth_outbox_events_must_not_be_observation_eligible",
    );
  }

  if (matrix.execution_authorized !== false) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:execution_authorized_must_be_false",
    );
  }

  if (matrix.platform_pass !== false) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:platform_pass_must_remain_false",
    );
  }

  if (matrix.track_c_acceptance_pass === true) {
    throw new Error(
      "TRACK_C_READINESS_INVALID:track_c_acceptance_pass_must_remain_false",
    );
  }

  return true;
}

/**
 * Validate that a six-publisher remediation packet targets exactly the
 * publisher-blocked partition while retaining the 12-owner denominator.
 *
 * When expectedSourcePins is provided, require exact pin equality for
 * guard/generator/test implementation digests (fail closed on drift).
 */
export function assertTrackCRemediationPacket({
  packet,
  matrix,
  expectedTables,
  expectedOwnerCount = 12,
  expectedSourcePins = null,
  obsoletePreparedSha256 = null,
}) {
  assertTrackCReadinessMatrix({
    matrix,
    expectedTables,
    expectedOwnerCount,
  });

  if (!packet || typeof packet !== "object") {
    throw new Error("TRACK_C_REMEDIATION_INVALID:packet_missing");
  }

  if (packet.execution_authorized !== false) {
    throw new Error(
      "TRACK_C_REMEDIATION_INVALID:execution_authorized_must_be_false",
    );
  }

  if (packet.platform_pass === true) {
    throw new Error(
      "TRACK_C_REMEDIATION_INVALID:platform_pass_must_be_false",
    );
  }

  if (packet.track_c_acceptance_pass === true) {
    throw new Error(
      "TRACK_C_REMEDIATION_INVALID:track_c_acceptance_pass_must_be_false",
    );
  }

  if (packet.acceptance_denominator_count !== expectedOwnerCount) {
    throw new Error(
      `TRACK_C_REMEDIATION_INVALID:acceptance_denominator:${packet.acceptance_denominator_count}!=${expectedOwnerCount}`,
    );
  }

  assertExactSet({
    actual: packet.acceptance_denominator_tables,
    expected: expectedTables,
    label: "remediation_acceptance_denominator_tables",
  });

  const targetRows = packet.remediation_targets ?? packet.targets;
  if (!Array.isArray(targetRows)) {
    throw new Error("TRACK_C_REMEDIATION_INVALID:targets_missing");
  }

  const targets = targetRows.map((target) => target?.table);

  assertExactSet({
    actual: targets,
    expected: matrix.partitions.publisher_blocked,
    label: "remediation_targets",
  });

  if (targets.includes("auth.outbox_events")) {
    throw new Error(
      "TRACK_C_REMEDIATION_INVALID:migration_pending_targeted",
    );
  }

  for (const table of matrix.partitions.lifecycle_executable) {
    if (targets.includes(table)) {
      throw new Error(
        `TRACK_C_REMEDIATION_INVALID:lifecycle_executable_targeted:${table}`,
      );
    }
  }

  if (packet.remediation_target_count != null) {
    if (packet.remediation_target_count !== targets.length) {
      throw new Error(
        `TRACK_C_REMEDIATION_INVALID:remediation_target_count:${packet.remediation_target_count}!=${targets.length}`,
      );
    }
  }

  if (!packet.pins || typeof packet.pins !== "object") {
    throw new Error("TRACK_C_REMEDIATION_INVALID:pins_missing");
  }

  for (const key of [
    "inventory_sha256",
    "inventory_denominator_sha256",
    "readiness_matrix_sha256",
    "track_b_terminal_sha256",
  ]) {
    if (typeof packet.pins[key] !== "string" || !/^[a-f0-9]{64}$/.test(packet.pins[key])) {
      throw new Error(`TRACK_C_REMEDIATION_INVALID:pin_missing_or_invalid:${key}`);
    }
  }

  if (!packet.pins.source || typeof packet.pins.source !== "object") {
    throw new Error("TRACK_C_REMEDIATION_INVALID:source_pins_missing");
  }

  if (expectedSourcePins) {
    const actualKeys = Object.keys(packet.pins.source).sort();
    const expectedKeys = Object.keys(expectedSourcePins).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error(
        `TRACK_C_REMEDIATION_INVALID:source_pin_keys_mismatch:${actualKeys.join(",")}`,
      );
    }
    for (const [key, digest] of Object.entries(expectedSourcePins)) {
      if (packet.pins.source[key] !== digest) {
        throw new Error(
          `TRACK_C_REMEDIATION_INVALID:source_pin_drift:${key}:${packet.pins.source[key]}!=${digest}`,
        );
      }
    }
  } else {
    for (const [key, digest] of Object.entries(packet.pins.source)) {
      if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
        throw new Error(
          `TRACK_C_REMEDIATION_INVALID:source_pin_invalid:${key}:${String(digest)}`,
        );
      }
    }
    if (Object.keys(packet.pins.source).length < 5) {
      throw new Error(
        `TRACK_C_REMEDIATION_INVALID:source_pins_incomplete:${Object.keys(packet.pins.source).length}`,
      );
    }
  }

  if (obsoletePreparedSha256) {
    if (!Array.isArray(obsoletePreparedSha256)) {
      throw new Error(
        "TRACK_C_REMEDIATION_INVALID:obsolete_prepared_allowlist_must_be_array",
      );
    }
    const listed = packet.obsolete_prepared_sha256;
    if (!Array.isArray(listed)) {
      throw new Error(
        "TRACK_C_REMEDIATION_INVALID:obsolete_prepared_sha256_must_be_array",
      );
    }
    for (const digest of obsoletePreparedSha256) {
      if (!listed.includes(digest)) {
        throw new Error(
          `TRACK_C_REMEDIATION_INVALID:obsolete_prepared_missing:${digest}`,
        );
      }
    }
  }

  return true;
}

export { assertExactSet, assertStringArray, assertUnique };
