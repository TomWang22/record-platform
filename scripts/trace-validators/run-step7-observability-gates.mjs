#!/usr/bin/env node
/**
 * Orchestrates Step 7 observability gates: span-tree (7B) + overlap (O1–O4).
 * Writes unified JSON to --report-dir for CI / drift tooling.
 *
 * Env: JAEGER_QUERY_BASE (required)
 *      STEP7_SEED_SERVICE (default api-gateway)
 *      STEP7_LOOKBACK_SEC (default 900)
 *      STEP7_MIN_SPANS (default 6)
 *      STEP7_MIN_DEPTH (default 3)
 *      STEP7_REQUIRED_SERVICES — comma list (optional)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTracesUrl, fetchJson, normalizeTrace } from "./lib/jaeger-traces.mjs";
import { validateSpanTreeInvariant } from "./step7-strict-span-invariant.mjs";
import { validateOverlapInvariant } from "./trace-overlap-validator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  const v = argv[i + 1];
  if (String(v).startsWith("-")) return def;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function fetchTraces(base, service, lookback, limit) {
  const url = buildTracesUrl(base, service, lookback, limit);
  const data = await fetchJson(url);
  return data.data || [];
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
    console.error(`Usage: JAEGER_QUERY_BASE=http://host:16686 node scripts/trace-validators/run-step7-observability-gates.mjs [--report-dir DIR] [--retries N] [--sleep-ms MS]`);
    process.exit(1);
  }
  const base = process.env.JAEGER_QUERY_BASE?.replace(/\/$/, "");
  if (!base) {
    console.error("JAEGER_QUERY_BASE is required");
    process.exit(2);
  }
  const reportDir = getArg(argv, "--report-dir", join(process.cwd(), "bench_logs/step7-observability"));
  const retries = Number(getArg(argv, "--retries", process.env.STEP7_RETRIES || "8"));
  const sleepMs = Number(getArg(argv, "--sleep-ms", process.env.STEP7_SLEEP_MS || "2000"));
  const lookback = Number(process.env.STEP7_LOOKBACK_SEC || "900");
  const limit = Number(process.env.STEP7_TRACE_LIMIT || "25");
  const seed = process.env.STEP7_SEED_SERVICE || "api-gateway";
  const minSpan = Number(process.env.STEP7_MIN_SPANS || "4");
  const minDepth = Number(process.env.STEP7_MIN_DEPTH || "2");
  const required = (process.env.STEP7_REQUIRED_SERVICES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const specVersion = "och-observability-integrity-spec-v1";

  let lastErr = "no trace passed gates";
  for (let attempt = 1; attempt <= retries; attempt++) {
    let traces;
    try {
      traces = await fetchTraces(base, seed, lookback, limit);
    } catch (e) {
      lastErr = String(e?.message || e);
      console.error(`step7-observability: fetch attempt ${attempt}/${retries} failed: ${lastErr}`);
      if (attempt < retries) await new Promise((r) => setTimeout(r, sleepMs));
      continue;
    }
    for (const raw of traces) {
      const trace = normalizeTrace(raw);
      if (!trace?.spans?.length) continue;
      const tree = validateSpanTreeInvariant(trace, {
        minSpanCount: minSpan,
        minDepth,
        requiredServices: required,
      });
      const overlap = validateOverlapInvariant(trace, {});
      if (tree.ok && overlap.ok) {
        const out = {
          specVersion,
          status: "PASS",
          traceID: trace.traceID,
          seed,
          attempt,
          spanTree: { ...tree, violations: tree.violations },
          overlap: { ...overlap, violations: overlap.violations },
          timestamp: new Date().toISOString(),
        };
        mkdirSync(reportDir, { recursive: true });
        writeFileSync(join(reportDir, "step7-observability-gates.json"), `${JSON.stringify(out, null, 2)}\n`);
        console.log(
          `step7-observability: PASS trace=${trace.traceID} spans=${tree.spanCount} depth=${tree.depth} attempt=${attempt}`,
        );
        process.exit(0);
      }
      lastErr = JSON.stringify({
        tree: tree.violations,
        overlap: overlap.violations,
      });
    }
    console.error(`step7-observability: attempt ${attempt}/${retries} no passing trace`);
    if (attempt < retries) await new Promise((r) => setTimeout(r, sleepMs));
  }

  const fail = {
    specVersion,
    status: "FAIL",
    seed,
    lastError: lastErr,
    timestamp: new Date().toISOString(),
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "step7-observability-gates.json"), `${JSON.stringify(fail, null, 2)}\n`);
  console.error("step7-observability: FAIL — no trace satisfied span-tree + overlap invariants");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
