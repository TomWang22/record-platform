import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts/lib/auction_monitor_canary_v3_trace.py");
const ORCHESTRATOR = join(REPO, "scripts/lib/auction_monitor_canary_v3_orchestrator.py");
const AUDITOR = join(REPO, "scripts/audit-auction-monitor-canary-v3-final-root.py");
const RUNNER = join(REPO, "scripts/run-auction-monitor-broker-ack-canary-v3.py");

function runAction(action, fixture, { expectStatus = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "am-canary-v3-action-"));
  const fixturePath = join(dir, "fixture.json");
  const outPath = join(dir, "out.json");
  writeFileSync(fixturePath, JSON.stringify(fixture));
  const r = spawnSync("python3", [LIB, "--action", action, "--fixture", fixturePath, "--out", outPath], {
    encoding: "utf8",
    cwd: REPO,
  });
  assert.equal(r.status, expectStatus, r.stderr || r.stdout);
  const result = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  return { result, dir };
}

function body(traceId) {
  return JSON.stringify({ data: [{ traceID: traceId, spans: [{ spanID: "s1" }] }] });
}

function snapshots() {
  return {
    jaeger_ready: true,
    jaeger_storage_ready: true,
    jaeger_restart_count: 0,
    jaeger_oomkill_count: 0,
    otel_collector_restart_count: 0,
  };
}

function writeReports(dir) {
  const auth = join(dir, "authorization.json");
  const stability = join(dir, "stability.json");
  writeFileSync(auth, JSON.stringify({
    schema: "canary-v3-execution-authorization/v1",
    status: "AUTHORIZED",
    expected_runtime_sha: "sha-test",
  }));
  writeFileSync(stability, JSON.stringify({
    schema: "canary-v3-observability-stability/v1",
    status: "PASS",
    expected_runtime_sha: "sha-test",
    gate: { pass: true, observed_stability_seconds_ok: true },
  }));
  return { auth, stability };
}

test("rejects HTML 200 and wrong trace IDs", () => {
  const html = runAction("evaluate_exact_trace_success", {
    requested_trace_id: "t1",
    http_status: 200,
    content_type: "text/html",
    body: body("t1"),
  }).result;
  assert.equal(html.exact_success, false);
  assert.equal(html.failure_reason, "content_type_not_json");

  const wrong = runAction("evaluate_exact_trace_success", {
    requested_trace_id: "t1",
    http_status: 200,
    content_type: "application/problem+json; charset=utf-8",
    body: body("other"),
  }).result;
  assert.equal(wrong.failure_reason, "returned_trace_id_mismatch");
});

test("poller freezes attempts and copies first success without requery", () => {
  const root = mkdtempSync(join(tmpdir(), "am-v3-poll-"));
  const dest = join(root, "inv-1");
  const result = runAction("poll_exact_trace", {
    invocation_id: "inv-1",
    requested_trace_id: "trace-1",
    dest_dir: dest,
    fetch_sequence: [
      { http_status: 404, content_type: "application/json", body: "{}" },
      { http_status: 200, content_type: "application/json", body: body("trace-1") },
    ],
  }).result;
  assert.equal(result.attempt_count, 2);
  assert.equal(result.fetch_call_count, 2);
  const frozen = readFileSync(join(dest, "attempts/001.json"));
  const first = readFileSync(join(dest, "first_success.json"));
  assert.deepEqual(first, frozen);
  assert.equal(result.first_success_sha256, result.attempts[1].sha256);
  assert.equal(JSON.parse(readFileSync(join(dest, "first_success.meta.json"))).source_hash_verified, true);
  rmSync(root, { recursive: true, force: true });
});

test("poller fails closed when fetch completion exceeds deadline", () => {
  const root = mkdtempSync(join(tmpdir(), "am-v3-wall-"));
  const result = runAction("poll_exact_trace", {
    invocation_id: "inv-wall",
    requested_trace_id: "trace-wall",
    dest_dir: join(root, "inv-wall"),
    max_wall_seconds: 1,
    fetch_advance_seconds: [2],
    fetch_sequence: [{ http_status: 200, content_type: "application/json", body: body("trace-wall") }],
  }).result;
  assert.equal(result.trace_queryable_at_capture, false);
  assert.equal(result.failure_reason, "wall_clock_exceeded");
  assert.equal(result.attempts[0].request_timeout_s, 1);
  rmSync(root, { recursive: true, force: true });
});

