#!/usr/bin/env node
/**
 * Enforce coverage thresholds from scripts/coverage/service-coverage-manifest.json.
 * Fails only for services with strict_enabled=true. Others print explicit SKIP.
 *
 * Usage:
 *   node scripts/coverage/enforce-service-coverage.mjs
 *   node scripts/coverage/enforce-service-coverage.mjs python-ai-service
 *
 * Env:
 *   REPO_ROOT — repo root (default: auto)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REPO_ROOT || join(__dirname, "..", "..");
const MANIFEST = join(REPO, "scripts", "coverage", "service-coverage-manifest.json");
const TARGET = process.argv[2] || null;

const AXES = ["lines", "branches", "functions", "statements"];

function loadManifest() {
  if (!existsSync(MANIFEST)) {
    console.error(`enforce-service-coverage: missing ${MANIFEST}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function pct(block, axis) {
  const v = block?.[axis]?.pct;
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function readSummary(svc) {
  const rel = svc.coverage_summary_path;
  const p = join(REPO, rel);
  if (!existsSync(p)) return { path: p, data: null };
  try {
    return { path: p, data: JSON.parse(readFileSync(p, "utf8")) };
  } catch (e) {
    return { path: p, data: null, error: e?.message || String(e) };
  }
}

function enforceService(svc) {
  const { name, strict_enabled: strict, threshold = {}, skip_reason: skipReason } = svc;

  if (!strict) {
    const reason = skipReason || "strict_enabled=false";
    const { path, data } = readSummary(svc);
    if (data?.total?.lines?.pct != null) {
      const linePct = pct(data.total, "lines");
      console.log(
        `SKIP ${name} — ${reason} (dry-wire summary: lines ${linePct?.toFixed(2)}%)`,
      );
    } else {
      console.log(`SKIP ${name} — ${reason}`);
    }
    return { name, status: "skip", reason };
  }

  const { path, data, error } = readSummary(svc);
  if (!data) {
    const msg = error
      ? `invalid summary (${error})`
      : `missing coverage summary at ${path} (run coverage first)`;
    console.error(`FAIL ${name} — ${msg}`);
    return { name, status: "fail", reason: msg };
  }

  const total = data.total || {};
  const failures = [];
  for (const [axis, min] of Object.entries(threshold)) {
    if (typeof min !== "number") continue;
    const v = pct(total, axis);
    if (v == null) {
      failures.push(`${axis}: no pct in summary`);
      continue;
    }
    if (v < min) failures.push(`${axis} ${v.toFixed(2)}% < ${min}%`);
  }

  if (failures.length) {
    console.error(`FAIL ${name} — ${failures.join("; ")}`);
    if (svc.coverage_include) {
      console.error(`  scope: ${svc.coverage_include}`);
    }
    return { name, status: "fail", reason: failures.join("; ") };
  }

  const linePct = pct(total, "lines");
  console.log(`PASS ${name} — lines ${linePct?.toFixed(2)}% (strict gate)`);
  return { name, status: "pass" };
}

function main() {
  const manifest = loadManifest();
  const services = TARGET
    ? manifest.services.filter((s) => s.name === TARGET)
    : manifest.services;

  if (TARGET && services.length === 0) {
    console.error(`enforce-service-coverage: unknown service ${TARGET}`);
    process.exit(3);
  }

  const results = services.map(enforceService);
  const failed = results.filter((r) => r.status === "fail");
  const passed = results.filter((r) => r.status === "pass");
  const skipped = results.filter((r) => r.status === "skip");

  console.error("");
  console.error(
    `enforce-service-coverage: ${passed.length} pass, ${skipped.length} skip, ${failed.length} fail`,
  );

  if (failed.length) {
    process.exit(1);
  }
  process.exit(0);
}

main();
