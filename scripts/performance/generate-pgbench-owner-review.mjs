#!/usr/bin/env node
/**
 * Read-only owner review generator for Gate 3.
 * Does not authorize tuning/protocol; never sets pgbench_ceiling_complete=true.
 *
 * Usage:
 *   GATE3_RESUME_DIR=reports/performance/pgbench/<run_id> \
 *   GATE3_OWNER=records \
 *   node scripts/performance/generate-pgbench-owner-review.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeOwnerReviewArtifacts } from "../lib/pgbench_owner_review.mjs";
import { OWNERS } from "../lib/pgbench_completeness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN =
  process.env.GATE3_RESUME_DIR ||
  "reports/performance/pgbench/pgbench-contract-20260812-011924-ef21a35e";
const reportDir = RUN.startsWith("/") ? RUN : join(ROOT, RUN);
const owner = process.env.GATE3_OWNER || "records";
const all = process.env.GATE3_ALL_OWNERS === "1";
const runId = reportDir.split("/").pop();

const owners = all ? OWNERS : [owner];
const outputs = [];
for (const o of owners) {
  outputs.push(writeOwnerReviewArtifacts(reportDir, o, runId));
}

console.log(
  JSON.stringify(
    {
      report_dir: reportDir,
      run_id: runId,
      owners: outputs.map((o) => ({
        owner: o.review.owner,
        expected_owner_cells: o.review.expected_owner_cells,
        valid_owner_cells: o.review.valid_owner_cells,
        missing_cells: o.review.missing_cells,
        owner_complete: o.review.owner_complete,
        pgbench_ceiling_complete: o.review.pgbench_ceiling_complete,
        cross_environment_w1_w2_pairs: o.review.cross_environment_w1_w2_pairs,
        legacy_checkpoint_cells_used: o.review.legacy_checkpoint_cells_used,
      })),
      note: "Owner complete ≠ Gate 3 complete. No tuning. No protocol.",
    },
    null,
    2,
  ),
);

process.exit(outputs.every((o) => o.review.exit_code === 0) ? 0 : 2);