test("stability duration is evidence-bound", () => {
  const short = runAction("observability_stability", {
    baseline: snapshots(),
    current: snapshots(),
    baseline_captured_at_utc: "2026-08-06T00:00:00Z",
    current_captured_at_utc: "2026-08-06T00:00:02Z",
  }).result;
  assert.equal(short.observed_stability_seconds, 2);
  assert.equal(short.observed_stability_seconds_ok, false);
  assert.equal(short.pass, false);

  const pass = runAction("observability_stability", {
    baseline: snapshots(),
    current: snapshots(),
    baseline_captured_at_utc: "2026-08-06T00:00:00Z",
    current_captured_at_utc: "2026-08-06T01:10:00Z",
  }).result;
  assert.equal(pass.observed_stability_seconds, 4200);
  assert.equal(pass.pass, true);
});

test("preflight is PARTIAL without full chain and PASS with matching pin", () => {
  const base = {
    dns: ["192.168.64.245"],
    pin: { leaf_sha256: "leaf", intermediate_sha256: "int", root_sha256: "root" },
    api_health: { http_status: 200, ok: true },
  };
  const partial = runAction("query_plane_preflight", {
    ...base,
    tls: {
      sni_hostname: "jaeger.record-platform.test",
      leaf_sha256: "leaf",
      intermediate_sha256: null,
      root_sha256: null,
      certificate_path_verification: "VERIFIED",
    },
  }).result;
  assert.equal(partial.status, "PARTIAL");

  const pass = runAction("query_plane_preflight", {
    ...base,
    tls: {
      sni_hostname: "jaeger.record-platform.test",
      leaf_sha256: "leaf",
      intermediate_sha256: "int",
      root_sha256: "root",
      certificate_path_verification: "VERIFIED",
    },
  }).result;
  assert.equal(pass.status, "PASS");
});

test("atomic create-only refuses a second write", () => {
  const root = mkdtempSync(join(tmpdir(), "am-v3-atomic-"));
  const result = runAction("atomic_create_only", { path: join(root, "sealed.json") }).result;
  assert.equal(result.first_write, true);
  assert.equal(result.second_write_refused, true);
  rmSync(root, { recursive: true, force: true });
});

test("partially populated root is never reusable", () => {
  const root = mkdtempSync(join(tmpdir(), "am-v3-root-"));
  const result = runAction("immutable_root", { root, seed_final_count: 29, writer_id: "writer-a" }).result;
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ABANDONED_PARTIAL_ROOT_NOT_REUSABLE");
  rmSync(root, { recursive: true, force: true });
});

test("frozen reports, not environment booleans, authorize execution", () => {
  const r = spawnSync("python3", [RUNNER, "--print-authorization"], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      CANARY_V3_EXECUTION_AUTHORIZED: "true",
      CANARY_V3_OBSERVABILITY_STABILITY_PASS: "true",
      CANARY_V3_EXECUTION_AUTHORIZATION_REPORT: "",
      CANARY_V3_OBSERVABILITY_STABILITY_REPORT: "",
    },
  });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).may_execute_window, false);

  const dir = mkdtempSync(join(tmpdir(), "am-v3-auth-"));
  const reports = writeReports(dir);
  const ok = runAction("execution_gate", {
    authorization_report_path: reports.auth,
    stability_report_path: reports.stability,
    expected_runtime_sha: "sha-test",
  }).result;
  assert.equal(ok.may_execute_window, true);
  rmSync(dir, { recursive: true, force: true });
});

function runOrchestrator({ failedIndex = null, emptyLifecycle = false, auditorMissingExitCode = false, root: suppliedRoot = null }) {
  const root = suppliedRoot ?? join(mkdtempSync(join(tmpdir(), "am-v3-window-")), "root");
  const fixtureDir = mkdtempSync(join(tmpdir(), "am-v3-reports-"));
  const reports = writeReports(fixtureDir);
  const fixture = join(fixtureDir, "fixture.json");
  writeFileSync(fixture, JSON.stringify({
    root,
    authorization_report_path: reports.auth,
    stability_report_path: reports.stability,
    expected_runtime_sha: "sha-test",
    failed_index: failedIndex,
    empty_lifecycle: emptyLifecycle,
    auditor_missing_exit_code: auditorMissingExitCode,
  }));
  const r = spawnSync("python3", [ORCHESTRATOR, "--fixture", fixture], {
    cwd: REPO,
    encoding: "utf8",
  });
  return { root, fixtureDir, r, result: JSON.parse(r.stdout) };
}

