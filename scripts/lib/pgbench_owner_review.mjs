/**
 * Read-only per-owner Gate 3 review generator.
 * Produces the RECORDS_OWNER_REVIEW validation block (works for any owner).
 * Never sets pgbench_ceiling_complete=true from a single-owner review.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enumerateExpectedPgbenchCells } from "./pgbench_completeness.mjs";
import { cellsPerOwner } from "./pgbench_shard.mjs";
import {
  CONTRACT_WARMUP_SECONDS,
  CONTRACT_MEASURED_SECONDS,
  WORKLOAD_REVISION,
} from "./pgbench_resume.mjs";
import { computeCellMatchedOutboxTax, summarizeOutboxTax } from "./pgbench_outbox_tax.mjs";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function isEnvValidPass(cell) {
  if (!cell || cell.status !== "PASS") return false;
  if (Number(cell.warmup_seconds) !== CONTRACT_WARMUP_SECONDS) return false;
  if (Number(cell.measured_seconds) !== CONTRACT_MEASURED_SECONDS) return false;
  if (cell.workload_revision && cell.workload_revision !== WORKLOAD_REVISION) return false;
  const env = cell.environment;
  if (!env?.environment_id || !env?.db_instance_id || !env?.contention_domain_id) return false;
  if (!env?.postgres_config_hash) return false;
  return true;
}

/**
 * Frozen owner-complete predicate.
 * Owner complete ≠ Gate 3 ceiling complete.
 *
 * @param {{
 *   expected_owner_cells: number,
 *   valid_owner_cells: number,
 *   missing_cells: number,
 *   duplicate_cells: number,
 *   invalid_environment_cells: number,
 *   interference_cells: number,
 *   legacy_checkpoint_cells_used: number,
 *   cross_environment_w1_w2_pairs: number,
 * }} counts
 */
export function evaluateOwnerComplete(counts) {
  const expected = Number(counts.expected_owner_cells);
  const valid = Number(counts.valid_owner_cells);
  const over_count = valid > expected;
  const anomalies =
    Number(counts.missing_cells) !== 0 ||
    Number(counts.duplicate_cells) !== 0 ||
    Number(counts.invalid_environment_cells) !== 0 ||
    Number(counts.interference_cells) !== 0 ||
    Number(counts.legacy_checkpoint_cells_used) !== 0 ||
    Number(counts.cross_environment_w1_w2_pairs) !== 0 ||
    over_count ||
    valid !== expected;

  if (over_count) {
    return {
      owner_complete: false,
      pgbench_ceiling_complete: false,
      over_count: true,
      reason: `valid_owner_cells > expected_owner_cells (${valid} > ${expected})`,
      exit_code: 2,
    };
  }

  if (anomalies) {
    return {
      owner_complete: false,
      pgbench_ceiling_complete: false,
      over_count: false,
      reason: "OWNER_INCOMPLETE_OR_ANOMALY",
      exit_code: 2,
    };
  }

  return {
    owner_complete: true,
    pgbench_ceiling_complete: false,
    over_count: false,
    reason: null,
    exit_code: 0,
  };
}

/**
 * @param {any[]} rows
 */
