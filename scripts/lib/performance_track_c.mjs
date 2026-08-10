/**
 * Track C — all-outbox inventory + lifecycle harness helpers (CI/harness only).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertObsoleteInventoryDigests } from "./track_c_inventory_guards.mjs";

export const LIFECYCLE_STATES = [
  "created",
  "selected",
  "leased",
  "produce_attempted",
  "broker_acknowledged",
  "db_acknowledged",
  "consumed",
  "offset_committed",
  "business_effect_applied",
  "retrying",
  "dead_lettered",
  "orphaned",
  "unknown_blocking",
];

export const MUTUALLY_EXCLUSIVE_TERMINALS = [
  "dead_lettered",
  "orphaned",
  "unknown_blocking",
];

/** Eight independently required lifecycle states (design contract). */
export const REQUIRED_LIFECYCLE_STATES_FOR_PASS = Object.freeze([
  "created",
  "selected",
  "produce_attempted",
  "broker_acknowledged",
  "db_acknowledged",
  "consumed",
  "offset_committed",
  "business_effect_applied",
]);

export const PUBLISHER_DISPOSITION_STATUSES = Object.freeze([
  "MISSING_BLOCKS_ACCEPTANCE",
  "INTENTIONALLY_NO_PUBLISHER",
  "MIGRATION_PENDING",
]);

export const REQUIRED_CONTRACT_FIELDS = [
  "service",
  "database",
  "schema",
  "table",
  "publisher_owner",
  "status_predicate",
  "creation_transition",
  "publisher_implementation",
  "poll_batch",
  "topic",
  "kafka_principal",
  "acl_expectations",
  "retry",
  "lease",
  "terminal_predicates",
  "dlq",
  "broker_ack",
  "db_ack",
  "consumer_groups",
  "business_effect",
  "cleanup_disposition",
];

/** @deprecated empty — booking/social are forbidden, not out-of-platform disposition rows */
export const OUT_OF_PLATFORM_DENOMINATOR_DATABASES = Object.freeze([]);

/**
 * booking/social are forbidden nonexistent services for Track C.
 * They must not appear in owners, expected denominator, lifecycle, or Packet C targets.
 * Stale infra/db DDL may still exist on disk; that is ABSENT_BY_CONTRACT, not an inventory row.
 */
export const FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS = Object.freeze([
  "booking",
  "social",
]);

export const FORBIDDEN_NONEXISTENT_OUTBOX_TABLES = Object.freeze([
  "booking.outbox_events",
  "social.outbox_events",
]);

export const TRACK_C_EXPECTED_OWNER_COUNT = 12;

/** Frozen corrected 12/12 inventory (booking/social absent by contract). */
export const TRACK_C_CANONICAL_INVENTORY_SHA256 =
  "5707bed2b371ff95f96d16f6c203f771c17fff1ab07c3193c7475ec404119052";

export const OBSOLETE_INVENTORY_SHA256 = Object.freeze([
  // 14/14 denominator that incorrectly included booking+social disposition rows
  "70ae0ee0292870571f7fefc6ccaa6c2450069e45b734e7a48a6322502eb187be",
]);

export function isForbiddenOutboxSchema(schemaOrDatabase) {
  return FORBIDDEN_NONEXISTENT_OUTBOX_SCHEMAS.includes(schemaOrDatabase);
}

export function isForbiddenOutboxTable(table) {
  return FORBIDDEN_NONEXISTENT_OUTBOX_TABLES.includes(table);
}

export function assertNoForbiddenOutboxOwners(owners) {
  const hits = [];
  for (const row of owners || []) {
    if (
      isForbiddenOutboxSchema(row?.database) ||
      isForbiddenOutboxSchema(row?.schema) ||
      isForbiddenOutboxTable(row?.table)
    ) {
      hits.push(row.table || `${row?.schema}.${row?.database}`);
    }
  }
  if (hits.length) {
    throw new Error(`TRACK_C_INVENTORY_INVALID:forbidden_owners:${hits.join(",")}`);
  }
  return true;
}

/**
 * Explicit disposition for publisher_present=false rows.
 * Inventory must never silently omit publisher-less outboxes.
 */