test("dry-run orchestrator seals 30 traces and passes independent auditor", () => {
  const run = runOrchestrator({});
  assert.equal(run.r.status, 0, run.r.stderr);
  assert.equal(run.result.status, "CANARY_DONE");
  assert.equal(existsSync(join(run.root, "CANARY_DONE")), true);
  assert.equal(existsSync(join(run.root, "lease/TERMINAL.json")), true);
  assert.equal(existsSync(join(run.root, "writer.lease_closed.json")), true);
  assert.equal(run.result.audit_publish_dir.startsWith(run.root), false);
  assert.equal(existsSync(join(run.result.audit_publish_dir, "post-terminal-audit.json")), true);
  const firstInvocation = JSON.parse(readFileSync(join(run.root, "invocations/00000000-0000-4000-8000-000000000000.json")));
  assert.equal(typeof firstInvocation.scheduled_monotonic, "number");
  assert.equal(typeof firstInvocation.start_monotonic, "number");
  assert.equal(typeof firstInvocation.end_monotonic, "number");
  assert.equal(typeof firstInvocation.drift_ms, "number");
  const audit = spawnSync("python3", [AUDITOR, "--canary-root", run.root], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(audit.status, 0, audit.stdout + audit.stderr);
  assert.equal(JSON.parse(audit.stdout).verdict, "PASS");
  const audited = JSON.parse(audit.stdout);
  assert.equal(audited.counts.database, "750/750");
  assert.equal(audited.counts.primary_record_metadata_offsets, "750/750");
  rmSync(dirname(run.root), { recursive: true, force: true });
  rmSync(run.fixtureDir, { recursive: true, force: true });
});

test("empty lifecycle fixture cannot write CANARY_DONE", () => {
  const run = runOrchestrator({ emptyLifecycle: true });
  assert.notEqual(run.r.status, 0);
  assert.equal(run.result.status, "CANARY_INCOMPLETE");
  assert.equal(existsSync(join(run.root, "CANARY_DONE")), false);
  assert.equal(run.result.accounting_failures.length, 30);
  rmSync(dirname(run.root), { recursive: true, force: true });
  rmSync(run.fixtureDir, { recursive: true, force: true });
});

test("second root claimant refuses without mutating owner result", () => {
  const first = runOrchestrator({});
  assert.equal(first.result.status, "CANARY_DONE");
  const second = runOrchestrator({ root: first.root });
  assert.equal(second.result.status, "EXECUTION_REFUSED");
  assert.equal(second.result.reason, "root_already_exists");
  assert.equal(existsSync(join(first.root, "CANARY_INCOMPLETE")), false);
  rmSync(dirname(first.root), { recursive: true, force: true });
  rmSync(first.fixtureDir, { recursive: true, force: true });
  rmSync(second.fixtureDir, { recursive: true, force: true });
});

test("scheduler sleeps to 120-second targets and records zero drift", () => {
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO, "scripts/lib"))})
from auction_monitor_canary_v3_orchestrator import schedule_invocation
clock = {"value": 10.0}
def sleep(seconds): clock["value"] += seconds
result = schedule_invocation(index=2, window_start_monotonic=10.0, schedule_interval_s=120, sleep_fn=sleep, monotonic_fn=lambda: clock["value"])
print(json.dumps(result))
`;
  const r = spawnSync("python3", ["-c", code], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { scheduled_monotonic: 250, start_monotonic: 250, drift_ms: 0 });
});

test("dry-run rejects unmarked hooks", () => {
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO, "scripts/lib"))})
from auction_monitor_canary_v3_orchestrator import run_canary_v3_window
from auction_monitor_canary_v3_trace import QueryPlanePin
result = run_canary_v3_window(root="/tmp/never-created-v3", authorization_report_path="x", stability_report_path="y", expected_runtime_sha="z", query_plane_pin=QueryPlanePin("a","b","c"), publisher_tick_fn=lambda i, x: {}, fixture_mode=True)
print(json.dumps(result))
`;
  const r = spawnSync("python3", ["-c", code], { cwd: REPO, encoding: "utf8" });
  assert.equal(JSON.parse(r.stdout).reason, "unmarked_fixture_hook_forbidden");
});

test("auditor PASS without exit_code fails closed", () => {
  const run = runOrchestrator({ auditorMissingExitCode: true });
  assert.notEqual(run.r.status, 0);
  assert.equal(run.result.status, "CANARY_INCOMPLETE");
  assert.equal(run.result.reason, "independent_auditor_failed");
  assert.equal(existsSync(join(run.root, "CANARY_DONE")), false);
  rmSync(dirname(run.root), { recursive: true, force: true });
  rmSync(run.fixtureDir, { recursive: true, force: true });
});

