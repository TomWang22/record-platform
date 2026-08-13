/**
 * Safe merger for Gate-3 shard checkpoints.
 * Scout promotion forbidden; environment identity required; W1/W2 same env.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { enumerateExpectedPgbenchCells } from "./pgbench_completeness.mjs";
import {
  CONTRACT_WARMUP_SECONDS,
  CONTRACT_MEASURED_SECONDS,
  WORKLOAD_REVISION,
  evaluateContractCompleteness,
  isReusableContractCell,
  rejectScoutPromotion,
} from "./pgbench_resume.mjs";
import { assertEnvironmentEquivalence, assertPerformanceEnvironmentEquivalence } from "./pgbench_environment.mjs";
import { computeCellMatchedOutboxTax, summarizeOutboxTax } from "./pgbench_outbox_tax.mjs";
import {
  COLIMA_SEQUENTIAL_RUN_ID,
  PLACEHOLDER_ISOLATED_RUN_ID,
  assertFullstackDatabaseLocality,
} from "./pgbench_isolated_shard_launcher.mjs";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function hasEnvironmentIdentity(cell) {
  const e = cell?.environment;
  if (!e || typeof e !== "object") return false;
  return Boolean(
    e.environment_id &&
      e.db_instance_id &&
      e.contention_domain_id &&
      e.postgres_config_hash &&
      e.database_target,
  );
}

export const GLOBAL_MERGE_EQUALITY_FIELDS = Object.freeze([
  "git_sha",
  "catalog_sha",
  "workload_revision",
  "isolated_run_id",
]);

export const MERGE_LINEAGE_ISOLATED = "ISOLATED";
export const MERGE_LINEAGE_SEQUENTIAL = "SEQUENTIAL";

export function assertGlobalMergeEquality(cells) {
  const reasons = [];
  const first = cells[0];
  if (!first) return { ok: false, reasons: ["empty"] };
  for (const cell of cells) {
    if (cell.isolated_run_id === COLIMA_SEQUENTIAL_RUN_ID) {
      reasons.push("colima sequential checkpoints forbidden in isolated merge");
    }
    if (cell.isolated_run_id === PLACEHOLDER_ISOLATED_RUN_ID) {
      reasons.push("NEW_RUN_ID_REQUIRED forbidden as isolated_run_id");
    }
    for (const f of GLOBAL_MERGE_EQUALITY_FIELDS) {
      if (!cell[f] || cell[f] !== first[f]) reasons.push(`GLOBAL_MERGE_MISMATCH ${f}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function assertPerClassEquivalence(cells) {
  const reasons = [];
  const byMode = new Map();
  for (const cell of cells) {
    const k = cell.mode;
    if (!byMode.has(k)) byMode.set(k, []);
    byMode.get(k).push(cell);
  }
  for (const group of byMode.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const eq = assertEnvironmentEquivalence(group[i].environment, group[j].environment);
        if (!eq.ok) reasons.push(`${group[i].mode}: ${eq.status}`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function assertIsolationMustDiffer(identities) {
  const reasons = [];
  const fields = ["contention_domain_id", "db_instance_id", "hostname", "postgres_data_directory_identity"];
  for (const field of fields) {
    const seen = new Set();
    for (const id of identities) {
      const v = id?.[field];
      if (!v || seen.has(v)) reasons.push(`duplicate_or_missing ${field}`);
      else seen.add(v);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Annotate W1/W2 pairs that cross environments.
 * Pair is invalid unless environment_id, contention_domain_id, database_target,
 * owner, random_seed, repetition, and comparison class / mode match.
 */
function pairContractOk(w1, w2) {
  const e1 = w1?.environment;
  const e2 = w2?.environment;
  const target1 = e1?.database_target || w1?.database_target;
  const target2 = e2?.database_target || w2?.database_target;
  const checks = [
    Boolean(e1?.environment_id) && e1.environment_id === e2?.environment_id,
    Boolean(e1?.contention_domain_id) && e1.contention_domain_id === e2?.contention_domain_id,
    Boolean(target1) && target1 === target2,
    Boolean(w1?.owner) && w1.owner === w2?.owner,
    w1?.random_seed != null && Number(w1.random_seed) === Number(w2?.random_seed),
    w1?.repetition != null && Number(w1.repetition) === Number(w2?.repetition),
    Boolean(w1?.mode) && w1.mode === w2?.mode,
  ];
  if (w1?.frozen_environment_pair_id || w2?.frozen_environment_pair_id) {
    checks.push(w1.frozen_environment_pair_id === w2.frozen_environment_pair_id);
  }
  if (e1?.equivalence_class || e2?.equivalence_class) {
    checks.push(e1.equivalence_class === e2.equivalence_class);
  }
  return checks.every(Boolean);
}

