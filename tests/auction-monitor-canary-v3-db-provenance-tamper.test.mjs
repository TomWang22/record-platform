/**
 * A1.4 — Provenance tamper corpus against independent final-root auditor.
 * Pristine fixture must remain PASS / CANARY_DONE.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
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
const ORCHESTRATOR = join(REPO, "scripts/lib/auction_monitor_canary_v3_orchestrator.py");
const AUDITOR = join(REPO, "scripts/audit-auction-monitor-canary-v3-final-root.py");

function writeReports(dir) {
  writeFileSync(
    join(dir, "authorization.json"),
    JSON.stringify({
      schema: "canary-v3-execution-authorization/v1",
      status: "AUTHORIZED",
      expected_runtime_sha: "sha-test",
    }),
  );
  writeFileSync(
    join(dir, "stability.json"),
    JSON.stringify({
      schema: "canary-v3-observability-stability/v1",
      status: "PASS",
      expected_runtime_sha: "sha-test",
      gate: { pass: true, observed_stability_seconds_ok: true },
    }),
  );
  return {
    auth: join(dir, "authorization.json"),
    stability: join(dir, "stability.json"),
  };
}

function runFixtureWindow() {
  const root = join(mkdtempSync(join(tmpdir(), "am-v3-prov-tamper-src-")), "root");
  const fixtureDir = mkdtempSync(join(tmpdir(), "am-v3-prov-tamper-fx-"));
  const reports = writeReports(fixtureDir);
  const fixture = join(fixtureDir, "fixture.json");
  writeFileSync(
    fixture,
    JSON.stringify({
      root,
      authorization_report_path: reports.auth,
      stability_report_path: reports.stability,
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
  return { root, fixtureDir, result };
}

function audit(root) {
  const r = spawnSync("python3", [AUDITOR, "--canary-root", root], {
    cwd: REPO,
    encoding: "utf8",
  });
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    parsed = { verdict: "FAIL", raw: r.stdout, stderr: r.stderr };
  }
  return { status: r.status, parsed };
}

function cloneRoot(srcRoot) {
  const destParent = mkdtempSync(join(tmpdir(), "am-v3-prov-tamper-clone-"));
  const dest = join(destParent, "root");
  cpSync(srcRoot, dest, { recursive: true });
  return { destParent, dest };
}

function failCase(name, dest, a) {
  return {
    name,
    status: a.status,
    verdict: a.parsed.verdict,
    failures: [
      ...(a.parsed.accounting_failures || []),
      ...(a.parsed.audit_failures || []),
      ...(a.parsed.trace_failures || []),
    ],
    destParent: dest,
  };
}

test("A1.4 provenance tamper corpus fails auditor; pristine root stays PASS", () => {
  const src = runFixtureWindow();
  const baseline = audit(src.root);
  assert.equal(baseline.status, 0, JSON.stringify(baseline.parsed));
  assert.equal(baseline.parsed.verdict, "PASS");
  assert.equal(baseline.parsed.db_provenance?.terms_recomputed, true);
  assert.equal(baseline.parsed.db_provenance?.identity_verified, true);

  const cases = {};

  function runTamper(name, mutate) {
    const { destParent, dest } = cloneRoot(src.root);
    mutate(dest);
    const a = audit(dest);
    cases[name] = failCase(name, destParent, a);
    rmSync(destParent, { recursive: true, force: true });
  }

  runTamper("missing_required_series", (dest) => {
    const p = join(dest, "db-provenance/metrics/t1.prom.txt");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(/auction_monitor_outbox_reopened_total .*\n/, ""),
    );
  });

  runTamper("duplicate_series", (dest) => {
    const p = join(dest, "db-provenance/metrics/t1.prom.txt");
    writeFileSync(p, `${readFileSync(p, "utf8")}auction_monitor_outbox_created_total 751\n`);
  });

  runTamper("counter_reset", (dest) => {
    const p = join(dest, "db-provenance/metrics/t1.prom.txt");
    // T0 starts at 0 in fixture; set created below 0 impossible — set T0 higher instead.
    const t0 = join(dest, "db-provenance/metrics/t0.prom.txt");
    writeFileSync(
      t0,
      readFileSync(t0, "utf8").replace(
        "auction_monitor_outbox_created_total 0",
        "auction_monitor_outbox_created_total 900",
      ),
    );
  });

  runTamper("label_set_drift", (dest) => {
    const p = join(dest, "db-provenance/metrics/t1.prom.txt");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "auction_monitor_outbox_created_total 750",
        'auction_monitor_outbox_created_total{result="ok"} 750',
      ),
    );
  });

  runTamper("raw_prometheus_hash_mismatch", (dest) => {
    const p = join(dest, "db-provenance/metrics/t0.prom.txt");
    writeFileSync(p, `${readFileSync(p, "utf8")}#tamper\n`);
  });

  runTamper("db_snapshot_hash_mismatch", (dest) => {
    const p = join(dest, "db-provenance/snapshots/db-t1.json");
    const snap = JSON.parse(readFileSync(p, "utf8"));
    snap.pending = 1;
    writeFileSync(p, `${JSON.stringify(snap)}\n`);
  });

  runTamper("interval_mismatch", (dest) => {
    const p = join(dest, "db-provenance/terms/created_unpublished.json");
    const term = JSON.parse(readFileSync(p, "utf8"));
    term.interval_end_utc = "2099-01-01T00:00:00Z";
    writeFileSync(p, JSON.stringify(term));
  });

  runTamper("summary_only_negative_delta", (dest) => {
    const p = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(p, "utf8"));
    eq.created_unpublished = -1;
    writeFileSync(p, JSON.stringify(eq));
  });

  runTamper("summary_value_mismatch", (dest) => {
    const p = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(p, "utf8"));
    eq.created_unpublished = 999;
    writeFileSync(p, JSON.stringify(eq));
  });

  runTamper("missing_zero_delta_term_file", (dest) => {
    rmSync(join(dest, "db-provenance/terms/reopened.json"), { force: true });
  });

  runTamper("column_absence_proof", (dest) => {
    const p = join(dest, "db-provenance/terms/reopened.json");
    const term = JSON.parse(readFileSync(p, "utf8"));
    term.source_type = "column_absence";
    term.proof = { kind: "column_absent", derived_from_column_absence: true };
    writeFileSync(p, JSON.stringify(term));
  });

  runTamper("circular_count_derived_proof", (dest) => {
    const p = join(dest, "db-provenance/terms/created_unpublished.json");
    const term = JSON.parse(readFileSync(p, "utf8"));
    term.source_type = "total_delta";
    term.proof = { kind: "published_true_delta" };
    writeFileSync(p, JSON.stringify(term));
  });

  runTamper("foreign_artifact_path", (dest) => {
    const p = join(dest, "db-provenance/terms/created_unpublished.json");
    const term = JSON.parse(readFileSync(p, "utf8"));
    term.artifact_path_t0 = "../escape/t0.prom.txt";
    writeFileSync(p, JSON.stringify(term));
  });

  runTamper("pod_uid_drift", (dest) => {
    const p = join(dest, "db-provenance/interval.json");
    const interval = JSON.parse(readFileSync(p, "utf8"));
    interval.pod_uid_t1 = "other-pod";
    writeFileSync(p, JSON.stringify(interval));
  });

  runTamper("process_start_time_drift", (dest) => {
    const p = join(dest, "db-provenance/interval.json");
    const interval = JSON.parse(readFileSync(p, "utf8"));
    interval.process_start_time_t1 = Number(interval.process_start_time_t0) + 99;
    writeFileSync(p, JSON.stringify(interval));
  });

  runTamper("runtime_sha_drift", (dest) => {
    const p = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(p, "utf8"));
    eq.runtime_sha = "drifted-runtime";
    writeFileSync(p, JSON.stringify(eq));
  });

  runTamper("source_sha_drift", (dest) => {
    const p = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(p, "utf8"));
    eq.source_sha = "drifted-source";
    writeFileSync(p, JSON.stringify(eq));
  });

  runTamper("test_run_id_drift", (dest) => {
    const p = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(p, "utf8"));
    eq.test_run_id = "99999999-9999-4999-8999-999999999999";
    writeFileSync(p, JSON.stringify(eq));
  });

  runTamper("writer_count_not_one", (dest) => {
    const p = join(dest, "db-provenance/interval.json");
    const interval = JSON.parse(readFileSync(p, "utf8"));
    interval.writer_count = 2;
    writeFileSync(p, JSON.stringify(interval));
  });

  runTamper("counter_epoch_unchanged_false", (dest) => {
    const p = join(dest, "db-provenance/interval.json");
    const interval = JSON.parse(readFileSync(p, "utf8"));
    interval.counter_epoch_unchanged = false;
    writeFileSync(p, JSON.stringify(interval));
  });

  runTamper("pending_equation_mismatch", (dest) => {
    const p = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(p, "utf8"));
    eq.pending_delta = 123;
    writeFileSync(p, JSON.stringify(eq));
  });

  const still = audit(src.root);
  assert.equal(still.status, 0, JSON.stringify(still.parsed));
  assert.equal(still.parsed.verdict, "PASS");
  assert.equal(existsSync(join(src.root, "CANARY_DONE")), true);

  for (const [name, result] of Object.entries(cases)) {
    assert.notEqual(result.status, 0, `${name} should fail: ${JSON.stringify(result)}`);
    assert.equal(result.verdict, "FAIL", name);
    assert.ok((result.failures || []).length > 0, name);
  }

  rmSync(dirname(src.root), { recursive: true, force: true });
  rmSync(src.fixtureDir, { recursive: true, force: true });
});
