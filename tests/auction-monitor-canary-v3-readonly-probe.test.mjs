/**
 * A2 — PREPARED read-only probe (harness + hardened live mocked adapters).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = join(REPO, "scripts/run-auction-monitor-canary-v3-readonly-live-probe.py");
const PREPARED = join(
  REPO,
  "reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json",
);

function loadProbe(modName) {
  return `
import importlib.util, json, sys, copy
from pathlib import Path
repo = Path(${JSON.stringify(REPO)})
sys.path.insert(0, str(repo / "scripts" / "lib"))
probe_path = repo / "scripts/run-auction-monitor-canary-v3-readonly-live-probe.py"
spec = importlib.util.spec_from_file_location(${JSON.stringify(modName)}, probe_path)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
from auction_monitor_canary_v3_live_capture import REQUIRED_PROVENANCE_COUNTER_SERIES

def _prom(values, process_start=1700000000.0):
    lines = [f"process_start_time_seconds {process_start}"]
    for name in REQUIRED_PROVENANCE_COUNTER_SERIES:
        lines.append(f"{name} {values[name]}")
    return "\\n".join(lines) + "\\n"

DOCKER = {
    "colima_profile": "default",
    "docker_host": "unix:///tmp/colima.sock",
    "docker_context": "colima",
    "container_id": "cid123",
    "container_name": "postgres-auction-monitor-core",
    "image_digest": "sha256:pg",
    "read_only": True,
    "capture_mode": "live_readonly",
}

def _db(label, pending, docker=DOCKER):
    return {
        "label": label,
        "captured_at_utc": "2026-08-06T12:00:00Z" if label == "T0" else "2026-08-06T12:00:01Z",
        "db_now": "2026-08-06 12:00:00+00",
        "pending": pending,
        "total": 10,
        "published_true": 10 - pending,
        "docker_pin": {
            "container_id": docker["container_id"],
            "container_name": docker["container_name"],
            "docker_context": docker["docker_context"],
            "image_digest": docker["image_digest"],
        },
        "read_only": True,
        "capture_mode": "live_readonly",
    }

def build_ok_adapters(**overrides):
    t0_vals = {n: 0 for n in REQUIRED_PROVENANCE_COUNTER_SERIES}
    t1_vals = {n: 0 for n in REQUIRED_PROVENANCE_COUNTER_SERIES}
    scrapes = [_prom(t0_vals), _prom(t1_vals)]
    runtimes = [
        {
            "pod_name": "auction-monitor-abc",
            "pod_uid": "uid-live-1",
            "image_digest": "sha256:deadbeef",
            "oci_revision": "abc123",
            "RP_SOURCE_SHA": "abc123",
            "read_only": True,
            "capture_mode": "live_readonly",
            "captured_at_utc": "2026-08-06T12:00:00Z",
        },
        {
            "pod_name": "auction-monitor-abc",
            "pod_uid": "uid-live-1",
            "image_digest": "sha256:deadbeef",
            "oci_revision": "abc123",
            "RP_SOURCE_SHA": "abc123",
            "read_only": True,
            "capture_mode": "live_readonly",
            "captured_at_utc": "2026-08-06T12:00:01Z",
        },
    ]
    dbs = [_db("T0", 3), _db("T1", 3)]
    state = {"scrape_i": 0, "runtime_i": 0, "db_i": 0}

    def scrape():
        i = state["scrape_i"]
        state["scrape_i"] += 1
        return scrapes[min(i, len(scrapes) - 1)]

    def runtime():
        i = state["runtime_i"]
        state["runtime_i"] += 1
        return runtimes[min(i, len(runtimes) - 1)]

    def db_snap(label, docker_pin):
        i = state["db_i"]
        state["db_i"] += 1
        snap = dict(dbs[min(i, len(dbs) - 1)])
        snap["label"] = label
        snap["docker_pin"] = {
            "container_id": docker_pin["container_id"],
            "container_name": docker_pin["container_name"],
            "docker_context": docker_pin["docker_context"],
            "image_digest": docker_pin["image_digest"],
        }
        return snap

    base = dict(
        scrape_auction_monitor_metrics=scrape,
        capture_runtime_pin=runtime,
        capture_docker_execution_plane=lambda: dict(DOCKER),
        capture_query_plane=lambda: {
            "status": "PASS",
            "pass": True,
            "jaeger_base": "https://jaeger.record-platform.test/jaeger",
            "stages": {
                "stage1_dns": {"status": "PASS", "required_metallb_ip": "192.168.64.245"},
                "stage2_tls": {
                    "status": "PASS",
                    "observed": {
                        "leaf_sha256": "leaf1",
                        "intermediate_sha256": "int1",
                        "root_sha256": "root1",
                        "sni_hostname": "jaeger.record-platform.test",
                        "certificate_path_verification": "VERIFIED",
                    },
                },
                "stage3_api_health": {"status": "PASS", "health": {"ok": True, "http_status": 200}},
            },
            "localhost_query_count": 0,
            "port_forward_query_count": 0,
            "fallback_query_count": 0,
            "captured_at_utc": "2026-08-06T12:00:00Z",
        },
        capture_kafka_leaders=lambda: {
            "captured_at_utc": "2026-08-06T12:00:00Z",
            "valid_from": "2026-08-06T12:00:00Z",
            "valid_until": None,
            "leaders": {"0": 1, "1": 2, "2": 0},
            "partition_count": 3,
            "raw_describe_sha256": "aa" * 32,
            "topic": "dev.auction_monitor.events",
            "read_only": True,
            "capture_mode": "live_readonly",
        },
        capture_db_snapshot=db_snap,
        capture_publisher_log_cursor=lambda: {
            "since_time_utc": "2026-08-06T12:00:00Z",
            "log_byte_length": 128,
            "line_count": 4,
            "read_only": True,
            "capture_mode": "live_readonly",
            "publisher_invocation_triggered": False,
        },
        capture_observability=lambda: {
            "captured_at_utc": "2026-08-06T12:00:00Z",
            "jaeger_ready": True,
            "jaeger_storage_ready": True,
            "jaeger_pod_count": 1,
            "jaeger_storage_pod_count": 1,
            "otel_collector_pod_count": 1,
            "jaeger_restart_count": 0,
            "jaeger_oomkill_count": 0,
            "otel_collector_restart_count": 0,
            "otel_collector_ready": True,
            "expected_pods": {"app=jaeger": 1, "app=jaeger-storage": 1, "app=otel-collector": 1},
            "read_only": True,
            "capture_mode": "live_readonly",
        },
        bounded_interval_wait=lambda: None,
    )
    base.update(overrides)
    return mod.LiveReadonlyProbeAdapters(**base), mod, state, scrapes, runtimes, dbs
`;
}

test("A2 harness mock: DB_PROVENANCE_NOT_READY when Ticket-1 missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-missing-"));
  const out = join(dir, "probe.json");
  const probed = join(dir, "packet.PROBED.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  copyFileSync(`${PREPARED}.sha256`, `${packetCopy}.sha256`);
  const before = readFileSync(packetCopy);

  const r = spawnSync(
    "python3",
    [
      PROBE,
      "--packet",
      packetCopy,
      "--out",
      out,
      "--mode",
      "harness",
      "--simulate-provenance-missing",
      "--probed-packet-out",
      probed,
    ],
    { cwd: REPO, encoding: "utf8" },
  );
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const report = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(report.verdict, "DB_PROVENANCE_NOT_READY");
  assert.equal(report.read_only_live_probe_pass, false);
  assert.equal(JSON.parse(readFileSync(probed, "utf8")).status, "PREPARED_NOT_AUTHORIZED");
  assert.deepEqual(before, readFileSync(packetCopy));
  rmSync(dir, { recursive: true, force: true });
});

test("A2 harness mock: HARNESS_PASS without authorizing or overwriting PREPARED", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-ok-"));
  const out = join(dir, "probe.json");
  const probed = join(dir, "packet.PROBED.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  copyFileSync(`${PREPARED}.sha256`, `${packetCopy}.sha256`);
  const before = readFileSync(packetCopy);

  const r = spawnSync(
    "python3",
    [PROBE, "--packet", packetCopy, "--out", out, "--mode", "harness", "--probed-packet-out", probed],
    { cwd: REPO, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(report.verdict, "HARNESS_PASS");
  assert.equal(report.read_only_live_probe_pass, false);
  assert.equal(report.live_capture_acceptance_ready, false);
  assert.deepEqual(before, readFileSync(packetCopy));
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live PASS requires T0/T1 recompute + common interval + strict planes", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-live-"));
  const out = join(dir, "probe.json");
  const probed = join(dir, "packet.PROBED.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  copyFileSync(`${PREPARED}.sha256`, `${packetCopy}.sha256`);
  const before = readFileSync(packetCopy);

  const py =
    loadProbe("am_v3_readonly_probe_pass") +
    `
adapters, mod, *_ = build_ok_adapters()
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=Path(${JSON.stringify(probed)}),
    repo=repo,
    live_adapters=adapters,
)
print(json.dumps(report))
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(report.verdict, "READ_ONLY_LIVE_PROBE_PASS");
  assert.equal(report.read_only_live_probe_pass, true);
  assert.equal(report.db_provenance.status, "READY");
  assert.equal(report.db_provenance.required_series_present, true);
  assert.equal(report.db_provenance.auditor_recompute_pass, true);
  assert.equal(report.db_provenance.common_interval_proven, true);
  assert.equal(report.db_provenance.counter_epoch_unchanged, true);
  assert.equal(report.cluster_mutation_attempted, false);
  assert.equal(report.publisher_invocation_triggered, false);
  assert.equal(report.outbox_rows_mutated, 0);
  assert.equal(report.throughput_changed, false);
  assert.equal(report.packet_status_unchanged, "PREPARED_NOT_AUTHORIZED");
  assert.equal(report.live_window_authorized, false);
  assert.equal(report.execution_authorized, false);
  assert.equal(report.live_capture_acceptance_ready, false);
  assert.equal(report.live_capture_armed_for_window, false);
  assert.equal(report.a2_live_acceptance_ready, false);
  assert.deepEqual(before, readFileSync(packetCopy));
  assert.equal(JSON.parse(readFileSync(probed, "utf8")).status, "PREPARED_NOT_AUTHORIZED");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: missing series → DB_PROVENANCE_NOT_READY", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-miss-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const before = readFileSync(packetCopy);
  const py =
    loadProbe("am_v3_miss") +
    `
adapters, mod, *_ = build_ok_adapters(scrape_auction_monitor_metrics=lambda: "unrelated_metric 1\\n")
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(json.dumps({"verdict": report["verdict"], "pass": report["read_only_live_probe_pass"]}))
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const summary = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(summary.verdict, "DB_PROVENANCE_NOT_READY");
  assert.equal(summary.pass, false);
  assert.deepEqual(before, readFileSync(packetCopy));
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: counter reset → DB_PROVENANCE_NOT_READY", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-reset-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const py =
    loadProbe("am_v3_reset") +
    `
adapters, mod, state, scrapes, *_rest = build_ok_adapters()
t0 = {n: 5 for n in REQUIRED_PROVENANCE_COUNTER_SERIES}
t1 = {n: 1 for n in REQUIRED_PROVENANCE_COUNTER_SERIES}
scrapes[0] = _prom(t0)
scrapes[1] = _prom(t1)
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout.trim().split("\n").at(-1), "DB_PROVENANCE_NOT_READY");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: pod UID drift → DB_PROVENANCE_NOT_READY", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-pod-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const py =
    loadProbe("am_v3_pod") +
    `
adapters, mod, state, scrapes, runtimes, dbs = build_ok_adapters()
runtimes[1] = dict(runtimes[1], pod_uid="uid-other")
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout.trim().split("\n").at(-1), "DB_PROVENANCE_NOT_READY");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: equation mismatch → DB_PROVENANCE_NOT_READY", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-eq-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const py =
    loadProbe("am_v3_eq") +
    `
adapters, mod, state, scrapes, runtimes, dbs = build_ok_adapters()
# counters stay flat but pending drifts → equation fails
dbs[1] = _db("T1", 9)
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout.trim().split("\n").at(-1), "DB_PROVENANCE_NOT_READY");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: query plane stage FAIL → LIVE_PROBE_OBSERVATIONS_INCOMPLETE", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-qp-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const py =
    loadProbe("am_v3_qp") +
    `
adapters, mod, *_ = build_ok_adapters(capture_query_plane=lambda: {
    "status": "PARTIAL",
    "pass": False,
    "jaeger_base": "https://jaeger.record-platform.test/jaeger",
    "stages": {
        "stage1_dns": {"status": "FAIL"},
        "stage2_tls": {"status": "PASS", "observed": {"leaf_sha256": "l", "intermediate_sha256": "i", "root_sha256": "r"}},
        "stage3_api_health": {"status": "PASS", "health": {"ok": True}},
    },
    "localhost_query_count": 0,
    "port_forward_query_count": 0,
    "fallback_query_count": 0,
})
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout.trim().split("\n").at(-1), "LIVE_PROBE_OBSERVATIONS_INCOMPLETE");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: observability count mismatch → LIVE_PROBE_OBSERVATIONS_INCOMPLETE", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-obs-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const py =
    loadProbe("am_v3_obs") +
    `
adapters, mod, *_ = build_ok_adapters(capture_observability=lambda: {
    "captured_at_utc": "2026-08-06T12:00:00Z",
    "jaeger_ready": True,
    "jaeger_storage_ready": True,
    "jaeger_pod_count": 2,
    "jaeger_storage_pod_count": 1,
    "otel_collector_pod_count": 1,
    "otel_collector_ready": True,
    "expected_pods": {"app=jaeger": 1, "app=jaeger-storage": 1, "app=otel-collector": 1},
})
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout.trim().split("\n").at(-1), "LIVE_PROBE_OBSERVATIONS_INCOMPLETE");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: docker pin mismatch on DB snapshot → LIVE_PROBE_OBSERVATIONS_INCOMPLETE", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-dock-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const py =
    loadProbe("am_v3_dock") +
    `
def bad_db(label, docker_pin):
    snap = _db(label, 3)
    snap["docker_pin"] = dict(snap["docker_pin"], container_id="other-cid")
    return snap
adapters, mod, *_ = build_ok_adapters(capture_db_snapshot=bad_db)
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout.trim().split("\n").at(-1), "LIVE_PROBE_OBSERVATIONS_INCOMPLETE");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: incomplete Kafka partition denominator → LIVE_PROBE_OBSERVATIONS_INCOMPLETE", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-kafka-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const py =
    loadProbe("am_v3_kafka") +
    `
adapters, mod, *_ = build_ok_adapters(capture_kafka_leaders=lambda: {
    "captured_at_utc": "2026-08-06T12:00:00Z",
    "valid_from": "2026-08-06T12:00:00Z",
    "valid_until": None,
    "leaders": {"0": 1},
    "partition_count": 1,
    "raw_describe_sha256": "aa" * 32,
    "topic": "dev.auction_monitor.events",
})
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout.trim().split("\n").at(-1), "LIVE_PROBE_OBSERVATIONS_INCOMPLETE");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: AUTHORIZED packet rejected; PREPARED bytes tamper → PACKET_STATUS_TAMPER_ATTEMPT", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-pkt-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  const authorized = JSON.parse(readFileSync(packetCopy, "utf8"));
  authorized.status = "AUTHORIZED";
  writeFileSync(packetCopy, `${JSON.stringify(authorized, null, 2)}\n`);
  // sha will fail validation OR status reject — either way must not PASS
  const py =
    loadProbe("am_v3_authz") +
    `
adapters, mod, *_ = build_ok_adapters()
report = mod.run_readonly_live_probe(
    packet_path=Path(${JSON.stringify(packetCopy)}),
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
print(report.get("read_only_live_probe_pass"))
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.at(-2), "PACKET_STATUS_TAMPER_ATTEMPT");
  assert.equal(lines.at(-1), "False");
  rmSync(dir, { recursive: true, force: true });
});

test("A2-live blocker: mid-run PREPARED mutation → PACKET_STATUS_TAMPER_ATTEMPT", () => {
  const dir = mkdtempSync(join(tmpdir(), "am-v3-probe-mut-"));
  const out = join(dir, "probe.json");
  const packetCopy = join(dir, "packet.PREPARED.json");
  copyFileSync(PREPARED, packetCopy);
  copyFileSync(`${PREPARED}.sha256`, `${packetCopy}.sha256`);
  const py =
    loadProbe("am_v3_mut") +
    `
packet_path = Path(${JSON.stringify(packetCopy)})
def wait_and_tamper():
    packet_path.write_text(packet_path.read_text() + " ")
adapters, mod, *_ = build_ok_adapters(bounded_interval_wait=wait_and_tamper)
report = mod.run_readonly_live_probe(
    packet_path=packet_path,
    out_path=Path(${JSON.stringify(out)}),
    mode="live",
    probed_packet_path=None,
    repo=repo,
    live_adapters=adapters,
)
print(report["verdict"])
print(report.get("read_only_live_probe_pass"))
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.at(-2), "PACKET_STATUS_TAMPER_ATTEMPT");
  assert.equal(lines.at(-1), "False");
  rmSync(dir, { recursive: true, force: true });
});

test("A2 metrics scrape template is allowlisted; other kubectl exec remains forbidden", () => {
  const py = `
import sys
from pathlib import Path
repo = Path(${JSON.stringify(REPO)})
sys.path.insert(0, str(repo / "scripts" / "lib"))
from auction_monitor_canary_v3_live_capture import (
    ForbiddenLiveCaptureCommand,
    assert_readonly_command,
    kubectl_metrics_scrape_template,
)
assert_readonly_command(list(kubectl_metrics_scrape_template(pod="auction-monitor-xyz")))
try:
    assert_readonly_command(["kubectl", "-n", "record-platform", "exec", "pod", "--", "bash", "-c", "id"])
    raise SystemExit("expected forbidden")
except ForbiddenLiveCaptureCommand:
    pass
print("ok")
`;
  const r = spawnSync("python3", ["-c", py], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
