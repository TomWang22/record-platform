#!/usr/bin/env node
/**
 * Track A owner-review preflight.
 *
 * Proves:
 *   meta.exact_sha == git HEAD == origin/main
 *   Track A source files are committed and clean at that SHA
 *   meta verdict == TRACK_A_META_PASS
 *   acceptance / authorization flags remain false
 *
 * Does NOT run the live probe.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const TRACK_A_SOURCE_FILES = [
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

function sh(args, { cwd = REPO } = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: r.status ?? 1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

export function verifyTrackAOwnerPreflight({
  repo = REPO,
  sourceFiles = TRACK_A_SOURCE_FILES,
} = {}) {
  const failures = [];
  const head = sh(["-C", repo, "rev-parse", "HEAD"], { cwd: repo });
  const origin = sh(["-C", repo, "rev-parse", "origin/main"], { cwd: repo });
  if (head.status !== 0) failures.push("git_head_unavailable");
  if (origin.status !== 0) failures.push("origin_main_unavailable");

  const metaPath = join(repo, "reports/ci/track-a-meta-auditor-result.json");
  if (!existsSync(metaPath)) {
    failures.push("meta_auditor_result_missing");
  }
  let meta = {};
  if (existsSync(metaPath)) {
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
  }

  const headSha = head.stdout;
  const originSha = origin.stdout;
  const metaSha = meta.exact_sha || "";

  if (headSha && originSha && headSha !== originSha) {
    failures.push(`head_ne_origin_main:${headSha}!=${originSha}`);
  }
  if (headSha && metaSha && headSha !== metaSha) {
    failures.push(`head_ne_meta_exact_sha:${headSha}!=${metaSha}`);
  }
  if (meta.verdict && meta.verdict !== "TRACK_A_META_PASS") {
    failures.push(`meta_verdict:${meta.verdict}`);
  }

  const uncommitted = [];
  for (const rel of sourceFiles) {
    const abs = join(repo, rel);
    if (!existsSync(abs)) {
      failures.push(`source_missing:${rel}`);
      continue;
    }
    const tracked = sh(["-C", repo, "ls-files", "--error-unmatch", rel], {
      cwd: repo,
    });
    if (tracked.status !== 0) {
      uncommitted.push(`untracked:${rel}`);
      continue;
    }
    const dirty = sh(["-C", repo, "status", "--porcelain", "--", rel], {
      cwd: repo,
    });
    if (dirty.stdout) {
      uncommitted.push(`dirty:${rel}:${dirty.stdout.split("\n")[0]}`);
    }
  }
  failures.push(...uncommitted);

  for (const key of [
    "execution_authorized",
    "live_window_authorized",
    "a2_live_acceptance_ready",
    "live_capture_acceptance_ready",
    "canary_v3_execution_authorized",
    "canary_v3_window_executed",
  ]) {
    if (meta[key] === true) failures.push(`meta_forbidden_true:${key}`);
  }

  const pass = failures.length === 0;
  return {
    schema: "track-a-owner-preflight/v1",
    verdict: pass
      ? "TRACK_A_OWNER_REVIEW_PREFLIGHT_PASS"
      : "TRACK_A_OWNER_REVIEW_PREFLIGHT_FAIL",
    head_sha: headSha || null,
    origin_main_sha: originSha || null,
    meta_exact_sha: metaSha || null,
    sha_triple_equal: Boolean(
      headSha && originSha && metaSha && headSha === originSha && headSha === metaSha,
    ),
    track_a_sources_committed_and_clean: uncommitted.length === 0,
    uncommitted_or_dirty_sources: uncommitted,
    failures,
    live_probe_authorized_by_this_script: false,
    note: pass
      ? "SHA freeze is clean; manual read-only probe may proceed under the command packet."
      : "Do not run the manual live probe. Commit/freeze Track A at origin/main and re-emit exact-SHA CI first.",
  };
}

function main() {
  const report = verifyTrackAOwnerPreflight();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === "TRACK_A_OWNER_REVIEW_PREFLIGHT_PASS" ? 0 : 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