export const PUBLISHER_ABSENT_DISPOSITIONS = Object.freeze({
  "auth.outbox_events": Object.freeze({
    status: "MIGRATION_PENDING",
    reason:
      "Canonical auth.outbox_events DDL exists; active publisher drains auth.auth_outbox only",
    evidence:
      "services/auth-service/src/lib/auth-outbox-publisher.ts; infra/db/01-auth-outbox.sql",
  }),
  "records.outbox_events": Object.freeze({
    status: "MISSING_BLOCKS_ACCEPTANCE",
    reason: "DDL present; no repository publisher implementation located",
    evidence: "infra/db/01-records-outbox.sql",
  }),
  "messaging.outbox_events": Object.freeze({
    status: "MISSING_BLOCKS_ACCEPTANCE",
    reason: "DDL + insert paths exist; no publish/mark loop located",
    evidence: "infra/db/02-messaging-outbox.sql",
  }),
  "media.outbox_events": Object.freeze({
    status: "MISSING_BLOCKS_ACCEPTANCE",
    reason: "Insert-only outbox; no Kafka publish/mark path",
    evidence: "services/media-service/src/outbox/insertOutbox.ts; infra/db/02-media-outbox.sql",
  }),
  "trust.outbox_events": Object.freeze({
    status: "MISSING_BLOCKS_ACCEPTANCE",
    reason: "DDL present; no repository publisher implementation located",
    evidence: "infra/db/03-trust-outbox.sql",
  }),
  "notification.outbox_events": Object.freeze({
    status: "MISSING_BLOCKS_ACCEPTANCE",
    reason: "DDL present; no repository publisher implementation located",
    evidence: "infra/db/03-notification-outbox.sql",
  }),
  "shopping.outbox_events": Object.freeze({
    status: "MISSING_BLOCKS_ACCEPTANCE",
    reason:
      "shopping.outbox_events unwired; SaleCompleted drains listings.outbox_events instead",
    evidence:
      "infra/db/01-shopping-outbox.sql; services/shopping-service/src/lib/sale-completed-outbox-drain.ts",
  }),
});

export function assertPublisherDisposition(disposition, label = "publisher_disposition") {
  if (!disposition || typeof disposition !== "object") {
    throw new Error(`${label}_missing`);
  }
  if (!PUBLISHER_DISPOSITION_STATUSES.includes(disposition.status)) {
    throw new Error(`${label}_invalid_status:${disposition.status}`);
  }
  if (typeof disposition.reason !== "string" || disposition.reason.trim().length === 0) {
    throw new Error(`${label}_reason_empty`);
  }
  if (typeof disposition.evidence !== "string" || disposition.evidence.trim().length === 0) {
    throw new Error(`${label}_evidence_empty`);
  }
  return true;
}

