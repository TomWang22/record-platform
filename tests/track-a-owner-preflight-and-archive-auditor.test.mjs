/**
 * Track A owner preflight + live-probe archive auditor.
 * Preflight cases use hermetic temporary Git repos (not the live working tree).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFLIGHT_MOD = join(REPO, "scripts/ci/verify-track-a-owner-preflight.mjs");
const ARCHIVE_AUDITOR = join(
  REPO,
  "scripts/audit-canary-v3-live-readonly-probe-archive.py",
);

const { verifyTrackAOwnerPreflight } = await import(
  pathToFileURL(PREFLIGHT_MOD).href
);

function writeJsonSha(path, payload) {
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(path, raw);
  writeFileSync(
    `${path}.sha256`,
    `${createHash("sha256").update(raw).digest("hex")}\n`,
  );
}

function git(cwd, args) {
  const r = spawnSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { cwd, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout || args.join(" "));
  return (r.stdout || "").trim();
}

function buildHermeticPreflightRepo({ dirty = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "track-a-preflight-"));
  const sourceFiles = ["scripts/ci/track-a-fixture-source.txt"];
  mkdirSync(join(dir, "scripts/ci"), { recursive: true });
  mkdirSync(join(dir, "reports/ci"), { recursive: true });
  writeFileSync(join(dir, sourceFiles[0]), "track-a-fixture-v1\n");

  git(dir, ["init"]);
  git(dir, ["branch", "-M", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "fixture: track a sources"]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["update-ref", "refs/remotes/origin/main", head]);

  writeFileSync(
    join(dir, "reports/ci/track-a-meta-auditor-result.json"),
    `${JSON.stringify(
      {
        verdict: "TRACK_A_META_PASS",
        exact_sha: head,
        execution_authorized: false,
        live_window_authorized: false,
        a2_live_acceptance_ready: false,
        live_capture_acceptance_ready: false,
        canary_v3_execution_authorized: false,
        canary_v3_window_executed: false,
      },
      null,
      2,
    )}\n`,
  );

  if (dirty) {
    writeFileSync(join(dir, sourceFiles[0]), "track-a-fixture-DIRTY\n");
  }

  return { dir, sourceFiles, head };
}

function baseProbe(overrides = {}) {
  return {
    schema: "canary-v3-live-readonly-probe/v1",
    verdict: "DB_PROVENANCE_NOT_READY",
    read_only_live_probe_pass: false,
    cluster_mutation_attempted: false,
    publisher_invocation_triggered: false,
    outbox_rows_mutated: 0,
    throughput_changed: false,
    packet_status_unchanged: "PREPARED_NOT_AUTHORIZED",
    live_window_authorized: false,
    execution_authorized: false,
    live_capture_acceptance_ready: false,
    live_capture_armed_for_window: false,
    ...overrides,
  };
}

function baseProbed(overrides = {}) {
  return {
    status: "PREPARED_NOT_AUTHORIZED",
    live_window_authorized: false,
    live_capture_acceptance_ready: false,
    live_capture_armed_for_window: false,
    ...overrides,
  };
}

function runArchiveAuditor(args) {
  return spawnSync("python3", [ARCHIVE_AUDITOR, ...args, "--quiet"], {
    cwd: REPO,
    encoding: "utf8",
  });
}

test("owner preflight PASS on hermetic clean Track A git fixture", () => {
  const { dir, sourceFiles } = buildHermeticPreflightRepo({ dirty: false });
  try {
    const report = verifyTrackAOwnerPreflight({
      repo: dir,
      sourceFiles,
    });
    assert.equal(report.verdict, "TRACK_A_OWNER_REVIEW_PREFLIGHT_PASS");
    assert.equal(report.sha_triple_equal, true);
    assert.equal(report.track_a_sources_committed_and_clean, true);
    assert.equal(report.live_probe_authorized_by_this_script, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("owner preflight FAIL on hermetic dirty Track A git fixture", () => {
  const { dir, sourceFiles } = buildHermeticPreflightRepo({ dirty: true });
  try {
    const report = verifyTrackAOwnerPreflight({
      repo: dir,
      sourceFiles,
    });
    assert.equal(report.verdict, "TRACK_A_OWNER_REVIEW_PREFLIGHT_FAIL");
    assert.equal(report.sha_triple_equal, true);
    assert.equal(report.track_a_sources_committed_and_clean, false);
    assert.ok(report.uncommitted_or_dirty_sources.some((x) => x.startsWith("dirty:")));
    assert.equal(report.live_probe_authorized_by_this_script, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("owner preflight FAIL on hermetic untracked Track A source", () => {
  const { dir, sourceFiles } = buildHermeticPreflightRepo({ dirty: false });
  try {
    const extra = "scripts/ci/track-a-fixture-untracked.txt";
    writeFileSync(join(dir, extra), "untracked\n");
    const report = verifyTrackAOwnerPreflight({
      repo: dir,
      sourceFiles: [...sourceFiles, extra],
    });
    assert.equal(report.verdict, "TRACK_A_OWNER_REVIEW_PREFLIGHT_FAIL");
    assert.ok(
      report.uncommitted_or_dirty_sources.some((x) => x.startsWith("untracked:")),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive auditor PASS for fail-closed probe posture", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const preparedPath = join(dir, "prepared.json");
  const out = join(dir, "audit.json");

  const prepared = baseProbed();
  writeJsonSha(preparedPath, prepared);
  const preparedSha = createHash("sha256")
    .update(readFileSync(preparedPath))
    .digest("hex");

  writeJsonSha(probePath, baseProbe());
  writeJsonSha(probedPath, baseProbed());

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--prepared-packet",
    preparedPath,
    "--prepared-sha-before",
    preparedSha,
    "--out",
    out,
  ]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(audit.verdict, "LIVE_PROBE_ARCHIVE_AUDIT_PASS");
  assert.equal(audit.canary_v3_execution_authorized, false);
  rmSync(dir, { recursive: true, force: true });
});

test("archive auditor requires full provenance gates on READ_ONLY_LIVE_PROBE_PASS", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-pass-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const preparedPath = join(dir, "prepared.json");
  const out = join(dir, "audit.json");

  writeJsonSha(preparedPath, baseProbed());
  const preparedSha = createHash("sha256")
    .update(readFileSync(preparedPath))
    .digest("hex");

  writeJsonSha(
    probePath,
    baseProbe({
      verdict: "READ_ONLY_LIVE_PROBE_PASS",
      read_only_live_probe_pass: true,
      prepared_packet_byte_equal_after: true,
      db_provenance: {
        status: "READY",
        required_series_present: true,
        auditor_recompute_pass: false,
        common_interval_proven: false,
        counter_epoch_unchanged: true,
      },
    }),
  );
  writeJsonSha(probedPath, baseProbed());

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--prepared-packet",
    preparedPath,
    "--prepared-sha-before",
    preparedSha,
    "--out",
    out,
  ]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(audit.verdict, "LIVE_PROBE_ARCHIVE_AUDIT_FAIL");
  assert.ok(audit.failures.includes("pass:auditor_recompute_pass_false"));
  assert.ok(audit.failures.includes("pass:common_interval_proven_false"));
  rmSync(dir, { recursive: true, force: true });
});

test("archive auditor PASS requires PREPARED path, sidecar, and sha-before", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-pass-prepared-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const out = join(dir, "audit.json");

  writeJsonSha(
    probePath,
    baseProbe({
      verdict: "READ_ONLY_LIVE_PROBE_PASS",
      read_only_live_probe_pass: true,
      prepared_packet_byte_equal_after: true,
      db_provenance: {
        status: "READY",
        required_series_present: true,
        auditor_recompute_pass: true,
        common_interval_proven: true,
        counter_epoch_unchanged: true,
      },
    }),
  );
  writeJsonSha(probedPath, baseProbed());

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--out",
    out,
  ]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(audit.failures.includes("pass:prepared_packet_path_missing"));
  rmSync(dir, { recursive: true, force: true });
});

test("archive auditor fails if PROBED packet is AUTHORIZED", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-authz-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const out = join(dir, "audit.json");

  writeJsonSha(probePath, baseProbe());
  writeJsonSha(probedPath, {
    status: "AUTHORIZED",
    live_window_authorized: true,
  });

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--out",
    out,
  ]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(audit.failures.includes("probed:status_not_prepared_not_authorized"));
  rmSync(dir, { recursive: true, force: true });
});

test("archive auditor fail-closed on malformed probe JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-malformed-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const out = join(dir, "audit.json");
  writeFileSync(probePath, "{not-json");
  writeFileSync(
    `${probePath}.sha256`,
    `${createHash("sha256").update("{not-json").digest("hex")}\n`,
  );
  writeJsonSha(probedPath, baseProbed());

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--out",
    out,
  ]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(audit.verdict, "LIVE_PROBE_ARCHIVE_AUDIT_FAIL");
  assert.ok(audit.failures.includes("probe:malformed_json"));
  rmSync(dir, { recursive: true, force: true });
});

test("archive auditor fail-closed on empty/malformed SHA sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-sidecar-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const out = join(dir, "audit.json");
  writeJsonSha(probePath, baseProbe());
  writeJsonSha(probedPath, baseProbed());
  writeFileSync(`${probePath}.sha256`, "\n");

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--out",
    out,
  ]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(audit.failures.includes("probe:sha256_sidecar_malformed"));
  rmSync(dir, { recursive: true, force: true });
});

test("archive auditor fail-closed on non-integer outbox_rows_mutated", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-rows-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const out = join(dir, "audit.json");
  writeJsonSha(probePath, baseProbe({ outbox_rows_mutated: "0" }));
  writeJsonSha(probedPath, baseProbed());

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--out",
    out,
  ]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(audit.failures.includes("probe:outbox_rows_mutated_not_int"));
  rmSync(dir, { recursive: true, force: true });
});

test("archive auditor fail-closed when supplied --prepared-packet is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-archive-prepared-missing-"));
  const probePath = join(dir, "probe.json");
  const probedPath = join(dir, "probed.json");
  const out = join(dir, "audit.json");
  writeJsonSha(probePath, baseProbe());
  writeJsonSha(probedPath, baseProbed());

  const r = runArchiveAuditor([
    "--probe",
    probePath,
    "--probed-packet",
    probedPath,
    "--prepared-packet",
    join(dir, "does-not-exist.PREPARED.json"),
    "--prepared-sha-before",
    "a".repeat(64),
    "--out",
    out,
  ]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const audit = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(audit.failures.includes("prepared:artifact_missing"));
  rmSync(dir, { recursive: true, force: true });
});