function invalidatePair(t, reason) {
  return {
    ...t,
    status: "INVALID",
    reason,
    OUTBOX_DB_TAX_ABS: null,
    OUTBOX_DB_TAX_PERCENT: null,
    OUTBOX_TPS_TAX_PERCENT: null,
  };
}

function annotateCrossEnvironmentPairs(results) {
  const taxes = computeCellMatchedOutboxTax(results);
  /** @type {any[]} */
  const out = [];
  for (const t of taxes) {
    if (t.status !== "OK") {
      out.push(t);
      continue;
    }
    const w1 = results.find((r) => r.cell_id === t.w1_cell_id);
    const w2 = results.find((r) => r.cell_id === t.w2_cell_id);
    if (!pairContractOk(w1, w2)) {
      out.push(invalidatePair(t, "CROSS_ENVIRONMENT_PAIR"));
      continue;
    }
    out.push(t);
  }

  const w1s = results.filter((r) => r.workload === "W1_DOMAIN_ONLY");
  const w2s = results.filter((r) => r.workload === "W2_DOMAIN_PLUS_OUTBOX");
  for (const w1 of w1s) {
    for (const w2 of w2s) {
      const already = out.some(
        (p) =>
          p.w1_cell_id === w1.cell_id &&
          p.w2_cell_id === w2.cell_id &&
          (p.reason === "CROSS_ENVIRONMENT_PAIR" || p.reason === "INVALID_PAIR"),
      );
      if (already) continue;
      const sameCorpus =
        w1.distribution === w2.distribution &&
        w1.clients === w2.clients &&
        w1.threads === w2.threads &&
        Number(w1.random_seed) === Number(w2.random_seed);
      if (!sameCorpus) continue;
      if (Number(w1.repetition) !== Number(w2.repetition) && w1.owner === w2.owner) {
        out.push(
          invalidatePair(
            {
              owner: w1.owner,
              mode: w1.mode,
              w1_cell_id: w1.cell_id,
              w2_cell_id: w2.cell_id,
            },
            "INVALID_PAIR",
          ),
        );
        continue;
      }
      if (w1.mode !== w2.mode && Number(w1.repetition) === Number(w2.repetition)) {
        out.push(
          invalidatePair(
            {
              owner: w1.owner,
              mode: w1.mode,
              w1_cell_id: w1.cell_id,
              w2_cell_id: w2.cell_id,
            },
            "INVALID_PAIR",
          ),
        );
      }
    }
  }
  return out;
}

function uniqueVmIdentities(cells) {
  /** @type {Map<string, any>} */
  const byKey = new Map();
  for (const cell of cells) {
    const e = cell?.environment;
    if (!e) continue;
    const key = e.environment_id || e.hostname || e.contention_domain_id;
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()];
}

function isMintedIsolatedRunId(id) {
  return typeof id === "string" && id.startsWith("pgbench-isolated-");
}

function normalizeMergeOpts(opts = {}) {
  const lineage = opts.lineage === MERGE_LINEAGE_ISOLATED ? MERGE_LINEAGE_ISOLATED : MERGE_LINEAGE_SEQUENTIAL;
  return { ...opts, lineage };
}

/**
 * @param {Array<{ shard_id: string, results: any[] }>} shards
 * @param {{
 *   lineage?: "ISOLATED" | "SEQUENTIAL",
 *   expected_run_id?: string,
 *   phase2_shard_count?: number,
 *   phase2_declared_before_execution?: boolean,
 * }} [opts]
 */