/** Static contract metadata keyed by schema.table */
export const OUTBOX_REGISTRY = {
  "auth.outbox_events": {
    service: "auth-service",
    publisher_owner: "auth-service",
    publisher_present: false,
    disposition: "DDL_CANONICAL_UNWIRED",
    creation_transition: "domain_write + INSERT auth.outbox_events same transaction (canonical DDL)",
    publisher_implementation: "none — active publisher uses auth.auth_outbox",
    poll_batch: { model: "unwired", batch_limit: null, claim: null },
    topic: "${ENV_PREFIX}.auth.events",
    kafka_principal: "CN=auth-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.auth.events", "WRITE ${ENV_PREFIX}.user.lifecycle.v1"],
    retry: { model: "ABSENT" },
    lease: { model: "ABSENT" },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "future auth domain consumers via EventEnvelope",
    cleanup_disposition: "RETAINED published=true",
  },
  "auth.auth_outbox": {
    service: "auth-service",
    publisher_owner: "auth-service",
    publisher_present: true,
    disposition: "INVENTORIED",
    creation_transition: "account lifecycle / domain write + INSERT auth.auth_outbox same transaction",
    publisher_implementation: "services/auth-service/src/lib/auth-outbox-publisher.ts",
    poll_batch: {
      interval_ms: null,
      batch_limit: 50,
      env_batch: "AUTH_OUTBOX_BATCH",
      claim: "FOR UPDATE SKIP LOCKED",
    },
    topic: "row.topic (e.g. ${ENV_PREFIX}.user.lifecycle.v1)",
    kafka_principal: "CN=auth-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.auth.events", "WRITE ${ENV_PREFIX}.user.lifecycle.v1"],
    retry: { model: "retry_count column", max_attempts: null, backoff: "implicit per tick" },
    lease: { model: "transactional row lock only", leased_until_column: false },
    terminal_predicates: ["published_at IS NOT NULL"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published_at", after_broker_ack: true },
    consumer_groups: ["lifecycle-consumer"],
    business_effect: "GDPR account deletion / lifecycle ack consumers",
    cleanup_disposition: "RETAINED published_at set",
    supplemental: true,
    ddl_source:
      "services/auth-service/prisma/migrations/20260404120000_auth_transactional_outbox/migration.sql",
  },
  "records.outbox_events": {
    service: "records-service",
    publisher_owner: "records-service",
    publisher_present: false,
    disposition: "PUBLISHER_ABSENT_EXPLICIT",
    creation_transition: "domain write + INSERT records.outbox_events same transaction",
    publisher_implementation: "none located in repository",
    poll_batch: { model: "unwired", batch_limit: null, claim: null },
    topic: "${ENV_PREFIX}.records.events",
    kafka_principal: "CN=records-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.records.events"],
    retry: { model: "ABSENT" },
    lease: { model: "ABSENT" },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "records domain consumers (unwired publisher)",
    cleanup_disposition: "RETAINED published=true",
  },
  "messaging.outbox_events": {
    service: "messaging-service",
    publisher_owner: "messaging-service",
    publisher_present: false,
    disposition: "PUBLISHER_ABSENT_EXPLICIT",
    creation_transition: "send message + INSERT messaging.outbox_events same transaction",
    publisher_implementation: "none located — integration tests insert only",
    poll_batch: { model: "unwired", batch_limit: null, claim: null },
    topic: "messaging.events.v1",
    kafka_principal: "CN=messaging-service",
    acl_expectations: ["WRITE messaging.events.v1"],
    retry: { model: "ABSENT" },
    lease: { model: "ABSENT" },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "messaging consumers (MessageSentV1)",
    cleanup_disposition: "RETAINED published=true",
  },
  "media.outbox_events": {
    service: "media-service",
    publisher_owner: "media-service",
    publisher_present: false,
    disposition: "PUBLISHER_ABSENT_EXPLICIT",
    creation_transition: "CompleteUpload verified + INSERT media.outbox_events same transaction",
    publisher_implementation:
      "services/media-service/src/outbox/insertOutbox.ts (insert only; no publish/mark)",
    poll_batch: { model: "ABSENT", batch_limit: null, claim: null },
    topic: "${ENV_PREFIX}.media.events",
    kafka_principal: "CN=media-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.media.events (not provisioned)"],
    retry: { model: "ABSENT" },
    lease: { model: "ABSENT" },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "MediaUploadedV1 consumers (unwired)",
    cleanup_disposition: "RETAINED — write-only ledger relative to Kafka",
    annotations: ["publisher ownership/implementation gap — explicit disposition not silent ack"],
  },
  "listings.outbox_events": {
    service: "listings-service",
    publisher_owner: "listings-service",
    publisher_present: true,
    disposition: "INVENTORIED",
    creation_transition:
      "auction/offers domain write or shopping SALE_COMPLETED + INSERT listings.outbox_events",
    publisher_implementation:
      "services/listings-service/src/listings-auction-outbox.ts; listings-offers-outbox.ts; services/shopping-service/src/lib/sale-completed-outbox-drain.ts",
    poll_batch: {
      interval_ms: null,
      batch_limit: 25,
      claim: "FOR UPDATE SKIP LOCKED / lease_outbox_batch (SaleCompleted)",
    },
    topic: "${ENV_PREFIX}.listing.events",
    kafka_principal: "CN=listings-service / CN=shopping-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.listing.events"],
    retry: {
      model: "retry_count + next_attempt_at + last_error",
      max_attempts: 8,
      env: "PHASE34_OUTBOX_MAX_RETRIES",
    },
    lease: {
      model: "leased_until + lease_owner",
      env_lease_ms: "PHASE34_OUTBOX_LEASE_MS",
      default_lease_ms: 30000,
    },
    terminal_predicates: ["published=true", "dead_lettered=true"],
    dlq: { present: true, column: "dead_lettered", after_retry_exhaustion: true },
    broker_ack: { required: true, marks_published: false, columns: ["broker_topic", "broker_partition", "broker_offset"] },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: ["market-event-consumer"],
    business_effect: "listing/market event normalization + settlement lineage",
    cleanup_disposition: "RETAINED — DLQ rows preserved; never bulk mark DLQ published to pass quiesce",
    annotations: [
      "terminal DLQ cohort preserved as separate gate",
      "contract orphan cohorts (SALE_COMPLETED casing / non-drain types)",
    ],
  },
  "trust.outbox_events": {
    service: "trust-service",
    publisher_owner: "trust-service",
    publisher_present: false,
    disposition: "PUBLISHER_ABSENT_EXPLICIT",
    creation_transition: "trust domain write + INSERT trust.outbox_events same transaction",
    publisher_implementation: "none located in repository",
    poll_batch: { model: "unwired", batch_limit: null, claim: null },
    topic: "${ENV_PREFIX}.trust.events",
    kafka_principal: "CN=trust-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.trust.events"],
    retry: { model: "ABSENT" },
    lease: { model: "ABSENT" },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "trust domain consumers (unwired)",
    cleanup_disposition: "RETAINED published=true",
  },
  "notification.outbox_events": {
    service: "notification-service",
    publisher_owner: "notification-service",
    publisher_present: false,
    disposition: "PUBLISHER_ABSENT_EXPLICIT",
    creation_transition: "notification domain write + INSERT notification.outbox_events",
    publisher_implementation: "none located in repository",
    poll_batch: { model: "unwired", batch_limit: null, claim: null },
    topic: "${ENV_PREFIX}.notification.events",
    kafka_principal: "CN=notification-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.notification.events"],
    retry: { model: "ABSENT" },
    lease: { model: "ABSENT" },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: ["notification-consumer"],
    business_effect: "notification dispatch consumers (unwired publisher)",
    cleanup_disposition: "RETAINED published=true",
  },
  "shopping.outbox_events": {
    service: "shopping-service",
    publisher_owner: "shopping-service",
    publisher_present: false,
    disposition: "PUBLISHER_ABSENT_EXPLICIT",
    creation_transition: "shopping domain write + INSERT shopping.outbox_events",
    publisher_implementation:
      "SaleCompleted uses listings.outbox_events — shopping.outbox_events unwired",
    poll_batch: { model: "unwired", batch_limit: null, claim: null },
    topic: "${ENV_PREFIX}.shopping.events",
    kafka_principal: "CN=shopping-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.shopping.events"],
    retry: { model: "ABSENT" },
    lease: { model: "ABSENT" },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "shopping domain consumers (table present; publisher unwired)",
    cleanup_disposition: "RETAINED published=true",
  },
  "auction_monitor.outbox_events": {
    service: "auction-monitor",
    publisher_owner: "auction-monitor",
    publisher_present: true,
    disposition: "INVENTORIED",
    creation_transition:
      "scanAndPersistAuctionSignals ON CONFLICT + INSERT auction_monitor.outbox_events",
    publisher_implementation: "services/auction-monitor/src/ai-signals.ts publishAuctionMonitorOutbox",
    poll_batch: {
      interval_ms: 120000,
      batch_limit: 25,
      claim: "FOR UPDATE SKIP LOCKED",
    },
    topic: "${ENV_PREFIX}.auction_monitor.events",
    kafka_principal: "CN=auction-monitor",
    acl_expectations: ["WRITE ${ENV_PREFIX}.auction_monitor.events"],
    retry: { model: "ABSENT — failed publish leaves row unpublished" },
    lease: { model: "ephemeral FOR UPDATE SKIP LOCKED only", leased_until_column: false },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "auction signal / AI insight downstream consumers",
    cleanup_disposition: "RETAINED published=true",
    annotations: [
      "publisher exists — capacity-limited historically",
      "canary-v3 closes auction-monitor evidence only — not platform-wide outbox PASS",
    ],
  },
  "ai.outbox_events": {
    service: "python-ai-service",
    publisher_owner: "python-ai-service",
    publisher_present: true,
    disposition: "INVENTORIED",
    creation_transition: "AI insight route + INSERT ai.outbox_events same transaction",
    publisher_implementation: "services/python-ai-service/app/ai/outbox.py",
    poll_batch: { batch_limit: 25, claim: "FOR UPDATE SKIP LOCKED" },
    topic: "${ENV_PREFIX}.ai.events",
    kafka_principal: "CN=python-ai-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.ai.events"],
    retry: { model: "ABSENT" },
    lease: { model: "transactional row lock only", leased_until_column: false },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: ["inference-consumer"],
    business_effect: "AI insight / inference consumers",
    cleanup_disposition: "RETAINED published=true",
  },
  "analytics.outbox_events": {
    service: "analytics-service",
    publisher_owner: "analytics-service",
    publisher_present: true,
    disposition: "INVENTORIED",
    creation_transition: "analytics AI insight + INSERT analytics.outbox_events",
    publisher_implementation: "services/analytics-service/src/lib/analytics-ai-outbox.ts",
    poll_batch: { batch_limit: 25, claim: "FOR UPDATE SKIP LOCKED" },
    topic: "${ENV_PREFIX}.ai.events (AIInsightCreatedV1)",
    kafka_principal: "CN=analytics-service",
    acl_expectations: ["WRITE ${ENV_PREFIX}.ai.events", "WRITE ${ENV_PREFIX}.analytics.events"],
    retry: { model: "ABSENT" },
    lease: { model: "transactional row lock only", leased_until_column: false },
    terminal_predicates: ["published=true"],
    dlq: { present: false },
    broker_ack: { required: true, marks_published: false },
    db_ack: { required: true, column: "published", after_broker_ack: true },
    consumer_groups: [],
    business_effect: "analytics AI insight consumers",
    cleanup_disposition: "RETAINED published=true",
  },
};

