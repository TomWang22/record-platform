#!/usr/bin/env node
/**
 * Track A exact-SHA CI orchestrator.
 *
 * Runs A1/A2 harness tests (unless --skip-tests), freezes source file SHAs,
 * emits reports/ci Track A artifacts, then optionally invokes the meta-auditor.
 *
 * Never authorizes canary-v3 or flips LIVE_CAPTURE_ACCEPTANCE_READY.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FORBIDDEN_FLAGS,
  exactSha,
  writeJsonWithSha,
  buildDenomFreeze,
} from "./emit-denom-freeze.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const TRACK_A_SOURCE_FILES = [
  "services/auction-monitor/src/outbox-publish-metrics.ts",
  "services/auction-monitor/src/ai-signals.ts",
  "services/auction-monitor/src/__tests__/outbox-provenance-counters.test.ts",
  "services/auction-monitor/src/__tests__/outbox-provenance-wiring.test.ts",
  "scripts/lib/auction_monitor_canary_v3_live_capture.py",
  "scripts/lib/auction_monitor_canary_v3_production_adapters.py",
  "scripts/lib/auction_monitor_canary_v3_orchestrator.py",
  "scripts/lib/auction_monitor_canary_v3_trace.py",
  "scripts/audit-auction-monitor-canary-v3-final-root.py",
  "scripts/audit-canary-v3-live-readonly-probe-archive.py",
  "scripts/run-auction-monitor-canary-v3-readonly-live-probe.py",
  "scripts/run-auction-monitor-broker-ack-canary-v3.py",
  "scripts/audit-track-a-meta.py",
  "scripts/ci/emit-denom-freeze.mjs",
  "scripts/ci/run-track-a-exact-sha-ci.mjs",
  "scripts/ci/verify-track-a-owner-preflight.mjs",
  "reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json",
];

const A1_NODE_TESTS = [
  "tests/auction-monitor-canary-v3-db-provenance.test.mjs",
  "tests/auction-monitor-canary-v3-db-provenance-tamper.test.mjs",
  "tests/auction-monitor-canary-v3-live-capture-fail-closed.test.mjs",
  "tests/auction-monitor-canary-v3-live-capture-adversarial.test.mjs",
];

const A2_NODE_TESTS = ["tests/auction-monitor-canary-v3-readonly-probe.test.mjs"];

function sha256File(rel) {
  const abs = join(REPO, rel);
  if (!existsSync(abs)) {
    throw new Error(`track_a_source_missing:${rel}`);
  }
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function freezeSourceShas() {
  const files = {};
  for (const rel of TRACK_A_SOURCE_FILES) {
    files[rel] = sha256File(rel);
  }
  return files;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function assertForbiddenFalse(payload, label) {
  for (const [k, v] of Object.entries(FORBIDDEN_FLAGS)) {
    if (payload[k] !== v) {
      throw new Error(`${label}:forbidden_flag:${k}=${payload[k]}`);
    }
  }
}

function runA1Tests() {
  const results = [];
  for (const script of [
    "test:outbox-provenance-counters",
    "test:outbox-provenance-wiring",
    "test:outbox-accounting",
  ]) {
    const r = run("pnpm", ["--filter", "auction-monitor", "run", script]);
    results.push({ suite: script, pass: r.status === 0, status: r.status });
    if (r.status !== 0) {
      return {
        pass: false,
        results,
        detail: r.stderr || r.stdout,
      };
    }
  }
  const node = run("node", ["--test", ...A1_NODE_TESTS]);
  results.push({
    suite: "node-a1-provenance",
    pass: node.status === 0,
    status: node.status,
  });
  return {
    pass: node.status === 0,
    results,
    detail: node.status === 0 ? null : node.stderr || node.stdout,
  };
}

function runA2Tests() {
  const node = run("node", ["--test", ...A2_NODE_TESTS]);
  return {
    pass: node.status === 0,
    results: [
      {
        suite: "node-a2-readonly-probe",
        pass: node.status === 0,
        status: node.status,
      },
    ],
    detail: node.status === 0 ? null : node.stderr || node.stdout,
  };
}

function emitA1({ exact_sha, source_file_shas, test }) {
  const payload = {
    schema: "track-a1-provenance-result/v1",
    track: "A1",
    verdict: test.pass ? "HARNESS_PASS" : "HARNESS_FAIL",
    exact_sha,
    counters: [
      "auction_monitor_outbox_created_total",
      "auction_monitor_outbox_db_acknowledged_total",
      "auction_monitor_outbox_reopened_total",
      "auction_monitor_outbox_deleted_unpublished_total",
    ],
    auditor_recompute_tests_pass: test.pass,
    tamper_tests_pass: test.pass,
    acceptance_ready: false,
    live_window_authorized: false,
    live_capture_acceptance_ready: false,
    a2_live_acceptance_ready: false,
    source_file_shas,
    test_suites: test.results,
    ...FORBIDDEN_FLAGS,
  };
  assertForbiddenFalse(payload, "a1");
  const out = join(REPO, "reports/ci/track-a1-provenance-result.json");
  writeJsonWithSha(out, payload);
  return { path: out, payload };
}

function emitA2({ exact_sha, source_file_shas, test, a1_pass }) {
  const payload = {
    schema: "track-a2-readonly-probe-result/v1",
    track: "A2",
    verdict: test.pass && a1_pass ? "HARNESS_PASS" : "HARNESS_FAIL",
    exact_sha,
    probe_fixture_verdict: "READ_ONLY_PATH_SIMULATED",
    read_only_live_probe_pass: false,
    cluster_mutation_attempted: false,
    publisher_invocation_triggered: false,
    live_window_authorized: false,
    live_capture_acceptance_ready: false,
    a2_live_implemented: true,
    a2_live_acceptance_ready: false,
    real_cluster_probe_executed: false,
    source_file_shas,
    test_suites: test.results,
    ...FORBIDDEN_FLAGS,
  };
  assertForbiddenFalse(payload, "a2");
  if (payload.read_only_live_probe_pass !== false) {
    throw new Error("a2:ci_must_not_claim_live_probe_pass");
  }
  const out = join(REPO, "reports/ci/track-a2-readonly-probe-result.json");
  writeJsonWithSha(out, payload);
  return { path: out, payload };
}

function emitTrackABundle({ exact_sha, source_file_shas, a1, a2, denom }) {
  const payload = {
    schema: "track-a-exact-sha-bundle/v1",
    verdict:
      a1.payload.verdict === "HARNESS_PASS" &&
      a2.payload.verdict === "HARNESS_PASS" &&
      denom.verdict === "DENOM_FREEZE_PASS"
        ? "TRACK_A_CI_HARNESS_PASS"
        : "TRACK_A_CI_HARNESS_FAIL",
    exact_sha,
    source_file_shas,
    artifacts: {
      denom_freeze: "reports/ci/denom-freeze.json",
      a1: "reports/ci/track-a1-provenance-result.json",
      a2: "reports/ci/track-a2-readonly-probe-result.json",
      prepared_packet:
        "reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json",
    },
    live_window_authorized: false,
    canary_v3_execution_authorized: false,
    canary_v3_window_executed: false,
    finite_drain_experiment_armed: false,
    maintenance_quiesce_v2_created: false,
    ...FORBIDDEN_FLAGS,
  };
  assertForbiddenFalse(payload, "bundle");
  const out = join(REPO, "reports/ci/track-a-exact-sha-bundle.json");
  writeJsonWithSha(out, payload);
  return { path: out, payload };
}

function main(argv = process.argv.slice(2)) {
  const skipTests = argv.includes("--skip-tests");
  const skipMeta = argv.includes("--skip-meta");
  const exact_sha = exactSha();
  const source_file_shas = freezeSourceShas();

  const denom = buildDenomFreeze({ sha: exact_sha });
  writeJsonWithSha(join(REPO, "reports/ci/denom-freeze.json"), denom);

  const a1Test = skipTests
    ? { pass: true, results: [{ suite: "skipped", pass: true, status: 0 }] }
    : runA1Tests();
  const a1 = emitA1({ exact_sha, source_file_shas, test: a1Test });

  const a2Test = skipTests
    ? { pass: true, results: [{ suite: "skipped", pass: true, status: 0 }] }
    : runA2Tests();
  const a2 = emitA2({
    exact_sha,
    source_file_shas,
    test: a2Test,
    a1_pass: a1Test.pass,
  });

  const bundle = emitTrackABundle({
    exact_sha,
    source_file_shas,
    a1,
    a2,
    denom,
  });

  let meta = null;
  if (!skipMeta) {
    const r = run("python3", [
      join(REPO, "scripts/audit-track-a-meta.py"),
      "--ci-dir",
      join(REPO, "reports/ci"),
      "--repo",
      REPO,
      "--quiet",
    ]);
    meta = {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
    };
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(r.status || 2);
    }
  }

  const summary = {
    exact_sha,
    denom: denom.verdict,
    a1: a1.payload.verdict,
    a2: a2.payload.verdict,
    bundle: bundle.payload.verdict,
    meta_auditor: meta ? (meta.status === 0 ? "PASS" : "FAIL") : "SKIPPED",
    live_window_authorized: false,
    a2_live_acceptance_ready: false,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!a1Test.pass || !a2Test.pass) {
    process.exit(2);
  }
  if (bundle.payload.verdict !== "TRACK_A_CI_HARNESS_PASS") {
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