export function mergeShardResults(shards, opts = {}) {
  const {
    lineage,
    expected_run_id,
    phase2_shard_count,
    phase2_declared_before_execution,
  } = normalizeMergeOpts(opts);
  /** @type {Map<string, { shard_id: string, cell: any }>} */
  const byId = new Map();
  /** @type {Map<string, { status: string, shard_id: string }>} */
  const seen = new Map();
  /** @type {string[]} */
  const errors = [];
  /** @type {any[]} */
  const invalid = [];

  if (lineage === MERGE_LINEAGE_ISOLATED) {
    if (
      !expected_run_id ||
      expected_run_id === PLACEHOLDER_ISOLATED_RUN_ID ||
      expected_run_id === COLIMA_SEQUENTIAL_RUN_ID
    ) {
      errors.push("ISOLATED merge requires a minted expected_run_id");
    }
  }

  for (const shard of shards) {
    for (const cell of shard.results || []) {
      const runId = cell.isolated_run_id;
      if (lineage === MERGE_LINEAGE_ISOLATED) {
        if (runId === COLIMA_SEQUENTIAL_RUN_ID) {
          invalid.push({
            cell_id: cell.cell_id,
            shard_id: shard.shard_id,
            reason: "COLIMA_CHECKPOINT_FORBIDDEN",
          });
          continue;
        }
        if (!runId) {
          invalid.push({
            cell_id: cell.cell_id,
            shard_id: shard.shard_id,
            reason: "MISSING_ISOLATED_LINEAGE",
          });
          continue;
        }
        if (runId === PLACEHOLDER_ISOLATED_RUN_ID) {
          invalid.push({
            cell_id: cell.cell_id,
            shard_id: shard.shard_id,
            reason: "NEW_RUN_ID_REQUIRED",
          });
          continue;
        }
      } else if (isMintedIsolatedRunId(runId)) {
        invalid.push({
          cell_id: cell.cell_id,
          shard_id: shard.shard_id,
          reason: "ISOLATED_CELL_IN_SEQUENTIAL_MERGE",
        });
        continue;
      }

      if (seen.has(cell.cell_id)) {
        const prev = seen.get(cell.cell_id);
        const reason =
          prev.status === "PASS" && cell.status === "PASS" ? "DUPLICATE_PASS" : "DUPLICATE_CELL";
        errors.push(`duplicate ${reason} for ${cell.cell_id}`);
        invalid.push({
          cell_id: cell.cell_id,
          shard_id: shard.shard_id,
          reason,
        });
        byId.delete(cell.cell_id);
        continue;
      }
      seen.set(cell.cell_id, { status: cell.status, shard_id: shard.shard_id });

      const scout = rejectScoutPromotion(cell);
      if (!scout.ok) {
        invalid.push({
          cell_id: cell.cell_id,
          shard_id: shard.shard_id,
          reason: "SCOUT_PROMOTION_FORBIDDEN",
          detail: scout.reason,
        });
        continue;
      }
      if (
        Number(cell.warmup_seconds) !== CONTRACT_WARMUP_SECONDS ||
        Number(cell.measured_seconds) !== CONTRACT_MEASURED_SECONDS
      ) {
        invalid.push({
          cell_id: cell.cell_id,
          shard_id: shard.shard_id,
          reason: "DURATION_MISMATCH",
        });
        continue;
      }
      if (cell.workload_revision && cell.workload_revision !== WORKLOAD_REVISION) {
        invalid.push({
          cell_id: cell.cell_id,
          shard_id: shard.shard_id,
          reason: "WORKLOAD_REVISION_MISMATCH",
        });
        continue;
      }
      if (!hasEnvironmentIdentity(cell)) {
        invalid.push({
          cell_id: cell.cell_id,
          shard_id: shard.shard_id,
          reason: "LEGACY_CHECKPOINT_INSUFFICIENT",
        });
        continue;
      }
      if (cell.status === "PASS" && !isReusableContractCell(cell)) {
        invalid.push({
          cell_id: cell.cell_id,
          shard_id: shard.shard_id,
          reason: "NOT_REUSABLE",
        });
        continue;
      }
      if (lineage === MERGE_LINEAGE_ISOLATED && cell.mode === "ALL_OWNERS_CONCURRENT") {
        const loc = assertFullstackDatabaseLocality(cell.environment);
        if (!loc.ok) {
          invalid.push({
            cell_id: cell.cell_id,
            shard_id: shard.shard_id,
            reason: "FULLSTACK_DATABASE_NOT_LOCAL",
          });
          continue;
        }
        const p2 = cell.phase2_shard_count ?? cell.provenance?.phase2_shard_count;
        if (p2 == null) {
          invalid.push({
            cell_id: cell.cell_id,
            shard_id: shard.shard_id,
            reason: "MISSING_PHASE2_SHARD_COUNT",
          });
          continue;
        }
      }

      if (cell.status === "PASS") {
        byId.set(cell.cell_id, { shard_id: shard.shard_id, cell });
      }
    }
  }

  const merged = [...byId.values()].map((v) => v.cell);

  if (lineage === MERGE_LINEAGE_ISOLATED) {
    if (merged.length > 0) {
      const eq = assertGlobalMergeEquality(merged);
      if (!eq.ok) errors.push(...eq.reasons);
      if (expected_run_id) {
        for (const cell of merged) {
          if (cell.isolated_run_id !== expected_run_id) {
            errors.push("GLOBAL_MERGE_MISMATCH isolated_run_id");
          }
        }
      }
      const iso = assertIsolationMustDiffer(uniqueVmIdentities(merged));
      if (!iso.ok) errors.push(...iso.reasons);
    }
    const p2 = merged.filter((c) => c.mode === "ALL_OWNERS_CONCURRENT");
    const classes = new Set(
      p2.map((c) => Number(c.phase2_shard_count ?? c.provenance?.phase2_shard_count)).filter((n) => n === 1 || n === 4),
    );
    if (classes.has(4) && classes.has(1)) {
      errors.push("PHASE2_SHARD_CLASS_MIX");
    }
    if (phase2_shard_count && p2.length > 0 && classes.size > 0 && !classes.has(Number(phase2_shard_count))) {
      errors.push("PHASE2_SHARD_CLASS_MIX");
    }
    if (classes.has(1) && phase2_declared_before_execution !== true) {
      errors.push("PHASE2_SHARD_CLASS_MIX");
    }
  }

  const passByMode = new Map();
  for (const cell of merged.filter((c) => c.status === "PASS")) {
    const k = cell.mode;
    if (!passByMode.has(k)) passByMode.set(k, []);
    passByMode.get(k).push(cell);
  }
  for (const group of passByMode.values()) {
    if (group.length < 2) continue;
    const anchor = group[0].environment;
    for (let i = 1; i < group.length; i++) {
    const eq =
      lineage === MERGE_LINEAGE_ISOLATED
        ? assertPerformanceEnvironmentEquivalence(anchor, group[i].environment)
        : assertEnvironmentEquivalence(anchor, group[i].environment);
    if (!eq.ok) {
      const detail = eq.reasons?.join(",") || eq.status;
      errors.push(`INVALID_ENVIRONMENT_MISMATCH: ${group[0].mode}: ${detail}`);
    }
    }
  }

  const outbox_tax_pairs = annotateCrossEnvironmentPairs(merged);
  const ok = errors.length === 0 && invalid.length === 0;

  return {
    ok,
    errors,
    invalid,
    results: merged,
    outbox_tax_pairs,
    outbox_tax_summary: summarizeOutboxTax(outbox_tax_pairs),
  };
}