export const SUPPLEMENTAL_OUTBOX_TABLES = ["auth.auth_outbox"];

export function sha256Json(value) {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  return createHash("sha256").update(raw).digest("hex");
}

export function discoverOutboxDdlFiles(repoRoot) {
  const dbDir = join(repoRoot, "infra/db");
  if (!existsSync(dbDir)) {
    throw new Error("infra/db_missing");
  }
  return readdirSync(dbDir)
    .filter((f) => f.endsWith("-outbox.sql"))
    .sort();
}

export function parseOutboxDdl(content, filename) {
  const tableMatch = content.match(
    /CREATE TABLE IF NOT EXISTS\s+(\w+)\.outbox_events/i,
  );
  if (!tableMatch) {
    throw new Error(`ddl_parse_failed:${filename}`);
  }
  const schema = tableMatch[1];
  return {
    schema,
    table: `${schema}.outbox_events`,
    database: schema === "auction_monitor" ? "auction_monitor" : schema,
    ddl_source: `infra/db/${filename}`,
  };
}

function attachPublisherDisposition(row) {
  if (row.publisher_present === true) {
    return { ...row, publisher_disposition: null };
  }
  const fromRegistry = row.publisher_disposition;
  const fromMap = PUBLISHER_ABSENT_DISPOSITIONS[row.table];
  const disposition = fromRegistry || fromMap;
  if (!disposition) {
    throw new Error(`publisher_disposition_missing_for:${row.table}`);
  }
  assertPublisherDisposition(disposition, row.table);
  return {
    ...row,
    publisher_disposition: {
      status: disposition.status,
      reason: disposition.reason,
      evidence: disposition.evidence,
    },
  };
}

