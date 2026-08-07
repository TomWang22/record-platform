import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function runPy(code) {
  const r = spawnSync("python3", ["-c", code], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST || "unix:///tmp/colima-test.sock" },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

test("adversarial command, SQL, metadata, temporal-leader, and log-race bypasses", () => {
  const out = runPy(`
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO, "scripts/lib"))})
from auction_monitor_canary_v3_live_capture import (
    LIVE_CAPTURE_ACCEPTANCE_READY,
    ForbiddenLiveCaptureCommand,
    LiveCaptureError,
    LogCursor,
    assert_readonly_command,
    assert_readonly_sql_payload,
    bind_lifecycle_and_metadata_from_logs,
    build_readonly_psql_sql,
    capture_partition_leader_snapshots,
    kafka_describe_template,
    observe_publisher_tick_from_logs,
)

cases = {}

def forbid(name, fn):
    try:
        fn()
        cases[name] = "ALLOWED"
    except (ForbiddenLiveCaptureCommand, LiveCaptureError) as exc:
        cases[name] = str(exc)

def live(name, fn):
    try:
        result = fn()
        cases[name] = result if isinstance(result, (str, bool, int)) else "OK"
    except (ForbiddenLiveCaptureCommand, LiveCaptureError) as exc:
        cases[name] = str(exc)

# --- adversarial commands ---
forbid("shell_subst", lambda: assert_readonly_command([
    "kubectl", "-n", "record-platform", "get", "pod", "-l", "app=auction-monitor",
    "-o", "jsonpath={.items[0].metadata.name}$(rm -rf /)"
]))
forbid("newline_arg", lambda: assert_readonly_command([
    "kubectl", "-n", "record-platform", "get", "pod\\n--exec", "x"
]))
forbid("alt_kubectl_path", lambda: assert_readonly_command([
    "/usr/bin/kubectl", "-n", "record-platform", "get", "pod", "-l", "app=auction-monitor",
    "-o", "jsonpath={.items[0].metadata.name}"
]))
forbid("docker_entrypoint", lambda: assert_readonly_command([
    "docker", "--entrypoint", "/bin/sh", "exec", "cid", "psql", "-c", "SELECT 1"
], pinned_container_id="cid"))
forbid("unicode_ws_cmd", lambda: assert_readonly_command([
    "kubectl", "-n", "record-platform\\u00a0", "get", "pod", "x", "-o", "json"
]))
# exact kafka template still allowed
assert_readonly_command(list(kafka_describe_template()))
cases["kafka_template_ok"] = True

# --- adversarial SQL ---
forbid("sql_comment", lambda: assert_readonly_sql_payload("SELECT 1 -- DROP TABLE x"))
forbid("sql_block_comment", lambda: assert_readonly_sql_payload("SELECT 1 /* COPY x FROM STDIN */"))
forbid("sql_dollar_quote", lambda: assert_readonly_sql_payload("SELECT $$hi$$"))
forbid("sql_multi_stmt", lambda: assert_readonly_sql_payload("SELECT 1; DELETE FROM auction_monitor.outbox_events"))
forbid("sql_copy", lambda: assert_readonly_sql_payload("COPY auction_monitor.outbox_events TO STDOUT"))
forbid("sql_do", lambda: assert_readonly_sql_payload("DO $$ BEGIN PERFORM 1; END $$"))
forbid("sql_call", lambda: assert_readonly_sql_payload("CALL some_proc()"))
forbid("sql_unicode_ws", lambda: assert_readonly_sql_payload("SELECT\\u00a01"))
forbid("sql_writable_cte", lambda: assert_readonly_sql_payload(
    "WITH d AS (DELETE FROM auction_monitor.outbox_events RETURNING 1) SELECT count(*) FROM d"
))
forbid("sql_wrapped_smuggle", lambda: build_readonly_psql_sql("SELECT 1; UPDATE auction_monitor.outbox_events SET published=true"))

# --- temporal leader / metadata ---
before = {"valid_from": "2026-08-06T12:00:00Z", "valid_until": "2026-08-06T12:01:00Z", "leaders": {"0": 1, "1": 2}}
after_same = {"valid_from": "2026-08-06T12:01:00Z", "valid_until": "2026-08-06T12:02:00Z", "leaders": {"0": 1, "1": 2}}
after_diff = {"valid_from": "2026-08-06T12:01:00Z", "valid_until": "2026-08-06T12:02:00Z", "leaders": {"0": 9, "1": 2}}
live("leaders_differ", lambda: capture_partition_leader_snapshots(
    before=before, after=after_diff, row_partitions=[0]*25, ack_timestamps=["2026-08-06T12:00:30Z"]*25,
    batch_limit=25, invocation_id="inv"))
live("ack_outside_coverage", lambda: capture_partition_leader_snapshots(
    before=before, after=after_same, row_partitions=[0]*25, ack_timestamps=["2026-08-06T11:00:00Z"]*25,
    batch_limit=25, invocation_id="inv"))
live("partition_missing_before", lambda: capture_partition_leader_snapshots(
    before={"valid_from": "2026-08-06T12:00:00Z", "valid_until": "2026-08-06T12:01:00Z", "leaders": {"0": 1}},
    after={"valid_from": "2026-08-06T12:01:00Z", "valid_until": "2026-08-06T12:02:00Z", "leaders": {"0": 1}},
    row_partitions=[0,1]+[0]*23, ack_timestamps=["2026-08-06T12:00:30Z"]*25,
    batch_limit=25, invocation_id="inv"))

def row(i, **extra):
    base = {
        "msg": "auction_monitor_outbox_broker_and_db_ack",
        "invocation_id": "live-inv",
        "batch_id": "batch-1",
        "outbox_correlation_hash": f"h{i:02d}",
        "partition": i % 3,
        "offset": i,
        "database_ack_timestamp": "2026-08-06T12:00:03Z",
        "broker_ack_timestamp": "2026-08-06T12:00:02Z",
        "selection_timestamp": "2026-08-06T12:00:00Z",
        "produce_start_timestamp": "2026-08-06T12:00:01Z",
        "trace_id": "t",
        "kafkajs_record_metadata": {"partition": i % 3, "offset": i, "errorCode": 0},
    }
    base.update(extra)
    if "kafkajs_record_metadata" in extra:
        base["kafkajs_record_metadata"] = extra["kafkajs_record_metadata"]
    return "ts " + json.dumps(base)

def bind(lines):
    return bind_lifecycle_and_metadata_from_logs(
        log_text="\\n".join(lines),
        invocation_id="harness",
        published={"observed_invocation_id": "live-inv", "batch_id": "batch-1", "trace_id": "t"},
        leaders={"0": 1, "1": 2, "2": 3},
        batch_limit=25,
    )

# partition mismatch
lines = [row(i) for i in range(25)]
lines[0] = row(0, kafkajs_record_metadata={"partition": 2, "offset": 0, "errorCode": 0})
live("meta_partition_mismatch", lambda: bind(lines))
# offset mismatch
lines = [row(i) for i in range(25)]
lines[1] = row(1, kafkajs_record_metadata={"partition": 1 % 3, "offset": 999, "errorCode": 0})
live("meta_offset_mismatch", lambda: bind(lines))
# errorCode nonzero
lines = [row(i) for i in range(25)]
lines[2] = row(2, kafkajs_record_metadata={"partition": 2 % 3, "offset": 2, "errorCode": 42})
live("meta_error_code_nonzero", lambda: bind(lines))
# duplicate primary (partition, offset) across two hashes
lines = [row(i) for i in range(24)]
lines.append(row(24, outbox_correlation_hash="h99", partition=0, offset=0,
    kafkajs_record_metadata={"partition": 0, "offset": 0, "errorCode": 0}))
# fix row 24 partition fields for consistency with metadata
lines[-1] = "ts " + json.dumps({
    "msg": "auction_monitor_outbox_broker_and_db_ack",
    "invocation_id": "live-inv",
    "batch_id": "batch-1",
    "outbox_correlation_hash": "h99",
    "partition": 0,
    "offset": 0,
    "database_ack_timestamp": "2026-08-06T12:00:03Z",
    "broker_ack_timestamp": "2026-08-06T12:00:02Z",
    "selection_timestamp": "2026-08-06T12:00:00Z",
    "produce_start_timestamp": "2026-08-06T12:00:01Z",
    "trace_id": "t",
    "kafkajs_record_metadata": {"partition": 0, "offset": 0, "errorCode": 0},
})
live("duplicate_primary_metadata", lambda: bind(lines))

# --- log-race ---
cursor = LogCursor(since_time_utc="2026-08-06T13:00:00Z", known_batch_ids=frozenset())
two = "\\n".join([
    "ts " + json.dumps({"msg": "auction_monitor_outbox_publish_batch", "batch_id": "a", "invocation_id": "a", "time": "2026-08-06T13:00:01Z", "trace_id": "t1"}),
    "ts " + json.dumps({"msg": "auction_monitor_outbox_publish_batch", "batch_id": "b", "invocation_id": "b", "time": "2026-08-06T13:00:02Z", "trace_id": "t2"}),
])
live("ambiguous_two_batches", lambda: observe_publisher_tick_from_logs(
    log_text=two, index=0, invocation_id="h0", cursor=cursor))
no_ts = "ts " + json.dumps({"msg": "auction_monitor_outbox_publish_batch", "batch_id": "c", "invocation_id": "c", "trace_id": "t3"})
cases["timestamp_free_ignored"] = observe_publisher_tick_from_logs(
    log_text=no_ts, index=0, invocation_id="h0", cursor=cursor) is None

# identical duplicates are deduped (explicit policy); 25 unique terminal rows succeed
ident = [row(i) for i in range(25)]
ident.append(row(0))  # identical duplicate of h00
bound = bind(ident)
cases["identical_duplicate_policy"] = bound is not None and len(bound[0]["rows"]) == 25

# partial scrape (<25) returns None rather than accepting
partial = [row(i) for i in range(10)]
cases["partial_scrape_waits"] = bind(partial) is None

print(json.dumps({
    "LIVE_CAPTURE_ACCEPTANCE_READY": LIVE_CAPTURE_ACCEPTANCE_READY,
    "cases": cases,
}))
`);

  assert.equal(out.LIVE_CAPTURE_ACCEPTANCE_READY, false);
  const c = out.cases;
  assert.match(c.shell_subst, /metachar|forbidden/);
  assert.match(c.newline_arg, /metachar|forbidden/);
  assert.match(c.alt_kubectl_path, /binary_not_readonly/);
  assert.match(c.docker_entrypoint, /entrypoint|not_allowlisted|metachar|forbidden/);
  assert.match(c.unicode_ws_cmd, /metachar|unicode|forbidden/);
  assert.equal(c.kafka_template_ok, true);
  assert.match(c.sql_comment, /comment/);
  assert.match(c.sql_block_comment, /comment/);
  assert.match(c.sql_dollar_quote, /dollar/);
  assert.match(c.sql_multi_stmt, /multiple_statements|mutating/);
  assert.match(c.sql_copy, /mutating|sql_not_select/);
  assert.match(c.sql_do, /mutating|sql_not_select|dollar/);
  assert.match(c.sql_call, /mutating|sql_not_select/);
  assert.match(c.sql_unicode_ws, /unicode/);
  assert.match(c.sql_writable_cte, /mutating_with/);
  assert.match(c.sql_wrapped_smuggle, /multiple_statements|mutating/);
  assert.match(c.leaders_differ, /leader_bracket_leaders_changed/);
  assert.match(c.ack_outside_coverage, /ack_timestamp_not_time_covered/);
  assert.match(c.partition_missing_before, /partition_missing_from_before|leaders_changed/);
  assert.match(c.meta_partition_mismatch, /partition_mismatch/);
  assert.match(c.meta_offset_mismatch, /offset_mismatch/);
  assert.match(c.meta_error_code_nonzero, /error_code_nonzero/);
  assert.match(c.duplicate_primary_metadata, /duplicate_primary_record_metadata/);
  assert.match(c.ambiguous_two_batches, /publisher_batch_ambiguous/);
  assert.equal(c.timestamp_free_ignored, true);
  assert.equal(c.identical_duplicate_policy, true);
  assert.equal(c.partial_scrape_waits, true);
});
