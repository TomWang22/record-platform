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

function runFixtureWindow() {
  const root = join(mkdtempSync(join(tmpdir(), "am-v3-tamper-src-")), "root");
  const fixtureDir = mkdtempSync(join(tmpdir(), "am-v3-tamper-fix-"));
  const reports = writeReports(fixtureDir);
  const fixture = join(fixtureDir, "fixture.json");
  writeFileSync(fixture, JSON.stringify({
    root,
    authorization_report_path: reports.auth,
    stability_report_path: reports.stability,
    expected_runtime_sha: "sha-test",
  }));
  const r = spawnSync("python3", [ORCHESTRATOR, "--fixture", fixture], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const result = JSON.parse(r.stdout);
  assert.equal(result.status, "CANARY_DONE");
  assert.equal(existsSync(join(root, "CANARY_DONE")), true);
  return { root, fixtureDir, result };
}

function audit(root) {
  const r = spawnSync("python3", [AUDITOR, "--canary-root", root], {
    cwd: REPO,
    encoding: "utf8",
  });
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    parsed = { verdict: "FAIL", raw: r.stdout, stderr: r.stderr };
  }
  return { status: r.status, parsed };
}

function cloneRoot(srcRoot) {
  const destParent = mkdtempSync(join(tmpdir(), "am-v3-tamper-clone-"));
  const dest = join(destParent, "root");
  cpSync(srcRoot, dest, { recursive: true });
  return { destParent, dest };
}