export function buildDiscoveredOutboxRows(repoRoot) {
  for (const table of Object.keys(OUTBOX_REGISTRY)) {
    if (isForbiddenOutboxTable(table)) {
      throw new Error(`TRACK_C_INVENTORY_INVALID:forbidden_registry_entry:${table}`);
    }
  }

  const allDdlFiles = discoverOutboxDdlFiles(repoRoot);
  const forbiddenDdlFiles = [];
  const allowedDdlFiles = [];

  for (const filename of allDdlFiles) {
    const content = readFileSync(join(repoRoot, "infra/db", filename), "utf8");
    const parsed = parseOutboxDdl(content, filename);
    if (isForbiddenOutboxSchema(parsed.schema) || isForbiddenOutboxTable(parsed.table)) {
      forbiddenDdlFiles.push({
        filename,
        schema: parsed.schema,
        table: parsed.table,
        classification: "FORBIDDEN_NONEXISTENT_SERVICE",
        inventory_status: "ABSENT_BY_CONTRACT",
      });
      continue;
    }
    allowedDdlFiles.push({ filename, parsed });
  }

  // Forbidden schemas must never enter discovered Track C inventory rows.
  // Stale DDL on disk is recorded as ABSENT_BY_CONTRACT only.
  const rows = allowedDdlFiles.map(({ filename, parsed }) => {
    const registry = OUTBOX_REGISTRY[parsed.table];
    if (!registry) {
      throw new Error(`registry_missing:${parsed.table}`);
    }
    return attachPublisherDisposition({
      ...registry,
      ...parsed,
      in_platform_denominator: true,
      lifecycle_states_supported: [...LIFECYCLE_STATES],
      status_predicate: registry.terminal_predicates?.[0]?.includes("published_at")
        ? "published_at IS NULL"
        : "published=false",
    });
  });

  for (const table of SUPPLEMENTAL_OUTBOX_TABLES) {
    if (isForbiddenOutboxTable(table)) {
      throw new Error(`TRACK_C_INVENTORY_INVALID:forbidden_supplemental:${table}`);
    }
    const registry = OUTBOX_REGISTRY[table];
    if (!registry) throw new Error(`registry_missing:${table}`);
    const [schema] = table.split(".");
    rows.push(
      attachPublisherDisposition({
        ...registry,
        schema,
        table,
        database: schema,
        in_platform_denominator: true,
        lifecycle_states_supported: [...LIFECYCLE_STATES],
        status_predicate: "published_at IS NULL",
      }),
    );
  }

  assertNoForbiddenOutboxOwners(rows);
  rows.sort((a, b) => a.table.localeCompare(b.table));
  return {
    ddlFiles: allowedDdlFiles.map((entry) => entry.filename),
    allDdlFiles,
    forbiddenDdlFiles,
    rows,
  };
}