test("one failed poll seals CANARY_INCOMPLETE and auditor fails", () => {
  const run = runOrchestrator({ failedIndex: 7 });
  assert.notEqual(run.r.status, 0);
  assert.equal(run.result.status, "CANARY_INCOMPLETE");
  assert.equal(existsSync(join(run.root, "CANARY_INCOMPLETE")), true);
  assert.equal(existsSync(join(run.root, "CANARY_DONE")), false);
  const audit = spawnSync("python3", [AUDITOR, "--canary-root", run.root], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.notEqual(audit.status, 0);
  rmSync(dirname(run.root), { recursive: true, force: true });
  rmSync(run.fixtureDir, { recursive: true, force: true });
});

test("runner refuses by default and reports implemented constants", () => {
  const r = spawnSync("python3", [RUNNER], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 2);
  const result = JSON.parse(r.stdout);
  assert.equal(result.status, "EXECUTION_REFUSED");
  assert.equal(result.TRACE_CAPTURE_PRIMITIVES_IMPLEMENTED, true);
  assert.equal(result.FULL_CANARY_V3_EXECUTION_HARNESS_IMPLEMENTED, false);
  assert.equal(result.THIRTY_INVOCATION_FIXTURE_ORCHESTRATION_IMPLEMENTED, true);
  assert.equal(result.LIVE_ONE_HOUR_SCHEDULING_IMPLEMENTED, true);
  assert.equal(result.DRY_RUN_SIDE_EFFECT_ISOLATION_ENFORCED, true);
  assert.equal(result.PUBLISHER_ACCOUNTING_EVIDENCE_MANDATORY_IN_AUDITOR, true);
  assert.equal(result.POST_WINDOW_OBSERVABILITY_STABILITY_CAPTURED, true);
  assert.equal(result.ROOT_OWNERSHIP_RACE_SAFE, true);
  assert.equal(result.QUERY_PLANE_THREE_STAGE_PREFLIGHT_COMPLETE, true);
  assert.equal(result.PRODUCTION_ADAPTERS_WIRED, true);
  assert.equal(result.LIVE_WINDOW_AUTHORIZATION_PACKET_PREPARED, true);
  assert.equal(result.LIVE_CAPTURE_IMPLEMENTATIONS_IMPLEMENTED, true);
  assert.equal(result.LIVE_CAPTURE_ACCEPTANCE_READY, false);
  assert.equal(result.LIVE_CAPTURE_ARMED_FOR_WINDOW, false);
  assert.equal(result.CANARY_V3_EXECUTION_AUTHORIZED, false);
  assert.equal(result.CANARY_V3_WINDOW_EXECUTED, false);
});

test("confirmed live CLI refuses without live-window authorization packet", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-live-refusal-"));
  const reports = writeReports(dir);
  const r = spawnSync("python3", [
    RUNNER,
    "--execute-window",
    "--live",
    "--i-understand-live-window",
  ], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      CANARY_V3_EXECUTION_AUTHORIZATION_REPORT: reports.auth,
      CANARY_V3_OBSERVABILITY_STABILITY_REPORT: reports.stability,
      CANARY_V3_EXPECTED_RUNTIME_SHA: "sha-test",
      CANARY_V3_JAEGER_LEAF_SHA256: "leaf",
      CANARY_V3_JAEGER_INTERMEDIATE_SHA256: "intermediate",
      CANARY_V3_JAEGER_ROOT_SHA256: "root",
    },
  });
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).reason, "live_window_authorization_packet_required");
  assert.equal(JSON.parse(r.stdout).FULL_CANARY_V3_EXECUTION_HARNESS_IMPLEMENTED, false);
  assert.equal(JSON.parse(r.stdout).PRODUCTION_ADAPTERS_WIRED, true);
  rmSync(dir, { recursive: true, force: true });
});

