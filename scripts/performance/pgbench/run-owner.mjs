#!/usr/bin/env node
/**
 * Per-owner pgbench entry — requires GATE3_OWNER and authorization.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGBENCH_BLOCKED, evaluatePgbenchParityGate } from "../../lib/pgbench_parity_gate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const owner = (process.env.GATE3_OWNER || "").trim();
if (!owner) {
  console.error(`${PGBENCH_BLOCKED}: set GATE3_OWNER=<owner> for per-owner runner`);
  process.exit(2);
}

const parity = JSON.parse(
  readFileSync(join(ROOT, "reports/performance/outbox-publisher-parity.PREPARED.json"), "utf8"),
);
const harness = JSON.parse(
  readFileSync(join(ROOT, "reports/performance/end-harness.PREPARED.json"), "utf8"),
);
const gate = evaluatePgbenchParityGate(parity);
if (!gate.allowed || harness.pgbench_execution_authorized !== true) {
  console.error(`${PGBENCH_BLOCKED}: ${(gate.reasons || ["unauthorized"]).join("; ")}`);
  process.exit(2);
}

process.env.GATE3_OWNER_FILTER = owner;
const { spawnSync } = await import("node:child_process");
const result = spawnSync(process.execPath, [join(ROOT, "scripts/performance/run-pgbench-matrix.mjs")], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 2);
