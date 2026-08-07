/**
 * A1.2 — DB provenance capture fail-closed (RED → GREEN).
 * Auditor and probe remain untouched.
 */
import { spawnSync } from "node:child_process";
import {
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
const LIB = join(REPO, "scripts/lib");
const ORCHESTRATOR = join(REPO, "scripts/lib/auction_monitor_canary_v3_orchestrator.py");

function runPy(code) {
  const r = spawnSync("python3", ["-c", code], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: LIB },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function runFailClosedCases() {
  const r = runPy(`
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(LIB)})
from auction_monitor_canary_v3_live_capture import (
    LiveCaptureError,
    REQUIRED_PROVENANCE_COUNTER_SERIES,
    build_and_write_db_provenance,
    parse_prometheus_exposition,
    verify_db_provenance_raw_hashes,
)

cases = {}

def expect_fail(name, fn):
    try:
        fn()
        cases[name] = "ALLOWED"
    except LiveCaptureError as exc:
        cases[name] = str(exc)
    except Exception as exc:
        cases[name] = f"OTHER:{type(exc).__name__}:{exc}"

SERIES = list(REQUIRED_PROVENANCE_COUNTER_SERIES)

def prom(values_by_series, *, labels=None, extra_lines=None):
    labels = labels or {}
    lines = []
    for series in SERIES:
        if series not in values_by_series:
            continue
        lab = labels.get(series, {})
        if lab:
            inner = ",".join(f'{k}="{v}"' for k, v in sorted(lab.items()))
            lines.append(f"{series}{{{inner}}} {values_by_series[series]}")
        else:
            lines.append(f"{series} {values_by_series[series]}")
    if extra_lines:
        lines.extend(extra_lines)
    return "\\n".join(lines) + "\\n"

BASE_EPOCH = {
    "test_run_id": "11111111-1111-4111-8111-111111111111",
    "source_sha": "source-sha-fixture",
    "runtime_sha": "runtime-sha-fixture",
    "pod_uid_t0": "pod-uid-1",
    "pod_uid_t1": "pod-uid-1",
    "process_start_time_t0": 1700000000.0,
    "process_start_time_t1": 1700000000.0,
    "counter_epoch_unchanged": True,
    "writer_count": 1,
}

def good_values(t0=False):
    if t0:
        return {s: 1000 for s in SERIES}
    return {
        "auction_monitor_outbox_created_total": 1750,
        "auction_monitor_outbox_db_acknowledged_total": 1750,
        "auction_monitor_outbox_reopened_total": 1000,
        "auction_monitor_outbox_deleted_unpublished_total": 1000,
    }

def write_ok(root, **overrides):
    epoch = dict(BASE_EPOCH)
    epoch.update(overrides.get("epoch", {}))
    kwargs = dict(
        t0_prom_text=overrides.get("t0_text", prom(good_values(True))),
        t1_prom_text=overrides.get("t1_text", prom(good_values(False))),
        db_t0=overrides.get("db_t0", {"pending": 0, "total": 0, "published_true": 0, "label": "T0"}),
        db_t1=overrides.get("db_t1", {"pending": 0, "total": 750, "published_true": 750, "label": "T1"}),
        interval_start_utc="2026-08-06T12:00:00Z",
        interval_end_utc="2026-08-06T13:00:00Z",
        epoch=epoch,
        summary_override=overrides.get("summary_override"),
        expected_source_sha=overrides.get("expected_source_sha"),
        expected_runtime_sha=overrides.get("expected_runtime_sha"),
        force_foreign_artifact_path=overrides.get("force_foreign_artifact_path"),
    )
    return build_and_write_db_provenance(root, **kwargs)

root = Path(tempfile.mkdtemp(prefix="am-v3-prov-"))

expect_fail("missing_required_counter_series", lambda: write_ok(
    root / "missing",
    t1_text=prom({
        "auction_monitor_outbox_created_total": 1750,
        "auction_monitor_outbox_db_acknowledged_total": 1750,
        "auction_monitor_outbox_reopened_total": 1000,
    }),
))

dup = prom(good_values(False)) + "auction_monitor_outbox_created_total 1751\\n"
expect_fail("duplicate_matching_series", lambda: write_ok(root / "dup", t1_text=dup))

expect_fail("unexpected_label_set", lambda: write_ok(
    root / "labels",
    t1_text=prom(good_values(False), labels={
        "auction_monitor_outbox_created_total": {"result": "ok"},
    }),
))

low = dict(good_values(False))
low["auction_monitor_outbox_created_total"] = 999
expect_fail("t1_lower_than_t0", lambda: write_ok(root / "reset", t1_text=prom(low)))

expect_fail("pod_uid_changed", lambda: write_ok(
    root / "pod",
    epoch={"pod_uid_t1": "other-pod"},
))

expect_fail("process_start_time_changed", lambda: write_ok(
    root / "pst",
    epoch={"process_start_time_t1": 1700000099.0},
))

expect_fail("runtime_source_sha_mismatch", lambda: write_ok(
    root / "sha",
    epoch={"runtime_sha": "drifted-runtime"},
    expected_runtime_sha="runtime-sha-fixture",
    expected_source_sha="source-sha-fixture",
))

expect_fail("source_sha_mismatch", lambda: write_ok(
    root / "srcsha",
    epoch={"source_sha": "tampered-source"},
    expected_source_sha="source-sha-fixture",
    expected_runtime_sha="runtime-sha-fixture",
))

expect_fail("counter_epoch_unchanged_false", lambda: write_ok(
    root / "epoch",
    epoch={"counter_epoch_unchanged": False},
))

expect_fail("summary_value_differs", lambda: write_ok(
    root / "summary",
    summary_override={"created_unpublished": 999},
))

expect_fail("missing_zero_delta_counter_evidence", lambda: write_ok(
    root / "zero",
    t1_text=prom({
        "auction_monitor_outbox_created_total": 1750,
        "auction_monitor_outbox_db_acknowledged_total": 1750,
        "auction_monitor_outbox_deleted_unpublished_total": 1000,
    }),
))

expect_fail("foreign_artifact_path", lambda: write_ok(
    root / "foreign",
    force_foreign_artifact_path="../escape/t0.prom.txt",
))

ok = write_ok(root / "shaok")
prom_path = root / "shaok" / "db-provenance" / "metrics" / "t0.prom.txt"
prom_path.write_text(prom_path.read_text() + "# tamper\\n")
expect_fail("raw_artifact_sha_mismatch", lambda: verify_db_provenance_raw_hashes(root / "shaok"))

samples = parse_prometheus_exposition(prom(good_values(True)))
cases["parser_ok"] = len(samples) >= 4
cases["happy_schema"] = ok.get("schema")
print(json.dumps(cases))
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

test("A1.2 provenance capture rejects invalid scrapes and epochs", () => {
  const cases = runFailClosedCases();
  for (const name of [
    "missing_required_counter_series",
    "duplicate_matching_series",
    "unexpected_label_set",
    "t1_lower_than_t0",
    "pod_uid_changed",
    "process_start_time_changed",
    "runtime_source_sha_mismatch",
    "source_sha_mismatch",
    "counter_epoch_unchanged_false",
    "summary_value_differs",
    "missing_zero_delta_counter_evidence",
    "foreign_artifact_path",
    "raw_artifact_sha_mismatch",
  ]) {
    assert.notEqual(cases[name], "ALLOWED", `${name}: ${cases[name]}`);
    assert.match(String(cases[name]), /[a-z_]/i, `${name}: ${cases[name]}`);
  }
  assert.equal(cases.parser_ok, true);
  assert.equal(cases.happy_schema, "canary-v3-database-equation-terms/v2");
});

test("A1.2 fixture dry-run materializes complete db-provenance tree", () => {
  const root = join(mkdtempSync(join(tmpdir(), "am-v3-prov-fix-")), "root");
  const fixtureDir = mkdtempSync(join(tmpdir(), "am-v3-prov-fx-"));
  const auth = join(fixtureDir, "authorization.json");
  const stability = join(fixtureDir, "stability.json");
  writeFileSync(
    auth,
    JSON.stringify({
      schema: "canary-v3-execution-authorization/v1",
      status: "AUTHORIZED",
      expected_runtime_sha: "sha-test",
    }),
  );
  writeFileSync(
    stability,
    JSON.stringify({
      schema: "canary-v3-observability-stability/v1",
      status: "PASS",
      expected_runtime_sha: "sha-test",
      gate: { pass: true, observed_stability_seconds_ok: true },
    }),
  );
  const fixture = join(fixtureDir, "fixture.json");
  writeFileSync(
    fixture,
    JSON.stringify({
      root,
      authorization_report_path: auth,
      stability_report_path: stability,
      expected_runtime_sha: "sha-test",
    }),
  );
  const r = spawnSync("python3", [ORCHESTRATOR, "--fixture", fixture], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const result = JSON.parse(r.stdout);
  assert.equal(result.status, "CANARY_DONE");

  const required = [
    "database-equation-terms.json",
    "db-provenance/interval.json",
    "db-provenance/metrics/t0.prom.txt",
    "db-provenance/metrics/t0.meta.json",
    "db-provenance/metrics/t1.prom.txt",
    "db-provenance/metrics/t1.meta.json",
    "db-provenance/snapshots/db-t0.json",
    "db-provenance/snapshots/db-t1.json",
    "db-provenance/terms/created_unpublished.json",
    "db-provenance/terms/database_acknowledged.json",
    "db-provenance/terms/reopened.json",
    "db-provenance/terms/deleted_unpublished.json",
    "db-provenance/terms/pending_delta.json",
  ];
  for (const rel of required) {
    assert.equal(existsSync(join(root, rel)), true, rel);
  }
  const equation = JSON.parse(readFileSync(join(root, "database-equation-terms.json"), "utf8"));
  assert.equal(equation.schema, "canary-v3-database-equation-terms/v2");
  assert.equal(equation.provenance_root, "db-provenance");

  rmSync(dirname(root), { recursive: true, force: true });
  rmSync(fixtureDir, { recursive: true, force: true });
});
