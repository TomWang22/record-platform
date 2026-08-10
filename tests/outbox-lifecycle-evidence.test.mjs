import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  OutboxLifecycleEvidenceError,
  assertMutuallyExclusiveTerminal,
  assertZeroUnknowns,
  buildFixtureLifecycleEvidence,
  classifyFailureRecoveryRow,
  computeLatencyMs,
  createLifecycleRecorder,
  deriveLatencyFromEndpoints,
  finalizeLifecycleEvidence,
  recordLifecycleState,
  requiredLifecycleStatesForPass,
  setFrozenIdentity,
} from "../scripts/lib/outbox_lifecycle_evidence.mjs";
import { auditOutboxLifecycleEvidence } from "../scripts/audit-outbox-lineage-harness.mjs";

test("Track C lifecycle: fixture evidence passes with zero unknowns", () => {
  const evidence = buildFixtureLifecycleEvidence();
  assert.equal(evidence.verdict, "HARNESS_PASS");
  assertZeroUnknowns(evidence);
  assert.equal(evidence.row_key.event_id, evidence.frozen_identity.event_id);
  const audit = auditOutboxLifecycleEvidence(evidence);
  assert.equal(audit.pass, true);
});

test("Track C lifecycle: refuses SUCCESS without all required states", () => {
  const recorder = createLifecycleRecorder({
    runId: "incomplete-run",
    outboxTable: "media.outbox_events",
  });
  recordLifecycleState(recorder, "created", null);
  assert.throws(
    () => finalizeLifecycleEvidence(recorder),
    (err) =>
      err instanceof OutboxLifecycleEvidenceError &&
      String(err.message).includes("lifecycle_evidence_incomplete"),
  );
});

test("Track C lifecycle: missing latency endpoint is unknown never zero", () => {
  assert.deepEqual(computeLatencyMs(null, "1970-01-01T00:00:00.000Z"), {
    duration_ms: null,
    unknown: true,
  });
  assert.equal(
    computeLatencyMs("1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.010Z").duration_ms,
    10,
  );

  const recorder = createLifecycleRecorder({
    runId: "latency-run",
    outboxTable: "media.outbox_events",
  });
  setFrozenIdentity(recorder, {
    run_id: "latency-run",
    event_id: "e1",
    outbox_primary_key: "pk1",
    payload_sha256: "x",
    producer_principal: "CN=x",
    producer_client_id: "x",
    topic: "t",
    partition: 0,
    offset: "0",
    time_covered_leader_broker: "b0",
    consumer_group: "g",
    consumer_principal: "CN=c",
    consumer_offset: "0",
    business_effect_identifier: "fx",
  });
  for (const state of requiredLifecycleStatesForPass()) {
    recordLifecycleState(recorder, state, null);
  }
  deriveLatencyFromEndpoints(recorder);
  assert.throws(() => assertZeroUnknowns(recorder), /unknowns_must_be_zero/);
  assert.ok(recorder.latency.insert_to_selection.unknowns > 0);
  assert.equal(recorder.latency.insert_to_selection.p50, null);
});

test("Track C lifecycle: unknown latency bucket increments unknowns and fails PASS", () => {
  const recorder = buildFixtureLifecycleEvidence();
  recorder.latency.insert_to_selection.unknowns = 1;
  assert.throws(() => assertZeroUnknowns(recorder), /unknowns_must_be_zero/);
});

test("Track C lifecycle: mutually exclusive terminals enforced", () => {
  const recorder = createLifecycleRecorder({
    runId: "terminal-conflict",
    outboxTable: "listings.outbox_events",
  });
  recordLifecycleState(recorder, "dead_lettered", null);
  recordLifecycleState(recorder, "orphaned", null);
  assert.throws(
    () => assertMutuallyExclusiveTerminal(recorder),
    /mutually_exclusive_terminal_violation/,
  );
});

test("Track C lifecycle: failure/recovery classifications", () => {
  assert.equal(
    classifyFailureRecoveryRow("duplicate_delivery", "consumer_deduped"),
    "benign",
  );
  assert.equal(
    classifyFailureRecoveryRow("retry_exhaustion", "dead_lettered"),
    "terminal",
  );
  assert.equal(
    classifyFailureRecoveryRow(
      "publisher_restart_after_broker_ack_before_db_ack",
      "broker_ack_without_db_ack",
    ),
    "orphan_risk",
  );
});

test("Track C lifecycle: auditor exits non-zero on missing business effect", () => {
  const dir = mkdtempSync(join(tmpdir(), "outbox-audit-"));
  const path = join(dir, "bad-evidence.json");
  const bad = buildFixtureLifecycleEvidence();
  bad.lifecycle_states_observed = bad.lifecycle_states_observed.filter(
    (s) => s.state !== "business_effect_applied",
  );
  writeFileSync(path, `${JSON.stringify(bad, null, 2)}\n`);
  const audit = auditOutboxLifecycleEvidence(bad);
  assert.equal(audit.pass, false);
  assert.ok(audit.failures.some((f) => f.includes("business_effect")));

  const proc = spawnSync("node", ["scripts/audit-outbox-lineage-harness.mjs", path], {
    encoding: "utf8",
  });
  assert.notEqual(proc.status, 0);
});

test("Track C lifecycle: auditor rejects missing offset commit", () => {
  const bad = buildFixtureLifecycleEvidence();
  bad.lifecycle_states_observed = bad.lifecycle_states_observed.filter(
    (s) => s.state !== "offset_committed",
  );
  const audit = auditOutboxLifecycleEvidence(bad);
  assert.equal(audit.pass, false);
  assert.ok(audit.failures.some((f) => f.includes("offset")));
});

test("Track C lifecycle: frozen identity cannot invent payload", () => {
  const recorder = createLifecycleRecorder({
    runId: "identity-run",
    outboxTable: "auth.auth_outbox",
  });
  assert.throws(
    () => setFrozenIdentity(recorder, { payload_sha256: undefined }),
    /frozen_identity_invented/,
  );
});

test("Track C lifecycle: required pass states are explicit list of eight", () => {
  const required = requiredLifecycleStatesForPass();
  assert.ok(required.includes("broker_acknowledged"));
  assert.ok(required.includes("db_acknowledged"));
  assert.ok(required.includes("offset_committed"));
  assert.ok(required.includes("business_effect_applied"));
  assert.equal(required.length, 8);
  assert.ok(!required.includes("leased"));
});

test("Track C lifecycle: process exit alone is never success evidence", () => {
  const recorder = createLifecycleRecorder({
    runId: "exit-code-run",
    outboxTable: "media.outbox_events",
  });
  recorder.process_exit_code = 0;
  assert.throws(() => finalizeLifecycleEvidence(recorder), /lifecycle_evidence_incomplete/);
});