export function assertOutboxInventory(inventory) {
  const failures = [];
  if (inventory?.execution_authorized === true) {
    failures.push("execution_authorized_must_be_false");
  }
  if (inventory?.canary_v3_is_platform_wide_pass === true) {
    failures.push("canary_v3_must_not_imply_platform_wide_pass");
  }
  if (inventory?.lifecycle_publish_executed === true) {
    failures.push("lifecycle_publish_executed_must_be_false");
  }

  const expected =
    inventory?.expected_count ?? inventory?.outboxes_expected;
  const discovered =
    inventory?.discovered_count ?? inventory?.outboxes_discovered;
  const owners = inventory?.owners || [];

  try {
    assertNoForbiddenOutboxOwners(owners);
  } catch (err) {
    failures.push(String(err.message || err));
  }

  if (typeof expected !== "number") failures.push("missing_expected_count");
  if (typeof discovered !== "number") failures.push("missing_discovered_count");
  if (expected !== TRACK_C_EXPECTED_OWNER_COUNT) {
    failures.push(
      `expected_count_not_canonical:${expected}!=${TRACK_C_EXPECTED_OWNER_COUNT}`,
    );
  }
  if (expected !== discovered) {
    failures.push(`expected_discovered_mismatch:${expected}!=${discovered}`);
  }
  if (owners.length !== discovered) {
    failures.push(`owners_length_mismatch:${owners.length}!=${discovered}`);
  }

  const complete = expected === discovered && owners.length === discovered;
  if (inventory?.complete !== undefined && inventory.complete !== complete) {
    failures.push(`complete_flag_mismatch:actual=${inventory.complete}:computed=${complete}`);
  }
  if (complete !== true) {
    failures.push("denominator_incomplete");
  }

  if (owners.length === 14) {
    failures.push("TRACK_C_INVENTORY_INVALID:fourteen_owner_artifact");
  }
  if (owners.length !== TRACK_C_EXPECTED_OWNER_COUNT) {
    failures.push(
      `owner_count_not_canonical:${owners.length}!=${TRACK_C_EXPECTED_OWNER_COUNT}`,
    );
  }
  if (
    inventory?.inventory_sha256 &&
    OBSOLETE_INVENTORY_SHA256.includes(inventory.inventory_sha256)
  ) {
    failures.push(
      `TRACK_C_INVENTORY_INVALID:obsolete_inventory_sha:${inventory.inventory_sha256}`,
    );
  }
  try {
    assertObsoleteInventoryDigests(inventory, OBSOLETE_INVENTORY_SHA256);
  } catch (err) {
    failures.push(String(err.message || err));
  }

  const ownershipKeys = new Set();
  for (const [i, row] of owners.entries()) {
    if (!row.service) failures.push(`row_${i}:missing_service`);
    if (!row.publisher_owner) failures.push(`row_${i}:missing_publisher_owner`);
    if (!row.database) failures.push(`row_${i}:missing_database`);
    if (!row.table) failures.push(`row_${i}:missing_table`);
    if (!row.topic) failures.push(`row_${i}:missing_topic`);
    if (!row.status_predicate) failures.push(`row_${i}:missing_status_predicate`);
    if (typeof row.publisher_present !== "boolean") {
      failures.push(`row_${i}:publisher_present_not_boolean`);
    }

    const ownershipKey = `${row.database}::${row.table}`;
    if (ownershipKeys.has(ownershipKey)) {
      failures.push(`duplicate_database_table_ownership:${ownershipKey}`);
    }
    ownershipKeys.add(ownershipKey);

    if (row.publisher_present === false) {
      if (!row.disposition || row.disposition === "INVENTORIED") {
        failures.push(`row_${i}:silent_ack_publisher_absent`);
      }
      try {
        assertPublisherDisposition(
          row.publisher_disposition,
          `row_${i}:${row.table}`,
        );
      } catch (err) {
        failures.push(String(err.message || err));
      }
    }

    for (const field of REQUIRED_CONTRACT_FIELDS) {
      if (row[field] === undefined || row[field] === null) {
        failures.push(`row_${i}:missing_${field}`);
      }
    }
    if (!Array.isArray(row.lifecycle_states_supported)) {
      failures.push(`row_${i}:missing_lifecycle_states_supported`);
    } else if (row.lifecycle_states_supported.length !== LIFECYCLE_STATES.length) {
      failures.push(`row_${i}:lifecycle_states_incomplete`);
    }
  }

  const absentWithoutExplicit = owners.filter(
    (r) => r.publisher_present === false && r.disposition === "INVENTORIED",
  );
  if (absentWithoutExplicit.length) {
    failures.push("silent_ack_publisher_absent");
  }

  if (failures.length) {
    const err = new Error(`outbox_inventory_invalid:${failures.join(",")}`);
    err.failures = failures;
    throw err;
  }
  return true;
}