test("end-to-end frozen-root tamper suite prevents auditor PASS / CANARY_DONE acceptance", () => {
  const src = runFixtureWindow();
  const baseline = audit(src.root);
  assert.equal(baseline.status, 0, baseline.parsed);
  assert.equal(baseline.parsed.verdict, "PASS");

  const cases = {};

  // 1) missing / invalid T0 (and equation terms)
  {
    const { destParent, dest } = cloneRoot(src.root);
    const eqPath = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(eqPath, "utf8"));
    delete eq.t0;
    writeFileSync(eqPath, JSON.stringify(eq));
    // Also remove the whole equation file in a second clone for missing terms.
    const a = audit(dest);
    cases.missing_t0_or_eq_shape = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: [...(a.parsed.accounting_failures || []), ...(a.parsed.audit_failures || [])],
    };
    rmSync(destParent, { recursive: true, force: true });
  }
  {
    const { destParent, dest } = cloneRoot(src.root);
    rmSync(join(dest, "database-equation-terms.json"), { force: true });
    const a = audit(dest);
    cases.missing_equation_file = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: [...(a.parsed.accounting_failures || []), ...(a.parsed.audit_failures || [])],
    };
    rmSync(destParent, { recursive: true, force: true });
  }

  // 2) changed DB term
  {
    const { destParent, dest } = cloneRoot(src.root);
    const eqPath = join(dest, "database-equation-terms.json");
    const eq = JSON.parse(readFileSync(eqPath, "utf8"));
    eq.pending_delta = 999;
    writeFileSync(eqPath, JSON.stringify(eq));
    const a = audit(dest);
    cases.changed_db_term = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: a.parsed.accounting_failures || [],
    };
    rmSync(destParent, { recursive: true, force: true });
  }

  // 3) removed metadata
  {
    const { destParent, dest } = cloneRoot(src.root);
    const manifest = JSON.parse(readFileSync(join(dest, "invocation-manifest.json"), "utf8"));
    const id = manifest.invocation_ids[0];
    rmSync(join(dest, "record-metadata", `${id}.json`), { force: true });
    const a = audit(dest);
    cases.removed_metadata = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: a.parsed.accounting_failures || [],
    };
    rmSync(destParent, { recursive: true, force: true });
  }

  // 4) altered lifecycle / leader evidence
  {
    const { destParent, dest } = cloneRoot(src.root);
    const manifest = JSON.parse(readFileSync(join(dest, "invocation-manifest.json"), "utf8"));
    const id = manifest.invocation_ids[0];
    const lifePath = join(dest, "lifecycle", `${id}.json`);
    const life = JSON.parse(readFileSync(lifePath, "utf8"));
    life.rows[0].leader_broker_id = 999;
    life.rows[0].offset = 123456;
    writeFileSync(lifePath, JSON.stringify(life));
    const a = audit(dest);
    cases.altered_lifecycle_leader = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: a.parsed.accounting_failures || [],
    };
    rmSync(destParent, { recursive: true, force: true });
  }

  // 5) foreign lease
  {
    const { destParent, dest } = cloneRoot(src.root);
    const lockPath = join(dest, "writer.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.owner_token = "foreign-owner-token";
    writeFileSync(lockPath, JSON.stringify(lock));
    const a = audit(dest);
    cases.foreign_lease = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: a.parsed.audit_failures || [],
    };
    rmSync(destParent, { recursive: true, force: true });
  }

  // 6) overwritten evidence (runtime pin drift)
  {
    const { destParent, dest } = cloneRoot(src.root);
    const endPath = join(dest, "window_end.json");
    const end = JSON.parse(readFileSync(endPath, "utf8"));
    end.runtime_pin = { ...end.runtime_pin, RP_SOURCE_SHA: "tampered-sha" };
    writeFileSync(endPath, JSON.stringify(end));
    const a = audit(dest);
    cases.overwritten_runtime_pin = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: a.parsed.accounting_failures || [],
    };
    rmSync(destParent, { recursive: true, force: true });
  }

  // 7) observability growth (overwritten baseline/post)
  {
    const { destParent, dest } = cloneRoot(src.root);
    const postPath = join(dest, "observability", "post_window.json");
    const post = JSON.parse(readFileSync(postPath, "utf8"));
    post.jaeger_restart_count = (post.jaeger_restart_count || 0) + 1;
    writeFileSync(postPath, JSON.stringify(post));
    const a = audit(dest);
    cases.overwritten_observability = {
      status: a.status,
      verdict: a.parsed.verdict,
      failures: a.parsed.accounting_failures || [],
    };
    rmSync(destParent, { recursive: true, force: true });
  }

  // Source root remains PASS / CANARY_DONE after clones were mutated.
  const still = audit(src.root);
  assert.equal(still.status, 0);
  assert.equal(still.parsed.verdict, "PASS");
  assert.equal(existsSync(join(src.root, "CANARY_DONE")), true);

  for (const [name, result] of Object.entries(cases)) {
    assert.notEqual(result.status, 0, name);
    assert.equal(result.verdict, "FAIL", `${name}: ${JSON.stringify(result)}`);
  }
  assert.ok(
    (cases.foreign_lease.failures || []).some((f) => String(f).includes("foreign_lease")),
    JSON.stringify(cases.foreign_lease),
  );
  assert.ok(
    (cases.changed_db_term.failures || []).some(
      (f) =>
        String(f).includes("pending_equation") ||
        String(f).includes("equation") ||
        String(f).includes("summary_value_mismatch"),
    ),
    JSON.stringify(cases.changed_db_term),
  );
  assert.ok(
    (cases.removed_metadata.failures || []).length > 0,
    JSON.stringify(cases.removed_metadata),
  );
  assert.ok(
    (cases.altered_lifecycle_leader.failures || []).length > 0,
    JSON.stringify(cases.altered_lifecycle_leader),
  );
  assert.ok(
    (cases.overwritten_runtime_pin.failures || []).some((f) => String(f).includes("runtime_pin")),
    JSON.stringify(cases.overwritten_runtime_pin),
  );
  assert.ok(
    (cases.overwritten_observability.failures || []).some((f) => String(f).includes("jaeger_restart") || String(f).includes("observability")),
    JSON.stringify(cases.overwritten_observability),
  );

  rmSync(dirname(src.root), { recursive: true, force: true });
  rmSync(src.fixtureDir, { recursive: true, force: true });
});