export function summarizeW3Batches(rows) {
  const w3 = rows.filter(
    (r) => r.workload === "W3_PUBLISHER_DB_PATH" && r.status === "PASS" && isEnvValidPass(r),
  );
  /** @type {Record<string, any>} */
  const by_batch = {};
  for (const batch of [1, 10, 25, 50]) {
    const subset = w3.filter((r) => Number(r.batch) === batch);
    if (!subset.length) {
      by_batch[String(batch)] = { n: 0, avg_latency_ms: null, avg_tps: null, avg_p95: null };
      continue;
    }
    const avg = (xs, key) => {
      const vals = xs.map((x) => x[key]).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    by_batch[String(batch)] = {
      n: subset.length,
      avg_latency_ms: avg(subset, "avg_latency_ms"),
      avg_tps: avg(subset, "tps"),
      avg_p95: avg(subset, "p95"),
    };
  }
  return {
    by_batch,
    optimal_batch_selected: null,
    note: "Gate 3 reports the batch curve only — do not adopt an optimal batch",
  };
}

/**
 * @param {any[]} rows
 */
export function summarizeLatency(rows) {
  const pass = rows.filter((r) => isEnvValidPass(r));
  const withP = pass.filter((r) => r.p50 != null && r.p95 != null && r.p99 != null);
  return {
    cells_with_percentiles: withP.length,
    cells_with_p95: pass.filter((r) => r.p95 != null).length,
    cells_missing_percentiles: pass.length - withP.length,
    note: "percentiles derived from pgbench -l samples only; never from avg/stddev",
  };
}

/**
 * @param {any[]} rows
 */
export function summarizePostgresWaits(rows) {
  const withSamples = rows.filter(
    (r) => r.postgres_samples?.before || r.postgres_samples?.after,
  );
  if (!withSamples.length) {
    return {
      status: "PARTIAL_OR_UNAVAILABLE",
      reason: "no postgres_samples on owner cells",
      locks: null,
      io: null,
      cpu: null,
    };
  }
  return {
    status: "PARTIAL_OR_UNAVAILABLE",
    reason:
      "raw before/after samples present; lock/IO/CPU attribution classifier not yet complete — do not invent values",
    cells_with_samples: withSamples.length,
    locks: null,
    io: null,
    cpu: null,
  };
}

/**
 * @param {{ owner: string, run_id: string, results: any[], environment_id?: string, postgres_config_hash?: string }} opts
 */
export function buildOwnerReview(opts) {
  const owner = opts.owner;
  const expectedIds = enumerateExpectedPgbenchCells()
    .filter((c) => c.mode === "PER_OWNER_CEILING" && c.owner === owner)
    .map((c) => c.cell_id);

  const ownerRows = (opts.results || []).filter(
    (r) => r.owner === owner && r.mode === "PER_OWNER_CEILING",
  );

  /** @type {Map<string, any[]>} */
  const byId = new Map();
  for (const row of ownerRows) {
    const list = byId.get(row.cell_id) || [];
    list.push(row);
    byId.set(row.cell_id, list);
  }

  let valid = 0;
  let invalid_environment_cells = 0;
  let interference_cells = 0;
  let duplicate_cells = 0;
  const missing = [];

  for (const id of expectedIds) {
    const list = byId.get(id) || [];
    const passes = list.filter((r) => r.status === "PASS");
    if (passes.length > 1) duplicate_cells += 1;
    const best = passes.find((r) => isEnvValidPass(r)) || passes[0] || list[0];
    if (!best) {
      missing.push(id);
      continue;
    }
    if (best.status === "INVALID_ENVIRONMENT_INTERFERENCE") {
      interference_cells += 1;
      continue;
    }
    if (best.status === "PASS" && isEnvValidPass(best)) {
      valid += 1;
      continue;
    }
    if (best.status === "PASS" && !best.environment?.environment_id) {
      invalid_environment_cells += 1;
      continue;
    }
    if (best.status === "PASS") {
      invalid_environment_cells += 1;
      continue;
    }
    // BLOCKED / other — count as missing for owner_complete purposes
    missing.push(id);
  }

  const validRows = ownerRows.filter((r) => isEnvValidPass(r));
  const taxesRaw = computeCellMatchedOutboxTax(validRows);
  const taxesFinal = taxesRaw.map((t) => {
    if (t.status !== "OK") return t;
    const w1 = validRows.find((r) => r.cell_id === t.w1_cell_id);
    const w2 = validRows.find((r) => r.cell_id === t.w2_cell_id);
    if (w1?.environment?.environment_id !== w2?.environment?.environment_id) {
      return {
        ...t,
        status: "INVALID",
        reason: "CROSS_ENVIRONMENT_PAIR",
        OUTBOX_DB_TAX_ABS: null,
        OUTBOX_DB_TAX_PERCENT: null,
        OUTBOX_TPS_TAX_PERCENT: null,
      };
    }
    return t;
  });
  const crossFinal = taxesFinal.filter((t) => t.reason === "CROSS_ENVIRONMENT_PAIR").length;

  const envIds = [
    ...new Set(validRows.map((r) => r.environment?.environment_id).filter(Boolean)),
  ];
  const cfgHashes = [
    ...new Set(validRows.map((r) => r.environment?.postgres_config_hash || r.postgres_config_hash).filter(Boolean)),
  ];

  const predicate = evaluateOwnerComplete({
    expected_owner_cells: cellsPerOwner(),
    valid_owner_cells: valid,
    missing_cells: missing.length,
    duplicate_cells,
    invalid_environment_cells,
    interference_cells,
    legacy_checkpoint_cells_used: 0,
    cross_environment_w1_w2_pairs: crossFinal,
  });

  return {
    schema: "record-platform-pgbench-owner-review/v1",
    owner,
    run_id: opts.run_id,
    environment_id: opts.environment_id || envIds[0] || null,
    postgres_config_hash: opts.postgres_config_hash || cfgHashes[0] || null,
    environment_ids_seen: envIds,
    postgres_config_hashes_seen: cfgHashes,
    expected_owner_cells: cellsPerOwner(),
    valid_owner_cells: valid,
    missing_cells: missing.length,
    missing_cell_ids_sample: missing.slice(0, 20),
    duplicate_cells,
    invalid_environment_cells,
    interference_cells,
    legacy_checkpoint_cells_used: 0,
    cross_environment_w1_w2_pairs: crossFinal,
    over_count: predicate.over_count,
    owner_complete_reason: predicate.reason,
    owner_complete: predicate.owner_complete,
    pgbench_ceiling_complete: false,
    exit_code: predicate.exit_code,
    note: "Owner ceiling ≠ Gate 3 completion. Full 14616-cell merge still required.",
    outbox_tax_summary: summarizeOutboxTax(taxesFinal),
    outbox_tax_pairs_sample: taxesFinal.slice(0, 20),
    w3_batch_summary: summarizeW3Batches(validRows),
    latency_summary: summarizeLatency(validRows),
    postgres_waits_summary: summarizePostgresWaits(ownerRows),
  };
}

/**
 * Load owner rows from a contract run directory (cells/ and shards/<id>/cells/).
 * @param {string} reportDir
 * @param {string} owner
 */
export function loadOwnerResultsFromRunDir(reportDir, owner) {
  /** @type {any[]} */
  const results = [];
  const dirs = [join(reportDir, "cells")];
  const shardsRoot = join(reportDir, "shards");
  if (existsSync(shardsRoot)) {
    for (const sid of readdirSync(shardsRoot)) {
      dirs.push(join(shardsRoot, sid, "cells"));
    }
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const row = JSON.parse(readFileSync(join(dir, name), "utf8"));
        if (row.owner === owner && row.mode === "PER_OWNER_CEILING") results.push(row);
      } catch {
        // skip
      }
    }
  }
  // Prefer env-valid PASS when duplicates exist
  /** @type {Map<string, any>} */
  const best = new Map();
  for (const row of results) {
    const prev = best.get(row.cell_id);
    if (!prev) {
      best.set(row.cell_id, row);
      continue;
    }
    if (isEnvValidPass(row) && !isEnvValidPass(prev)) best.set(row.cell_id, row);
  }
  return [...best.values()];
}