export function buildPreparedOutboxInventory(repoRoot) {
  const { ddlFiles, allDdlFiles, forbiddenDdlFiles, rows } =
    buildDiscoveredOutboxRows(repoRoot);
  const discoveredCount = rows.length;
  const expectedCount = TRACK_C_EXPECTED_OWNER_COUNT;
  const complete =
    expectedCount === discoveredCount &&
    ddlFiles.length + SUPPLEMENTAL_OUTBOX_TABLES.length === discoveredCount;

  if (!complete) {
    throw new Error(
      `outbox_denominator_closure_failed:expected=${expectedCount},discovered=${discoveredCount},allowed_ddl=${ddlFiles.length}`,
    );
  }

  assertNoForbiddenOutboxOwners(rows);

  return {
    schema: "outbox-owner-inventory/v1",
    status: "PREPARED",
    execution_authorized: false,
    canary_v3_is_platform_wide_pass: false,
    lifecycle_publish_executed: false,
    track_b_terminal_sha256:
      "3d4d06245f0acde997bea77db4a9b32ab5be6563fc1979faeb71defe4ae569bb",
    expected_count: expectedCount,
    discovered_count: discoveredCount,
    complete: true,
    outboxes_expected: expectedCount,
    outboxes_discovered: discoveredCount,
    ddl_outbox_sql_files: ddlFiles.length,
    ddl_outbox_sql_files_on_disk: allDdlFiles.length,
    supplemental_tables: SUPPLEMENTAL_OUTBOX_TABLES.length,
    platform_postgres_databases_expected: 11,
    forbidden_nonexistent_services: {
      booking: "FORBIDDEN_NONEXISTENT_SERVICE",
      social: "FORBIDDEN_NONEXISTENT_SERVICE",
      inventory_status: "ABSENT_BY_CONTRACT",
      stale_ddl_on_disk: forbiddenDdlFiles,
    },
    obsolete_inventory_sha256: [...OBSOLETE_INVENTORY_SHA256],
    owners: rows,
    outboxes: rows,
    lifecycle_states: [...LIFECYCLE_STATES],
    required_lifecycle_states_for_pass: [...REQUIRED_LIFECYCLE_STATES_FOR_PASS],
    mutually_exclusive_terminals: [...MUTUALLY_EXCLUSIVE_TERMINALS],
    publisher_disposition_statuses: [...PUBLISHER_DISPOSITION_STATUSES],
    notes: [
      "PREPARED static inventory — no live lifecycle publish or historical mutation.",
      "publisher_present=false requires publisher_disposition {status,reason,evidence}.",
      "Auction-monitor canary-v3 does not close platform-wide outbox denominator.",
      "Track B terminal referenced as prior evidence only; Packet B not reopened.",
      "booking/social are FORBIDDEN_NONEXISTENT_SERVICE — ABSENT_BY_CONTRACT, not disposition rows.",
      "Obsolete 14/14 SHA 70ae0ee0… must not be carried forward.",
      "Listings DLQ + orphan cohorts preserved as contract annotations.",
    ],
  };
}