test("production adapters: fixture hooks cannot enter live; production cannot bypass gates", () => {
  const code = `
import hashlib, json, os, sys, tempfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(join(REPO, "scripts/lib"))})
from auction_monitor_canary_v3_orchestrator import fixture_safe, run_canary_v3_window
from auction_monitor_canary_v3_production_adapters import (
    ProductionAdapterBundle,
    build_prepared_live_window_authorization_packet,
    compute_production_adapter_source_hashes,
    validate_live_window_authorization_packet,
    write_prepared_live_window_authorization_packet,
)
from auction_monitor_canary_v3_trace import QueryPlanePin, BATCH_LIMIT, SCHEDULED_INTERVAL_S, EXPECTED_INVOCATIONS

repo = Path(${JSON.stringify(REPO)})
pin = QueryPlanePin("leaf", "intermediate", "root")
runtime_sha = "sha-test"
out = {"cases": []}

# 1) Fixture hooks cannot enter live mode.
@fixture_safe
def fixture_pub(i, inv):
    return {"trace_id": "t"}

result = run_canary_v3_window(
    root="/tmp/never-created-v3-live-fixture",
    authorization_report_path="x",
    stability_report_path="y",
    expected_runtime_sha=runtime_sha,
    query_plane_pin=pin,
    publisher_tick_fn=fixture_pub,
    bind_lifecycle_rows_fn=fixture_safe(lambda inv, p: {"rows": []}),
    record_metadata_fn=fixture_safe(lambda inv, p: {"records": []}),
    database_equation_terms_fn=fixture_safe(lambda: {}),
    runtime_pin_fn=fixture_safe(lambda: {}),
    observability_snapshot_fn=fixture_safe(lambda: {}),
    poll_fn=fixture_safe(lambda **kwargs: {}),
    dry_run=False,
    fixture_mode=False,
    live_confirmed=True,
)
out["cases"].append({"name": "fixture_forbidden_in_live", "reason": result.get("reason")})

# 2) PREPARED packet cannot construct an authorized live bundle.
with tempfile.TemporaryDirectory() as tmp:
    packet_path = Path(tmp) / "packet.json"
    write_prepared_live_window_authorization_packet(
        packet_path,
        expected_runtime_sha=runtime_sha,
        query_plane_pin=pin,
        repo=repo,
    )
    try:
        ProductionAdapterBundle(
            live_window_packet_path=packet_path,
            expected_runtime_sha=runtime_sha,
            query_plane_pin=pin,
            allow_cluster_io=False,
            require_packet_authorized=True,
            repo=repo,
        )
        out["cases"].append({"name": "prepared_bundle", "error": None})
    except RuntimeError as exc:
        out["cases"].append({"name": "prepared_bundle", "error": str(exc)})

# 3) Production packet validation cannot bypass frozen hashes / throughput / runtime SHA.
packet = build_prepared_live_window_authorization_packet(
    expected_runtime_sha=runtime_sha,
    query_plane_pin=pin,
    repo=repo,
)
packet["status"] = "AUTHORIZED"
packet["live_window_authorized"] = True
packet["example_or_prepared_only"] = False
# wrong runtime
bad_runtime = validate_live_window_authorization_packet(
    packet, expected_runtime_sha="other-sha", query_plane_pin=pin, require_authorized=True, repo=repo
)
out["cases"].append({"name": "runtime_sha_gate", "failures": bad_runtime["failures"]})
# wrong throughput
packet_tp = dict(packet)
packet_tp["throughput_pin"] = {"batch": 100, "interval_seconds": 5, "invocations": 30}
bad_tp = validate_live_window_authorization_packet(
    packet_tp, expected_runtime_sha=runtime_sha, query_plane_pin=pin, require_authorized=True, repo=repo
)
out["cases"].append({"name": "throughput_pin_gate", "failures": bad_tp["failures"]})
# wrong adapter hash
packet_hash = dict(packet)
packet_hash["adapter_source_hashes"] = dict(packet["adapter_source_hashes"])
packet_hash["adapter_source_hashes"]["runner_module"] = "0" * 64
bad_hash = validate_live_window_authorization_packet(
    packet_hash, expected_runtime_sha=runtime_sha, query_plane_pin=pin, require_authorized=True, repo=repo
)
out["cases"].append({"name": "adapter_hash_gate", "failures": bad_hash["failures"]})
# wrong query-plane pin
packet_pin = dict(packet)
packet_pin["query_plane_pin"] = dict(packet["query_plane_pin"])
packet_pin["query_plane_pin"]["leaf_sha256"] = "tampered"
bad_pin = validate_live_window_authorization_packet(
    packet_pin, expected_runtime_sha=runtime_sha, query_plane_pin=pin, require_authorized=True, repo=repo
)
out["cases"].append({"name": "query_plane_pin_gate", "failures": bad_pin["failures"]})

# 4) Even with a forged AUTHORIZED packet + matching hashes, frozen auth reports and root lease still gate.
hashes = compute_production_adapter_source_hashes(repo)
packet_ok = dict(packet)
packet_ok["adapter_source_hashes"] = hashes
packet_ok["throughput_pin"] = {
    "batch": BATCH_LIMIT,
    "interval_seconds": SCHEDULED_INTERVAL_S,
    "invocations": EXPECTED_INVOCATIONS,
}
ok = validate_live_window_authorization_packet(
    packet_ok, expected_runtime_sha=runtime_sha, query_plane_pin=pin, require_authorized=True, repo=repo
)
out["cases"].append({"name": "forged_authorized_packet_hashes_ok", "pass": ok["pass"]})

with tempfile.TemporaryDirectory() as tmp:
    tmp_path = Path(tmp)
    auth = tmp_path / "auth.json"
    stability = tmp_path / "stability.json"
    # Unauthorized frozen reports (status not AUTHORIZED)
    auth.write_text(json.dumps({
        "schema": "canary-v3-execution-authorization/v1",
        "status": "UNAUTHORIZED",
        "expected_runtime_sha": runtime_sha,
    }))
    stability.write_text(json.dumps({
        "schema": "canary-v3-observability-stability/v1",
        "status": "PASS",
        "expected_runtime_sha": runtime_sha,
        "gate": {"pass": True, "observed_stability_seconds_ok": True},
    }))
    packet_path = tmp_path / "packet.json"
    raw = (json.dumps(packet_ok, indent=2) + "\\n").encode()
    packet_path.write_bytes(raw)
    (tmp_path / "packet.json.sha256").write_text(hashlib.sha256(raw).hexdigest() + "\\n")
    bundle = ProductionAdapterBundle(
        live_window_packet_path=packet_path,
        expected_runtime_sha=runtime_sha,
        query_plane_pin=pin,
        allow_cluster_io=False,
        require_packet_authorized=True,
        repo=repo,
    )
    refused = run_canary_v3_window(
        root=tmp_path / "canary-root",
        authorization_report_path=auth,
        stability_report_path=stability,
        expected_runtime_sha=runtime_sha,
        query_plane_pin=pin,
        dry_run=False,
        live_confirmed=True,
        fixture_mode=False,
        **bundle.orchestrator_hooks(),
    )
    out["cases"].append({"name": "frozen_auth_still_required", "reason": refused.get("reason")})

    # Root lease: create root then refuse second claim with matching authorized reports.
    # Use a production-marked preflight stub so the test does not touch the live query plane.
    from auction_monitor_canary_v3_production_adapters import wrap_production_hook
    auth.write_text(json.dumps({
        "schema": "canary-v3-execution-authorization/v1",
        "status": "AUTHORIZED",
        "expected_runtime_sha": runtime_sha,
    }))
    root = tmp_path / "leased-root"
    root.mkdir()
    (root / "OWNER.json").write_text("{}")
    hooks = bundle.orchestrator_hooks()
    hooks["preflight_fn"] = wrap_production_hook(lambda: {"status": "PASS"})
    leased = run_canary_v3_window(
        root=root,
        authorization_report_path=auth,
        stability_report_path=stability,
        expected_runtime_sha=runtime_sha,
        query_plane_pin=pin,
        dry_run=False,
        live_confirmed=True,
        fixture_mode=False,
        **hooks,
    )
    out["cases"].append({"name": "root_lease_gate", "reason": leased.get("reason")})

print(json.dumps(out))
`;
  const r = spawnSync("python3", ["-c", code], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  const byName = Object.fromEntries(out.cases.map((c) => [c.name, c]));
  assert.equal(byName.fixture_forbidden_in_live.reason, "fixture_adapter_forbidden_in_live_mode");
  assert.match(byName.prepared_bundle.error, /packet_status_not_authorized/);
  assert.ok(byName.runtime_sha_gate.failures.some((f) => f.includes("runtime_sha_mismatch")));
  assert.ok(byName.throughput_pin_gate.failures.some((f) => f.includes("throughput_pin_mismatch")));
  assert.ok(byName.adapter_hash_gate.failures.some((f) => f.includes("adapter_source_hash_mismatch")));
  assert.ok(byName.query_plane_pin_gate.failures.some((f) => f.includes("query_plane_pin_mismatch")));
  assert.equal(byName.forged_authorized_packet_hashes_ok.pass, true);
  assert.equal(byName.frozen_auth_still_required.reason, "frozen_reports_did_not_authorize");
  assert.equal(byName.root_lease_gate.reason, "root_already_exists");
});
