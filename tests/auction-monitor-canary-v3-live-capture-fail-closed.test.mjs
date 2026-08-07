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

test("live-capture fail-closed regression suite", () => {
  const out = runPy(`
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO, "scripts/lib"))})
from auction_monitor_canary_v3_live_capture import (
    LIVE_CAPTURE_ACCEPTANCE_READY,
    DockerExecutionPlanePin,
    ForbiddenLiveCaptureCommand,
    LiveCaptureError,
    LiveReadonlyCaptureSession,
    LogCursor,
    assert_readonly_command,
    assert_readonly_sql_payload,
    bind_lifecycle_and_metadata_from_logs,
    build_readonly_psql_sql,
    capture_observability_snapshot,
    capture_partition_leader_snapshots,
    compute_database_equation_terms,
    kafka_describe_template,
    observe_publisher_tick_from_logs,
    verify_docker_execution_plane,
)

cases = {}

def expect_forbidden(name, fn):
    try:
        fn()
        cases[name] = "ALLOWED"
    except ForbiddenLiveCaptureCommand as exc:
        cases[name] = str(exc)
    except LiveCaptureError as exc:
        cases[name] = str(exc)

def expect_live(name, fn):
    try:
        fn()
        cases[name] = "ALLOWED"
    except LiveCaptureError as exc:
        cases[name] = str(exc)
    except ForbiddenLiveCaptureCommand as exc:
        cases[name] = str(exc)

# 1) kubectl exec mutation rejected
expect_forbidden("kubectl_exec_mutation", lambda: assert_readonly_command([
    "kubectl", "-n", "record-platform", "exec", "auction-monitor-0", "--", "sh", "-c", "rm -rf /tmp/x"
]))

# 2) psql without -c rejected
expect_forbidden("psql_without_c", lambda: assert_readonly_command([
    "docker", "exec", "cid123", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A"
], pinned_container_id="cid123"))

# 3) SELECT containing mutating function/CTE rejected
expect_forbidden("mutating_select", lambda: assert_readonly_sql_payload(
    "SELECT pg_terminate_backend(1)"
))
expect_forbidden("mutating_cte", lambda: assert_readonly_sql_payload(
    "WITH x AS (DELETE FROM auction_monitor.outbox_events RETURNING 1) SELECT * FROM x"
))
# wrapped form also rejected
expect_forbidden("mutating_wrapped", lambda: build_readonly_psql_sql(
    "SELECT setval('x', 1)"
))

# kafka describe template still allowed; tmp props bash rejected
assert_readonly_command(list(kafka_describe_template()))
cases["kafka_describe_allowed"] = True
expect_forbidden("tmp_props_bash", lambda: assert_readonly_command([
    "kubectl", "-n", "record-platform", "exec", "kafka-0", "--", "bash", "-ec",
    "cat >/tmp/rp-canary-v3-describe.props <<EOF\\nsecurity.protocol=SSL\\nEOF"
]))

# 4) missing actual partitions fails
expect_live("missing_partitions", lambda: capture_partition_leader_snapshots(
    before={"valid_from": "2026-08-06T12:00:00Z", "valid_until": "2026-08-06T12:01:00Z", "leaders": {"0": 1}},
    after={"valid_from": "2026-08-06T12:01:00Z", "valid_until": "2026-08-06T12:02:00Z", "leaders": {"0": 1}},
    row_partitions=[],
    ack_timestamps=[],
    batch_limit=25,
    invocation_id="inv",
))

# 5) single unbounded leader snapshot fails
expect_live("unbounded_leader", lambda: capture_partition_leader_snapshots(
    before={"valid_from": "2026-08-06T12:00:00Z", "valid_until": None, "leaders": {"0": 1}},
    after={"valid_from": "2026-08-06T12:01:00Z", "valid_until": "2026-08-06T12:02:00Z", "leaders": {"0": 1}},
    row_partitions=[0]*25,
    ack_timestamps=["2026-08-06T12:00:30Z"]*25,
    batch_limit=25,
    invocation_id="inv",
))

# 6) missing primary RecordMetadata fails
log_missing_meta = "\\n".join(
    "ts " + json.dumps({
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
    })
    for i in range(25)
)
expect_live("missing_record_metadata", lambda: bind_lifecycle_and_metadata_from_logs(
    log_text=log_missing_meta,
    invocation_id="harness",
    published={"observed_invocation_id": "live-inv", "batch_id": "batch-1", "trace_id": "t"},
    leaders={"0": 1, "1": 2, "2": 3},
    batch_limit=25,
))

# 7) stale pre-window batch ignored
cursor = LogCursor(since_time_utc="2026-08-06T13:00:00Z", known_batch_ids=frozenset())
stale = json.dumps({
    "msg": "auction_monitor_outbox_publish_batch",
    "batch_id": "stale-batch",
    "invocation_id": "old",
    "time": "2026-08-06T12:59:00Z",
    "trace_id": "old-trace",
})
observed = observe_publisher_tick_from_logs(
    log_text="ts " + stale,
    index=0,
    invocation_id="harness-0",
    cursor=cursor,
)
cases["stale_prewindow_ignored"] = observed is None

# new batch after cursor is accepted
fresh = json.dumps({
    "msg": "auction_monitor_outbox_publish_batch",
    "batch_id": "fresh-batch",
    "invocation_id": "new",
    "time": "2026-08-06T13:00:05Z",
    "trace_id": "new-trace",
})
observed2 = observe_publisher_tick_from_logs(
    log_text="ts " + stale + "\\nts " + fresh,
    index=0,
    invocation_id="harness-0",
    cursor=cursor,
)
cases["fresh_batch_accepted"] = observed2 is not None and observed2.get("batch_id") == "fresh-batch"

# 8) conflicting duplicate lifecycle rows fail
dup_lines = []
for i in range(24):
    dup_lines.append("ts " + json.dumps({
        "msg": "auction_monitor_outbox_broker_and_db_ack",
        "invocation_id": "live-inv",
        "batch_id": "batch-1",
        "outbox_correlation_hash": f"h{i:02d}",
        "partition": i % 3,
        "offset": i,
        "database_ack_timestamp": "2026-08-06T12:00:03Z",
        "broker_ack_timestamp": "2026-08-06T12:00:02Z",
        "kafkajs_record_metadata": {"partition": i % 3, "offset": i, "errorCode": 0},
    }))
# same hash, different offset
dup_lines.append("ts " + json.dumps({
    "msg": "auction_monitor_outbox_broker_and_db_ack",
    "invocation_id": "live-inv",
    "batch_id": "batch-1",
    "outbox_correlation_hash": "h00",
    "partition": 0,
    "offset": 999,
    "classification": "DATABASE_ACKNOWLEDGED",
    "database_ack_timestamp": "2026-08-06T12:00:03Z",
    "broker_ack_timestamp": "2026-08-06T12:00:02Z",
    "kafkajs_record_metadata": {"partition": 0, "offset": 999, "errorCode": 0},
}))
# pad to trigger processing of duplicate before count check
for i in range(24, 25):
    dup_lines.append("ts " + json.dumps({
        "msg": "auction_monitor_outbox_broker_and_db_ack",
        "invocation_id": "live-inv",
        "batch_id": "batch-1",
        "outbox_correlation_hash": f"h{i:02d}",
        "partition": i % 3,
        "offset": i,
        "database_ack_timestamp": "2026-08-06T12:00:03Z",
        "broker_ack_timestamp": "2026-08-06T12:00:02Z",
        "kafkajs_record_metadata": {"partition": i % 3, "offset": i, "errorCode": 0},
    }))
expect_live("conflicting_duplicate", lambda: bind_lifecycle_and_metadata_from_logs(
    log_text="\\n".join(dup_lines),
    invocation_id="harness",
    published={"observed_invocation_id": "live-inv", "batch_id": "batch-1"},
    leaders={"0": 1, "1": 2, "2": 3},
    batch_limit=25,
))

# 9) database equation without independent terms fails
t0 = {"pending": 10, "total": 100, "published_true": 90}
t1 = {"pending": 10, "total": 100, "published_true": 90}
expect_live("equation_no_independent", lambda: compute_database_equation_terms(
    t0=t0, t1=t1, independent_terms={}
))
# circular count-derived sources rejected
expect_live("equation_circular", lambda: compute_database_equation_terms(
    t0=t0, t1=t1, independent_terms={
        "created_unpublished": {"count": 0, "source": "total_delta", "proof": {}},
        "database_acknowledged": {"count": 0, "source": "published_true_delta", "proof": {}},
        "reopened": {"count": 0, "source": "column_absent_reopened_at", "proof": {"derived_from_column_absence": True}},
        "deleted_unpublished": {"count": 0, "source": "column_absent_deleted_at", "proof": {"derived_from_column_absence": True}},
    }
))

# 10) T1 capture before explicit T0 fails
pin = DockerExecutionPlanePin(
    colima_profile="default",
    docker_host="unix:///tmp/colima-test.sock",
    docker_context="colima",
    container_id="cid123",
    container_name="postgres-auction-monitor-core",
    image_digest="sha256:pg",
)
session = LiveReadonlyCaptureSession(
    runner=lambda *a, **k: "",
    utc_now_fn=lambda: "2026-08-06T13:00:00Z",
    docker_pin=pin,
)
expect_live("t1_before_t0", lambda: session.database_equation_terms({
    "created_unpublished": {"count": 0, "source": "metric:selected_ok_delta", "proof": {"series": "x"}},
    "database_acknowledged": {"count": 0, "source": "metric:db_ack_ok_delta", "proof": {"series": "y"}},
    "reopened": {"count": 0, "source": "metric:reopen_total_delta", "proof": {"series": "z"}},
    "deleted_unpublished": {"count": 0, "source": "metric:delete_unpublished_delta", "proof": {"series": "w"}},
}))

# 11) one-ready-of-two Jaeger pods fails
def obs_runner(*args, **kwargs):
    joined = " ".join(args)
    if "app=jaeger" in joined and "jaeger-storage" not in joined:
        return json.dumps({"items": [
            {"status": {"containerStatuses": [{"name": "jaeger", "ready": True, "restartCount": 0, "lastState": {}}]}},
            {"status": {"containerStatuses": [{"name": "jaeger", "ready": False, "restartCount": 0, "lastState": {}}]}},
        ]})
    if "app=jaeger-storage" in joined:
        return json.dumps({"items": [{"status": {"containerStatuses": [{"name": "store", "ready": True, "restartCount": 0, "lastState": {}}]}}]})
    if "app=otel-collector" in joined:
        return json.dumps({"items": [{"status": {"containerStatuses": [{"name": "otel", "ready": True, "restartCount": 0, "lastState": {}}]}}]})
    raise AssertionError(joined)
expect_live("one_ready_of_two_jaeger", lambda: capture_observability_snapshot(
    runner=obs_runner,
    captured_at_utc="2026-08-06T13:00:00Z",
    expected_pods={"app=jaeger": 2, "app=jaeger-storage": 1, "app=otel-collector": 1},
))
# also all-containers-ready: one pod with two containers, one not ready
def obs_runner2(*args, **kwargs):
    joined = " ".join(args)
    if "app=jaeger" in joined and "jaeger-storage" not in joined:
        return json.dumps({"items": [{"status": {"containerStatuses": [
            {"name": "a", "ready": True, "restartCount": 0, "lastState": {}},
            {"name": "b", "ready": False, "restartCount": 0, "lastState": {}},
        ]}}]})
    if "app=jaeger-storage" in joined:
        return json.dumps({"items": [{"status": {"containerStatuses": [{"name": "store", "ready": True, "restartCount": 0, "lastState": {}}]}}]})
    if "app=otel-collector" in joined:
        return json.dumps({"items": [{"status": {"containerStatuses": [{"name": "otel", "ready": True, "restartCount": 0, "lastState": {}}]}}]})
    raise AssertionError(joined)
expect_live("partial_container_ready", lambda: capture_observability_snapshot(
    runner=obs_runner2,
    captured_at_utc="2026-08-06T13:00:00Z",
))

# 12) wrong Docker context/container fails
def docker_runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "wrong-context\\n"
    if args[0] == "docker" and args[1] == "inspect":
        return json.dumps({
            "Id": "othercid",
            "Name": "/postgres-auction-monitor-core",
            "Image": "sha256:other",
        })
    raise AssertionError(args)
expect_live("wrong_docker_plane", lambda: verify_docker_execution_plane(pin, runner=docker_runner))

print(json.dumps({
    "LIVE_CAPTURE_ACCEPTANCE_READY": LIVE_CAPTURE_ACCEPTANCE_READY,
    "cases": cases,
}))
`);

  assert.equal(out.LIVE_CAPTURE_ACCEPTANCE_READY, false);
  const c = out.cases;
  assert.match(c.kubectl_exec_mutation, /shell_exec_forbidden|kubectl_exec_not_allowlisted/);
  assert.match(c.psql_without_c, /docker_exec_not_allowlisted|psql/);
  assert.match(c.mutating_select, /sql_mutating_forbidden|pg_terminate/);
  assert.match(c.mutating_cte, /sql_mutating/);
  assert.match(c.mutating_wrapped, /sql_mutating/);
  assert.equal(c.kafka_describe_allowed, true);
  assert.match(c.tmp_props_bash, /shell_exec_forbidden|tmp_props|metachar|forbidden/);
  assert.match(c.missing_partitions, /row_partitions/);
  assert.match(c.unbounded_leader, /unbounded_valid_until/);
  assert.match(c.missing_record_metadata, /primary_record_metadata_missing/);
  assert.equal(c.stale_prewindow_ignored, true);
  assert.equal(c.fresh_batch_accepted, true);
  assert.match(c.conflicting_duplicate, /lifecycle_conflicting_duplicate/);
  assert.match(c.equation_no_independent, /missing_independent_term|independent_terms/);
  assert.match(c.equation_circular, /circular|column_absent|derived_from_column_absence/);
  assert.match(c.t1_before_t0, /database_equation_t0_missing/);
  assert.match(c.one_ready_of_two_jaeger, /observability_containers_not_all_ready|observability_pod_denominator_mismatch/);
  assert.match(c.partial_container_ready, /observability_containers_not_all_ready/);
  assert.match(c.wrong_docker_plane, /docker_context_mismatch|docker_container_id_mismatch|docker_/);
});