export function buildTrackCResult(inventory) {
  assertOutboxInventory(inventory);
  const publisherAbsentRows = inventory.owners.filter((r) => !r.publisher_present);
  const allExplicit = publisherAbsentRows.every(
    (r) =>
      r.disposition &&
      r.disposition !== "INVENTORIED" &&
      r.publisher_disposition?.status &&
      PUBLISHER_DISPOSITION_STATUSES.includes(r.publisher_disposition.status),
  );
  const acceptanceBlockers = publisherAbsentRows.filter(
    (r) => r.publisher_disposition?.status === "MISSING_BLOCKS_ACCEPTANCE",
  );
  return {
    track: "C",
    verdict: "HARNESS_PASS",
    platform_pass: false,
    execution_authorized: false,
    lifecycle_publish_executed: false,
    expected_count: inventory.expected_count ?? inventory.outboxes_expected,
    discovered_count: inventory.discovered_count ?? inventory.outboxes_discovered,
    complete: inventory.complete === true,
    outboxes_expected: inventory.outboxes_expected,
    outboxes_discovered: inventory.outboxes_discovered,
    publisher_absent_rows_explicit: allExplicit,
    publisher_absent_count: publisherAbsentRows.length,
    publisher_present_count: inventory.owners.filter((r) => r.publisher_present).length,
    missing_blocks_acceptance_count: acceptanceBlockers.length,
    acceptance_blockers: acceptanceBlockers.map((r) => r.table),
    platform_in_denominator_count: inventory.owners.filter((r) => r.in_platform_denominator)
      .length,
    canary_v3_is_platform_wide_pass: false,
    track_b_terminal_sha256: inventory.track_b_terminal_sha256 ?? null,
    forbidden_nonexistent_absent_by_contract: true,
    obsolete_14_14_inventory_sha256_rejected: true,
  };
}
