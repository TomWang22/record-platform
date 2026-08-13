#!/usr/bin/env node
/**
 * pgbench matrix entrypoint (Gate 3).
 * GATE3_CONTRACT=1 → resumable full-contract runner (30s/120s, no scout promotion).
 * Otherwise → legacy scout/capacity runner.
 * FAIL-CLOSED: stubs / unauthorized flags never default-allow.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PGBENCH_BLOCKED,
  evaluatePgbenchParityGate,
} from "../lib/pgbench_parity_gate.mjs";
import { PGBENCH_STUB_BLOCKED, scanPgbenchStubSql } from "../lib/pgbench_completeness.mjs";
import { runPgbenchMatrix } from "../lib/pgbench_runner.mjs";
import { runPgbenchContractMatrix } from "../lib/pgbench_contract_runner.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PARITY_PATH = join(ROOT, "reports/performance/outbox-publisher-parity.PREPARED.json");
const HARNESS_PATH = join(ROOT, "reports/performance/end-harness.PREPARED.json");

function fail(reason) {
  console.error(`${PGBENCH_BLOCKED}: ${reason}`);
  process.exit(2);
}

let parity;
let harness;
try {
  parity = JSON.parse(readFileSync(PARITY_PATH, "utf8"));
  harness = JSON.parse(readFileSync(HARNESS_PATH, "utf8"));
} catch (err) {
  fail(`cannot read artifacts: ${err instanceof Error ? err.message : String(err)}`);
}

const gate = evaluatePgbenchParityGate(parity);
if (!gate.allowed) {
  fail(gate.reasons.join("; "));
}

if (harness.pgbench_execution_authorized !== true) {
  fail("pgbench_execution_authorized=false in end-harness artifact");
}

if (harness.protocol_execution_authorized === true) {
  fail("protocol_execution_authorized must remain false during Gate 3");
}

const stubs = scanPgbenchStubSql(join(ROOT, "scripts/performance/pgbench"));
if (stubs.length > 0) {
  console.error(
    `${PGBENCH_STUB_BLOCKED}: ${stubs.length} offenders: ${stubs
      .slice(0, 8)
      .map((s) => s.path)
      .join(", ")}`,
  );
  process.exit(2);
}

const cellLimit = Number(process.env.GATE3_CELL_LIMIT || 0);
const useContract = process.env.GATE3_CONTRACT === "1";

if (useContract) {
  const { runId, reportDir, summary, completeness, shas } = await runPgbenchContractMatrix({
    root: ROOT,
    harness,
    parity,
    resumeDir: process.env.GATE3_RESUME_DIR || undefined,
    cellLimit: cellLimit > 0 ? cellLimit : undefined,
  }).catch((err) => {
    console.error(`${PGBENCH_BLOCKED}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

  console.log(
    JSON.stringify(
      {
        mode: "CONTRACT",
        run_id: runId,
        report_dir: reportDir,
        pgbench_ceiling_complete: summary.pgbench_ceiling_complete,
        required_cell_count: completeness.expected_cell_count,
        pass_cell_count: completeness.pass_cell_count,
        blocked_cell_count: completeness.blocked_cell_count,
        invalid_cell_count: completeness.invalid_cell_count,
        unknowns: completeness.unknowns,
        shas,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const fullThreadFanout = process.env.GATE3_FULL_THREAD_FANOUT === "1";
const { runId, reportDir, summary, completeness } = await runPgbenchMatrix({
  root: ROOT,
  harness,
  parity,
  fullThreadFanout,
  cellLimit: cellLimit > 0 ? cellLimit : undefined,
}).catch((err) => {
  console.error(`${PGBENCH_BLOCKED}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

console.log(
  JSON.stringify(
    {
      mode: "SCOUT_OR_CAPACITY",
      run_id: runId,
      report_dir: reportDir,
      pgbench_ceiling_complete: summary.pgbench_ceiling_complete,
      pass_count: summary.pass_count,
      blocked_count: summary.blocked_count,
      expected_cell_count: completeness.expected_cell_count,
    },
    null,
    2,
  ),
);

process.exit(0);