/**
 * Load all shard cell JSON files under reportDir/shards/<shard_id>/cells
 * @param {string} reportDir
 */
export function loadAllShardCells(reportDir) {
  const shardsDir = join(reportDir, "shards");
  /** @type {Array<{ shard_id: string, results: any[] }>} */
  const shards = [];
  if (!existsSync(shardsDir)) {
    // fallback: top-level cells/ (single-env sequential)
    const cellsDir = join(reportDir, "cells");
    if (existsSync(cellsDir)) {
      const results = [];
      for (const name of readdirSync(cellsDir)) {
        if (!name.endsWith(".json")) continue;
        results.push(JSON.parse(readFileSync(join(cellsDir, name), "utf8")));
      }
      shards.push({ shard_id: "default", results });
    }
    return shards;
  }
  for (const shard_id of readdirSync(shardsDir)) {
    const cellsDir = join(shardsDir, shard_id, "cells");
    if (!existsSync(cellsDir)) continue;
    const results = [];
    for (const name of readdirSync(cellsDir)) {
      if (!name.endsWith(".json")) continue;
      results.push(JSON.parse(readFileSync(join(cellsDir, name), "utf8")));
    }
    shards.push({ shard_id, results });
  }
  return shards;
}

/**
 * @param {string} reportDir
 */
