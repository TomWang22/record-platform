#!/usr/bin/env node
/**
 * Merge/validate Gate-3 shard checkpoints. Never declares ceiling if incomplete.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateMergedCompleteness,
  writeMergedArtifacts,
  loadAllShardCells,
  mergeShardResults,
} from "../lib/pgbench_merge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN =
  process.env.GATE3_RESUME_DIR ||
  "reports/performance/pgbench/pgbench-contract-20260812-011924-ef21a35e";
const reportDir = RUN.startsWith("/") ? RUN : join(ROOT, RUN);
const doWrite = process.env.GATE3_MERGE_WRITE === "1";

const validation = validateMergedCompleteness(reportDir);
const shards = loadAllShardCells(reportDir);
const merge = mergeShardResults(shards);

const out = {
  report_dir: reportDir,
  shard_count_loaded: shards.length,
  validation,
  merge_ok: merge.ok,
  merge_errors: merge.errors.slice(0, 20),
  invalid_sample: merge.invalid.slice(0, 20),
  invalid_legacy_checkpoint_count: merge.invalid.filter(
    (i) => i.reason === "LEGACY_CHECKPOINT_INSUFFICIENT",
  ).length,
  pgbench_ceiling_complete: false,
};

if (doWrite) {
  const written = writeMergedArtifacts(reportDir);
  out.write = written;
  out.pgbench_ceiling_complete = Boolean(
    written.written && written.completeness?.pgbench_ceiling_complete_allowed,
  );
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.validation.pgbench_ceiling_complete_allowed && merge.ok ? 0 : 2);