/**
 * Pure read/evaluate of owner review. MUST NOT write files.
 * @param {string} reportDir
 * @param {string} owner
 * @param {string} runId
 */
export function evaluateOwnerReview(reportDir, owner, runId) {
  const results = loadOwnerResultsFromRunDir(reportDir, owner);
  let legacyMarkers = 0;
  const cellsDir = join(reportDir, "cells");
  if (existsSync(cellsDir)) {
    legacyMarkers = readdirSync(cellsDir).filter((f) =>
      f.includes("LEGACY_CHECKPOINT_INSUFFICIENT"),
    ).length;
  }
  const review = buildOwnerReview({ owner, run_id: runId, results });
  review.legacy_checkpoint_markers_present = legacyMarkers;
  review.legacy_checkpoint_cells_used = 0;
  return review;
}

/**
 * Write <owner>-owner-review.json (+ companion summaries) under reportDir.
 * @param {string} reportDir
 * @param {string} owner
 * @param {string} runId
 */
export function writeOwnerReviewArtifacts(reportDir, owner, runId) {
  const review = evaluateOwnerReview(reportDir, owner, runId);

  const outDir = join(reportDir, "owner-reviews");
  mkdirSync(outDir, { recursive: true });
  const files = {
    [`${owner}-owner-review.json`]: review,
    [`${owner}-outbox-tax.json`]: {
      pairs: review.outbox_tax_pairs_sample,
      summary: review.outbox_tax_summary,
    },
    [`${owner}-w3-batch-summary.json`]: review.w3_batch_summary,
    [`${owner}-latency-summary.json`]: review.latency_summary,
    [`${owner}-postgres-waits-summary.json`]: review.postgres_waits_summary,
  };

  // saturation stub from valid rows series
  const saturation = {
    owner,
    note: "owner-scoped; full saturation.json remains Gate-3 merge artifact",
    owner_complete: review.owner_complete,
    series_note: "derive knees only when owner_complete=true",
  };
  files[`${owner}-saturation.json`] = saturation;

  /** @type {Record<string, string>} */
  const shas = {};
  for (const [name, obj] of Object.entries(files)) {
    const p = join(outDir, name);
    writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
    const sha = sha256(readFileSync(p));
    writeFileSync(`${p}.sha256`, `${sha}  ${name}\n`);
    shas[name] = sha;
  }

  // Convenience alias requested in GO
  if (owner === "records") {
    const alias = join(reportDir, "records-owner-review.json");
    writeFileSync(alias, JSON.stringify(review, null, 2) + "\n");
    writeFileSync(`${alias}.sha256`, `${sha256(readFileSync(alias))}  records-owner-review.json\n`);
  }

  return { review, shas, outDir };
}