export function validateMergedCompleteness(reportDir, opts = {}) {
  const shards = loadAllShardCells(reportDir);
  const merge = mergeShardResults(shards, opts);
  const completeness = evaluateContractCompleteness(merge.results);
  return {
    ...completeness,
    merge_ok: merge.ok,
    merge_errors: merge.errors,
    invalid: merge.invalid,
    invalid_legacy_checkpoint_count: merge.invalid.filter(
      (i) => i.reason === "LEGACY_CHECKPOINT_INSUFFICIENT",
    ).length,
    pgbench_ceiling_complete_allowed:
      completeness.pgbench_ceiling_complete_allowed && merge.ok && merge.invalid.length === 0,
  };
}

function writeJsonAtomicLocal(targetPath, value) {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(value, null, 2) + "\n";
  try {
    const fd = openSync(tmpPath, "w");
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // tmp already renamed away, or never created
    }
    throw err;
  }
}

/**
 * Publish a merged report bundle. Crash injection: hooks.failBeforeSummary
 * must leave any previous summary.json authoritative.
 * Companions are published first; summary.json (ceiling marker) is last.
 *
 * @param {string} reportDir
 * @param {Record<string, unknown>} files
 * @param {{ failBeforeSummary?: boolean }} [hooks]
 */
export function publishMergedReportBundle(reportDir, files, hooks = {}) {
  mkdirSync(reportDir, { recursive: true });
  const staging = join(reportDir, ".merge-publish-staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const names = Object.keys(files);
  const companions = names.filter((n) => n !== "summary.json");
  /** @type {Record<string, string>} */
  const shas = {};
  try {
    for (const name of companions) {
      writeJsonAtomicLocal(join(staging, name), files[name]);
    }
    if (Object.prototype.hasOwnProperty.call(files, "summary.json")) {
      writeJsonAtomicLocal(join(staging, "summary.json"), files["summary.json"]);
    }
    for (const name of companions) {
      const dest = join(reportDir, name);
      renameSync(join(staging, name), dest);
      const sha = sha256(readFileSync(dest));
      writeFileSync(`${dest}.sha256`, `${sha}  ${name}\n`);
      shas[name] = sha;
    }
    if (hooks.failBeforeSummary) {
      throw new Error("injected crash before summary publication");
    }
    if (Object.prototype.hasOwnProperty.call(files, "summary.json")) {
      const dest = join(reportDir, "summary.json");
      renameSync(join(staging, "summary.json"), dest);
      const sha = sha256(readFileSync(dest));
      writeFileSync(`${dest}.sha256`, `${sha}  summary.json\n`);
      shas["summary.json"] = sha;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { published: true, shas };
}

/**
 * Write merged artifacts into reportDir (after validation).
 * @param {string} reportDir
 * @param {{ lineage?: string, expected_run_id?: string, hooks?: { failBeforeSummary?: boolean } }} [opts]
 */
export function writeMergedArtifacts(reportDir, opts = {}) {
  const shards = loadAllShardCells(reportDir);
  const merge = mergeShardResults(shards, opts);
  const completeness = evaluateContractCompleteness(merge.results);
  if (!merge.ok || merge.invalid.length > 0 || !completeness.complete) {
    return {
      written: false,
      completeness,
      merge,
      reason: "merge validation incomplete — refusing to declare ceiling",
    };
  }
  const files = {
    "raw-results.json": { results: merge.results },
    "outbox-tax.json": {
      pairs: merge.outbox_tax_pairs,
      summary: merge.outbox_tax_summary,
    },
    "blocked-cells.json": {
      cells: merge.results.filter((r) => r.status === "BLOCKED"),
    },
    "summary.json": {
      schema: "record-platform-pgbench-contract-merged/v1",
      pgbench_ceiling_complete: true,
      completeness,
      outbox_tax_summary: merge.outbox_tax_summary,
    },
  };
  const published = publishMergedReportBundle(reportDir, files, opts.hooks || {});
  return { written: true, completeness, merge, shas: published.shas };
}
